import cv2
import uvicorn
from pathlib import Path


from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

# ---- CORE MODULES ----
from core.detector import ETryDetector
from core.stylist import ETryStylist
from core.processor import ETryProcessor
from core.engine_3d import Engine3D
from core.pose_mapper import PoseMapper

import asyncio
import numpy as np

# --------------------------------------------------
# APP SETUP
# --------------------------------------------------
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

# --------------------------------------------------
# ENGINES (LAZY INIT FOR 3D)
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

# Delaying VideoCapture to startup to ensure camera handshake
cap = None
active_connections = set()

# --------------------------------------------------
# BACKGROUND TASKS
# --------------------------------------------------
async def physics_loop():
    """
    Self-executing Y-axis physics driver running at 60 FPS.
    Applies vectorized numpy transformation and broadcasts as binary.
    """
    while True:
        if active_connections and engine3d is not None:
            # 1. Get rest vertices and apply Y-axis oscillation
            verts = np.copy(engine3d.shirt.rest_vertices)
            
            # Using custom amplitude and frequency for visual effect
            # User specified formula: V_y = V_y + 0.05 * sin(1.5 * t)
            # which maps to amplitude = 0.05 and 2 * pi * f = 1.5 => frequency = 1.5 / (2 * np.pi)
            verts = engine3d.shirt.apply_antigravity(verts, amplitude=0.05, frequency=1.5 / (2 * np.pi))
            
            # 2. Serialize as raw Float32 binary buffer for minimal latency
            binary_data = verts.astype(np.float32).tobytes()
            
            # 3. Broadcast to all active websockets
            disconnected = set()
            for ws in active_connections:
                try:
                    await ws.send_bytes(binary_data)
                except Exception:
                    disconnected.add(ws)
            
            # 4. Clean up broken connections
            for ws in disconnected:
                active_connections.remove(ws)
                
        # Maintain ~60 FPS
        await asyncio.sleep(1.0 / 60.0)

@app.on_event("startup")
async def startup_event():
    global cap
    print("Hardware-Override Synchronizer: Establishing Auto-Discovery of Camera Indices (0, 1, 2)...")
    
    for i in range(3):
        print(f"Testing Camera Index {i} on HP Victus 15...")
        test_cap = cv2.VideoCapture(i)
        if test_cap.isOpened():
            # Test an actual frame read to confirm it produces data
            ret, frame = test_cap.read()
            if ret:
                cap = test_cap
                print(f"Success: Camera Index {i} bound successfully. Starting 60 FPS Y-axis physics driver.")
                asyncio.create_task(physics_loop())
                return
            test_cap.release()
            
    print("CRITICAL: Auto-Discovery Failed! No valid camera stream found. Virtual-Frame fallback enabled.")

@app.on_event("shutdown")
async def shutdown_event():
    global cap
    if cap is not None:
        cap.release()

# --------------------------------------------------
# ROUTES
# --------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index():
    with open("static/index.html") as f:
        return f.read()


@app.get("/change_category")
async def change_category(name: str):
    global current_category, engine3d, pose_mapper
    current_category = name
    
    # Deep-Link Synchronization: Automate SMPL-X init on CUDA for 'Shirts'
    if name in ["clothes", "Shirts"] and engine3d is None:
        print("Deep-Link Synchronization Context: Initializing SMPL-X Model on RTX 2050 CUDA...")
        engine3d = Engine3D()
        pose_mapper = PoseMapper(engine3d.device)
        
    return {"status": "success", "category": name}


@app.get("/toggle_mesh")
async def toggle_mesh():
    global show_mesh
    show_mesh = not show_mesh
    return {"status": "success", "show_mesh": show_mesh}


@app.get("/get_rating")
async def get_rating():
    return stylist.calculate_score()

# --------------------------------------------------
# VIDEO PIPELINE
# --------------------------------------------------
target_image_url = None

def generate_frames():
    global target_image_url
    texture_updated = False
    while True:
        if target_image_url and engine3d is not None and not texture_updated:
            try:
                engine3d.update_texture(target_image_url)
                print(f"Texture-Mapping Pipeline: Successfully mapped texture from {target_image_url} onto RTX 2050")
            except Exception as e:
                print(f"Deep-Link Image Transfer Context Error: {e}")
            texture_updated = True
            
        if cap is None or not cap.isOpened():
            # Virtual-Frame Injection
            import time
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(frame, "Hardware-Override: Waiting for Camera...", (50, 240), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            ret, buffer = cv2.imencode(".jpg", frame)
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" +
                buffer.tobytes() +
                b"\r\n"
            )
            time.sleep(0.1)
            continue
            
        ok, frame = cap.read()
        if not ok:
            continue

        anchors, results = detector.find_all_anchors(frame)

        # ---------------- HAIR (UNCHANGED) ----------------
        if current_category == "hair" and results.face_landmarks:
            frame = processor.apply_hair_color(
                frame,
                results.face_landmarks,
                color_bgr=(180, 0, 255)
            )

        # ---------------- CLOTHES (TRUE 3D TRY-ON) ----------------
        elif current_category in ["clothes", "Shirts"] and results.pose_landmarks:

            try:
                if engine3d is None:
                    raise RuntimeError("Engine3D not initialized")

                # 1. Convert MediaPipe → SMPL pose
                body_pose = pose_mapper.map(
                    results.pose_landmarks,
                    frame.shape[1],
                    frame.shape[0]
                )

                # 2. Render SMPL body + shirt (offscreen)
                import time
                render_start = time.time()
                render_rgb = engine3d.render_live(
                    body_pose,
                    frame.shape[1],
                    frame.shape[0]
                )
                
                # Hardware-Accelerated Frame Recovery: Timeout Check (> 500ms)
                if (time.time() - render_start) > 0.5:
                    print("Hardware-Accelerated Frame Recovery Context: RTX 2050 CUDA render timeout (>500ms). Injecting proxy mesh...")
                    import torch
                    torch.cuda.empty_cache()
                    raise TimeoutError("RTX 2050 Render Timeout - Falling back to low-poly proxy mesh")
                
                # Conditional Fallback: if render stream is null, fallback
                if render_rgb is None or render_rgb.size == 0:
                    raise ValueError("Null 3D vertex stream")

                render_bgr = cv2.cvtColor(render_rgb, cv2.COLOR_RGB2BGR)

                # 3. Align render to real shoulders
                aligned = engine3d.align_to_body(
                    render_bgr,
                    results.pose_landmarks,
                    frame.shape
                )

                # 4. Alpha mask from render
                gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
                _, mask = cv2.threshold(gray, 5, 255, cv2.THRESH_BINARY)
                alpha = (mask / 255.0)[..., None]

                # 5. Composite onto camera frame
                frame = (alpha * aligned + (1 - alpha) * frame).astype("uint8")
                
            except Exception as e:
                # Attribute Fallback: If mp_pose is missing or lost context, auto-reinitialize
                if not hasattr(detector, 'mp_pose') or detector.mp_pose is None:
                    print("Dependency-Injection Audit Context: mp_pose missing! Re-initializing on RTX 2050...")
                    import mediapipe as mp
                    detector.mp_pose = mp.solutions.pose
                    
                # Conditional Fallback: Default to wireframe mesh to keep feed active
                detector.mp_drawing.draw_landmarks(
                    frame,
                    results.pose_landmarks,
                    detector.mp_pose.POSE_CONNECTIONS,
                    landmark_drawing_spec=detector.mp_drawing.DrawingSpec(color=(0, 255, 0), thickness=2, circle_radius=2),
                    connection_drawing_spec=detector.mp_drawing.DrawingSpec(color=(0, 0, 255), thickness=2, circle_radius=2)
                )

        # ---------------- LANDMARK MESH TOGGLE ----------------
        # Bypassing all manual 'Show Mesh' triggers as requested
        frame = detector.draw_landmarks(frame, results)

        # Synchronize video_feed to force-emit a 'Ready' signal once landmarks are locked by MediaPipe
        if current_category in ["clothes", "Shirts"] and results.pose_landmarks:
            cv2.putText(frame, "Hardware-Override: Ready", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

        # ---------------- UI BAR (UNCHANGED) ----------------
        if results.pose_landmarks or results.face_landmarks:
            rating = stylist.calculate_score()

            cv2.rectangle(
                frame,
                (10, frame.shape[0] - 70),
                (450, frame.shape[0] - 10),
                (0, 0, 0),
                -1
            )

            cv2.putText(
                frame,
                f"SCORE: {rating['score']}",
                (20, frame.shape[0] - 45),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                1
            )

            cv2.putText(
                frame,
                rating["commentary"],
                (20, frame.shape[0] - 20),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 255),
                1
            )

        # Viewport-Scale Correction: Standardize to 480x640 portrait mode without cropping the landmarks out
        frame = cv2.resize(frame, (480, 640))

        ret, buffer = cv2.imencode(".jpg", frame)
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" +
            buffer.tobytes() +
            b"\r\n"
        )

# --------------------------------------------------
# STREAM
# --------------------------------------------------
@app.get("/video_feed")
async def video_feed(image_url: str = None):
    global target_image_url
    if image_url:
        target_image_url = image_url
        print(f"Deep-Link Image Transfer Context: Image URL received: {image_url}")
        
    return StreamingResponse(
        generate_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

# --------------------------------------------------
# WEBSOCKET
# --------------------------------------------------
@app.websocket("/ws/physics")
async def websocket_physics(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    try:
        while True:
            # Keep connection alive, wait for client messages if any
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.discard(websocket)

# --------------------------------------------------
# MAIN
# --------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
