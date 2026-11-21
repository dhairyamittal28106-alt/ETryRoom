import sys
import os


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT_DIR)


import cv2
import mediapipe as mp

from core.engine_3d import Engine3D
from core.pose_mapper import PoseMapper


def main():
    cap = cv2.VideoCapture(0)

    mp_pose = mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False
    )

    engine = Engine3D()
    mapper = PoseMapper(engine.device)

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = mp_pose.process(rgb)

        body_pose = mapper.map(
            result.pose_landmarks,
            frame.shape[1],
            frame.shape[0]
        )

        render = engine.render_live(body_pose)
        render = cv2.cvtColor(render, cv2.COLOR_RGB2BGR)

        combined = cv2.hconcat([frame, render])
        cv2.imshow("Phase 2 | Webcam → SMPL-X", combined)

        if cv2.waitKey(1) & 0xFF == 27:
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
