import cv2
import uvicorn
import threading
import time
import asyncio
import numpy as np
import base64
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import StreamingResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# ---- CORE MODULES ----
from core.detector import ETryDetector
from core.stylist import ETryStylist
from core.processor import ETryProcessor
from core.engine_3d import Engine3D
from core.pose_mapper import PoseMapper

# --------------------------------------------------
# APP SETUP
# --------------------------------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# --------------------------------------------------
# ENGINES
# --------------------------------------------------
detector = ETryDetector()
stylist = ETryStylist()
processor = ETryProcessor()
engine3d = None
pose_mapper = None

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

    def start(self):
        self.running = True
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        last_time = time.time()
        while self.running:
            if cap is None or not cap.isOpened():
                time.sleep(0.01)
                continue
            ok, frame = cap.read()
            if not ok: continue
            
            now = time.time()
            dt = now - last_time
            last_time = now
            if dt > 0: self.fps = 0.1 * (1.0 / dt) + 0.9 * self.fps

            # Optimize RTX 2050 CUDA Load
            if hasattr(detector, 'holistic'):
                if self.fps < 45.0 and detector.segmentation_enabled:
                    detector.segmentation_enabled = False
                elif self.fps >= 45.0 and not detector.segmentation_enabled:
                    detector.segmentation_enabled = True

            # Pose Detection at 30Hz
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
            # Antigravity Y-work
            verts = engine3d.shirt.apply_antigravity(verts, amplitude=0.05, frequency=1.5 / (2 * np.pi))
            binary_data = verts.astype(np.float32).tobytes()
            for ws in list(active_connections):
                try: await ws.send_bytes(binary_data)
                except: active_connections.discard(ws)
        await asyncio.sleep(1.0 / 60.0)

@app.on_event("startup")
async def startup_event():
    global cap
    for i in range(3):
        test_cap = cv2.VideoCapture(i)
        if test_cap.isOpened():
            ret, _ = test_cap.read()
            if ret:
                cap = test_cap
                asyncio.create_task(physics_loop())
                return
            test_cap.release()

@app.on_event("shutdown")
async def shutdown_event():
    if cap: cap.release()

# --------------------------------------------------
# ROUTES
# --------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index():
    with open("static/index.html") as f: return f.read()

@app.get("/change_category")
async def change_category(name: str):
    global current_category, engine3d, pose_mapper
    current_category = name
    if name in ["clothes", "Shirts"] and engine3d is None:
        engine3d = Engine3D()
        pose_mapper = PoseMapper(engine3d.device)
    return {"status": "success"}

@app.get("/get_rating")
async def get_rating(): return stylist.calculate_score()

@app.post("/upload_texture")
async def upload_texture(request: Request):
    """Base64-to-CUDA Pipeline: accepts raw image data as POST to bypass server-side URL timeouts."""
    global engine3d
    try:
        body = await request.json()
        b64_data = body.get("image_data", "")
        # Strip data URI prefix if present (e.g. data:image/png;base64,...)
        if "," in b64_data:
            b64_data = b64_data.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_data)
        if engine3d is not None:
            engine3d.update_texture_from_bytes(img_bytes)
            return JSONResponse({"status": "success", "source": "base64-cuda"})
        else:
            return JSONResponse({"status": "engine_not_ready"}, status_code=503)
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)

# --------------------------------------------------
# VIDEO PIPELINE
# --------------------------------------------------
def generate_frames():
    global target_image_url
    texture_updated = False
    if not frame_buffer.running: frame_buffer.start()
        
    while True:
        loop_start = time.time()
        if target_image_url and engine3d and not texture_updated:
            try:
                engine3d.update_texture(target_image_url)
                texture_updated = True
            except: pass
            
        with frame_buffer.lock:
            frame = frame_buffer.frame.copy() if frame_buffer.frame is not None else None
            results = frame_buffer.results

        if frame is None:
            time.sleep(0.1)
            continue

        # ---------------- CLOTHES (BITWISE OVERLAY) ----------------
        if current_category in ["clothes", "Shirts"] and results and results.pose_landmarks:
            try:
                if engine3d:
                    body_pose = pose_mapper.map(results.pose_landmarks, frame.shape[1], frame.shape[0])
                    render_rgb = engine3d.render_live(body_pose, frame.shape[1], frame.shape[0])
                    
                    if render_rgb is not None:
                        render_bgr = cv2.cvtColor(render_rgb, cv2.COLOR_RGB2BGR)
                        aligned = engine3d.align_to_body(render_bgr, results.pose_landmarks, frame.shape)
                        
                        # Luma-Key Alpha Reinforcement: threshold at 1, strict pixel replacement
                        # Y-axis work V_y = V_y + 0.05 * sin(1.5 * t) oscillating at 60 FPS
                        gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
                        _, mask = cv2.threshold(gray, 1, 255, cv2.THRESH_BINARY)
                        
                        # Morphological Dilate: 3x3 kernel fills shirt edge gaps for crisp borders
                        kernel = np.ones((3, 3), np.uint8)
                        mask = cv2.dilate(mask, kernel, iterations=2)
                        mask_inv = cv2.bitwise_not(mask)
                        
                        # Direct Bitwise Injection: replace camera pixels with shirt fabric
                        img_bg = cv2.bitwise_and(frame, frame, mask=mask_inv)
                        img_fg = cv2.bitwise_and(aligned, aligned, mask=mask)
                        frame = cv2.add(img_bg, img_fg)
                        
                        cv2.putText(frame, "Hardware-Override: Ready", (50, 50), 0, 1, (0, 255, 0), 2)
            except: pass

        # UI & Standardize Viewport (480x640)
        frame = cv2.resize(frame, (480, 640))
        ret, buffer = cv2.imencode(".jpg", frame)
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n")
        
        # Lock to 60 FPS
        elapsed = time.time() - loop_start
        wait = (1.0 / 60.0) - elapsed
        if wait > 0: time.sleep(wait)

@app.get("/video_feed")
async def video_feed(image_url: str = None):
    global target_image_url
    if image_url: target_image_url = image_url
    return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.websocket("/ws/physics")
async def websocket_physics(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: active_connections.discard(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)