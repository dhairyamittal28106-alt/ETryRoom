import cv2
import uvicorn
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

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
app.mount("/static", StaticFiles(directory="static"), name="static")

# --------------------------------------------------
# ENGINES (SINGLE SOURCE OF TRUTH)
# --------------------------------------------------
detector = ETryDetector()
stylist = ETryStylist()
processor = ETryProcessor()
engine3d = Engine3D()
pose_mapper = PoseMapper(engine3d.device)

# --------------------------------------------------
# GLOBAL STATE
# --------------------------------------------------
current_category = "clothes"
show_mesh = True
cap = cv2.VideoCapture(0)

# --------------------------------------------------
# ROUTES
# --------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index():
    with open("static/index.html") as f:
        return f.read()


@app.get("/change_category")
async def change_category(name: str):
    global current_category
    current_category = name
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
def generate_frames():
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        anchors, results = detector.find_all_anchors(frame)

        # ---------------- HAIR (UNCHANGED) ----------------
        if current_category == "hair" and results.face_landmarks:
            frame = processor.apply_hair_color(
                frame,
                results.face_landmarks,
                color_bgr=(180, 0, 255)
            )

        # ---------------- CLOTHES (TRUE 3D TRY-ON) ----------------
        elif current_category == "clothes" and results.pose_landmarks:

            # 1. Convert MediaPipe → SMPL pose
            body_pose = pose_mapper.map(
                results.pose_landmarks,
                frame.shape[1],
                frame.shape[0]
            )

            # 2. Render SMPL body + shirt (offscreen)
            render_rgb = engine3d.render_live(
                body_pose,
                frame.shape[1],
                frame.shape[0]
            )
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

        # ---------------- LANDMARK MESH TOGGLE ----------------
        if show_mesh:
            frame = detector.draw_landmarks(frame, results)

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
async def video_feed():
    return StreamingResponse(
        generate_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

# --------------------------------------------------
# MAIN
# --------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
