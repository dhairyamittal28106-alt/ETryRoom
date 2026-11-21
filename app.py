import uvicorn
import threading
import time
import asyncio
import sys
import os

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
import base64
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

# ---- CORE MODULES ----
from core.stylist import ETryStylist
from core.store import init_store, router as product_api
runtime_error = None
LEGACY_CAMERA_SERVER_ENABLED = os.getenv("ETRYROOM_ENABLE_LEGACY_CAMERA_SERVER", "0") == "1"
try:
    import cv2
    import numpy as np
    from core.detector import ETryDetector
    from core.engine_3d import Engine3D
    from core.pose_mapper import PoseMapper
except ImportError as exc:
    runtime_error = str(exc)

# --------------------------------------------------
# APP SETUP
# --------------------------------------------------
app = FastAPI()

ROOT = Path(__file__).resolve().parent
WEB_ROOT = next((path for path in (ROOT / "public" / "static", ROOT / "dist", ROOT / "static")
                if (path / "index.html").exists()), ROOT / "static")
app.mount("/static", StaticFiles(directory=WEB_ROOT), name="static")
app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")
if (WEB_ROOT / "vision-wasm").exists():
    app.mount("/vision-wasm", StaticFiles(directory=WEB_ROOT / "vision-wasm"), name="vision-wasm")
if (WEB_ROOT / "models").exists():
    app.mount("/models", StaticFiles(directory=WEB_ROOT / "models"), name="models")
app.include_router(product_api)

@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    return response

# --------------------------------------------------
# ENGINES
# --------------------------------------------------
detector = None
stylist = ETryStylist()
engine3d = None
pose_mapper = None
engine_lock = threading.Lock()
engine_error = None
physics_task = None


def ensure_engine():
    global engine3d, pose_mapper, engine_error
    if runtime_error:
        raise HTTPException(503, "The experimental 3D runtime is not installed. Use the browser fitting studio.")
    with engine_lock:
        if engine3d is None:
            try:
                engine = Engine3D(model_path=str(ROOT / "models" / "smplx"))
                mapper = PoseMapper(engine.device)
                engine3d, pose_mapper = engine, mapper
                engine_error = None
            except Exception as exc:
                engine_error = str(exc)
                raise HTTPException(503, "Shirt renderer unavailable. Check model files and 3D dependencies.") from exc


def require_legacy_camera_server():
    if not LEGACY_CAMERA_SERVER_ENABLED:
        raise HTTPException(404, "This legacy server-camera endpoint is disabled. Use browser camera mode in the fitting studio.")


class TextureUpload(BaseModel):
    image_data: str = Field(min_length=1, max_length=7_000_000)

# --------------------------------------------------
# GLOBAL STATE
# --------------------------------------------------
current_category = "clothes"
show_mesh = True
target_image_url = None
cap = None
active_connections = set()

# --------------------------------------------------
# THREADED FRAME BUFFER
# --------------------------------------------------
class ThreadedFrameBuffer:
    def __init__(self):
        self.frame = None
        self.results = None
        self.lock = threading.Lock()
        self.running = False
        self.fps = 60.0
        self.last_mp_time = 0
        self.thread = None

    def start(self):
        with self.lock:
            if self.running:
                return
            self.running = True
            self.thread = threading.Thread(target=self._loop, daemon=True)
            self.thread.start()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=3)

    def _loop(self):
        global cap
        last_time = time.time()
        last_frame_time = time.time()
        while self.running:
            if cap is None or not cap.isOpened():
                time.sleep(0.01)
                continue
            ok, frame = cap.read()
            if not ok:
                # Hardware-Override Retry Logic: if no frame within 2s, cycle through indices 0-2
                if time.time() - last_frame_time > 2.0:
                    print("Stream-Recovery: No frame from camera. Cycling through indices 0, 1, 2...")
                    for idx in range(3):
                        test_cap = cv2.VideoCapture(idx)
                        if test_cap.isOpened():
                            ret, _ = test_cap.read()
                            if ret:
                                if cap: cap.release()
                                cap = test_cap
                                print(f"Stream-Recovery: Camera index {idx} restored.")
                                last_frame_time = time.time()
                                break
                        test_cap.release()
                time.sleep(0.05)
                continue
            last_frame_time = time.time()
            
            now = time.time()
            dt = now - last_time
            last_time = now
            if dt > 0: self.fps = 0.1 * (1.0 / dt) + 0.9 * self.fps

            if hasattr(detector, 'holistic'):
                if self.fps < 45.0 and detector.segmentation_enabled:
                    detector.segmentation_enabled = False
                elif self.fps >= 45.0 and not detector.segmentation_enabled:
                    detector.segmentation_enabled = True

            if now - self.last_mp_time >= 1.0 / 30.0:
                _, results = detector.find_all_anchors(frame)
                self.last_mp_time = now
                with self.lock: self.results = results
            
            with self.lock: self.frame = frame

frame_buffer = ThreadedFrameBuffer()

async def physics_loop():
    while True:
        if active_connections and engine3d is not None:
            verts = np.copy(engine3d.shirt.rest_vertices)
            verts = engine3d.shirt.apply_antigravity(verts, amplitude=0.05, frequency=1.5 / (2 * np.pi))
            binary_data = verts.astype(np.float32).tobytes()
            for ws in list(active_connections):
                try: await ws.send_bytes(binary_data)
                except: active_connections.discard(ws)
        await asyncio.sleep(1.0 / 60.0)

@app.on_event("startup")
async def startup_event():
    global physics_task
    init_store()
    physics_task = asyncio.create_task(physics_loop())
    if runtime_error:
        return

@app.post("/camera/start")
def start_server_camera():
    global cap, detector
    require_legacy_camera_server()
    if runtime_error:
        raise HTTPException(503, "The experimental 3D runtime is not installed. Use browser camera mode.")
    if cap is not None and cap.isOpened():
        return {"status": "success"}
    if detector is None:
        detector = ETryDetector()
    for i in range(3):
        test_cap = cv2.VideoCapture(i)
        if test_cap.isOpened():
            ret, _ = test_cap.read()
            if ret:
                cap = test_cap
                return {"status": "success"}
        test_cap.release()
    raise HTTPException(503, "No webcam available for the experimental 3D renderer.")

@app.on_event("shutdown")
async def shutdown_event():
    frame_buffer.stop()
    if cap: cap.release()
    if physics_task:
        physics_task.cancel()
        try:
            await physics_task
        except asyncio.CancelledError:
            pass

# --------------------------------------------------
# ROUTES
# --------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index():
    return (WEB_ROOT / "index.html").read_text(encoding="utf-8")

@app.get("/privacy", response_class=HTMLResponse)
async def privacy():
    return (ROOT / "static" / "privacy.html").read_text(encoding="utf-8")

@app.get("/healthz")
def healthz():
    return {"status": "ok", "product": "etryroom"}

@app.get("/status")
def status():
    return {"camera_ready": cap is not None and cap.isOpened(),
            "engine_ready": engine3d is not None, "engine_error": engine_error,
            "runtime_available": runtime_error is None,
            "category": current_category, "show_mesh": show_mesh}

@app.get("/toggle_mesh")
def toggle_mesh():
    global show_mesh
    require_legacy_camera_server()
    show_mesh = not show_mesh
    return {"show_mesh": show_mesh}

@app.get("/change_category")
def change_category(name: str):
    global current_category
    require_legacy_camera_server()
    category = {"Shirts": "clothes"}.get(name, name)
    if category not in ("clothes", "camera"):
        raise HTTPException(400, "Supported categories: clothes, camera. Accessories and hair are not implemented yet.")
    if category == "clothes":
        ensure_engine()
    current_category = category
    return {"status": "success", "category": category}

@app.get("/get_rating")
async def get_rating():
    require_legacy_camera_server()
    raise HTTPException(501, "Automated fit scoring is not implemented.")

@app.post("/upload_texture")
def upload_texture(body: TextureUpload):
    require_legacy_camera_server()
    try:
        b64_data = body.image_data
        if "," in b64_data:
            b64_data = b64_data.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_data, validate=True)
    except ValueError as exc:
        raise HTTPException(400, "Invalid base64 image data.") from exc
    if not img_bytes:
        raise HTTPException(400, "Image is empty.")
    ensure_engine()
    try:
        with engine_lock:
            engine3d.update_texture_from_bytes(img_bytes)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"status": "success"}

# --------------------------------------------------
# VIDEO PIPELINE
# --------------------------------------------------
def generate_frames():
    global target_image_url
    texture_updated = False
    if not frame_buffer.running: frame_buffer.start()
        
    while frame_buffer.running:
        loop_start = time.time()
        
        # 1. Texture-Mapping Pipeline Handshake
        if target_image_url and engine3d and not texture_updated:
            try:
                with engine_lock:
                    engine3d.update_texture(target_image_url)
                texture_updated = True
            except: pass
            
        with frame_buffer.lock:
            # We copy the frame to ensure the raw feed is preserved for fallback
            raw_camera_frame = frame_buffer.frame.copy() if frame_buffer.frame is not None else None
            results = frame_buffer.results

        if raw_camera_frame is None:
            time.sleep(0.01) # Faster polling for HP Victus camera
            continue

        frame = raw_camera_frame
        
        # ---------------- CLOTHES (FIXED BITWISE OVERLAY) ----------------
        if show_mesh and current_category in ["clothes", "Shirts"] and results and results.pose_landmarks:
            try:
                if engine3d:
                    # Pose-Coordinate Handshake: Anchor root to Shoulders
                    with engine_lock:
                        body_pose, transl = pose_mapper.map(results.pose_landmarks, frame.shape[1], frame.shape[0])
                        render_rgb = engine3d.render_live(body_pose, frame.shape[1], frame.shape[0], transl=transl)
                    
                    if render_rgb is not None:
                        # 1. CUDA-to-BGR Conversion & Alignment
                        aligned = engine3d.align_to_body(render_rgb, results.pose_landmarks, frame.shape)
                        
                        # 2. Luma-Key Alpha Reinforcement: Strict threshold to preserve fabric
                        gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
                        _, mask = cv2.threshold(gray, 1, 255, cv2.THRESH_BINARY)
                        
                        # 3. Morphological Dilate: 3x3 kernel to smooth edges and prevent flickering
                        kernel = np.ones((3, 3), np.uint8)
                        mask = cv2.dilate(mask, kernel, iterations=1)
                        mask_inv = cv2.bitwise_not(mask)
                        
                        # 4. Binary-Mask Pixel Injection: Cut hole in camera, drop in fabric
                        # This ensures the shirt is 100% OPAQUE over your body
                        img_bg = cv2.bitwise_and(frame, frame, mask=mask_inv)
                        img_fg = cv2.bitwise_and(aligned, aligned, mask=mask)
                        frame = cv2.add(img_bg, img_fg)
                        
                        # Visual Confirmation of Antigravity Ready State
                        cv2.putText(frame, "Hardware-Override: Ready", (50, 50), 
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

                        # 5. Mask-Validation Check: If shirt is out of clipping plane, shift Z forward
                        if cv2.countNonZero(mask) == 0:
                            engine3d.mesh_z += 0.5
                            print(f"Mask-Validation: No pixels detected. Shifting Z to {engine3d.mesh_z}")
                                    
            except Exception as e:
                # Stream-Recovery: If 3D fails, we stay on the raw_camera_frame
                print(f"Render Injection Error: {e}")
                frame = raw_camera_frame

        # Viewport-Scale Correction (480x640) for Shoppers Stop Extension
        # Preserve the camera aspect ratio; the browser fits the stream into its viewport.
        ret, buffer = cv2.imencode(".jpg", frame)
        
        if not ret:
            continue
            
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n")
        
        # Lock to 60 FPS for Antigravity Y-axis smoothness
        elapsed = time.time() - loop_start
        wait = (1.0 / 60.0) - elapsed
        if wait > 0:
            time.sleep(wait)
# --------------------------------------------------
# STREAM & WEBSOCKET
# --------------------------------------------------
@app.get("/video_feed")
def video_feed(image_url: str = None):
    """Stream-Recovery Protocol: serves MJPEG. Accepts optional image_url for texture fallback."""
    global target_image_url
    require_legacy_camera_server()
    if cap is None or not cap.isOpened():
        raise HTTPException(503, "No camera found. Connect a webcam and restart ETryRoom.")
    if current_category == "clothes":
        ensure_engine()
    if image_url:
        target_image_url = image_url
    return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.websocket("/ws/physics")
async def websocket_physics(websocket: WebSocket):
    """Y-axis work V_y = V_y + 0.05 * sin(1.5 * t) broadcast at 60 FPS."""
    if not LEGACY_CAMERA_SERVER_ENABLED:
        await websocket.close(code=1008, reason="Legacy server-side renderer is disabled")
        return
    await websocket.accept()
    active_connections.add(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: active_connections.discard(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
