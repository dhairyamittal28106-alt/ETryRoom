import sys
import os

# Add project root to PYTHONPATH
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import cv2
from core.engine_3d import Engine3D


def main():
    engine = Engine3D()

    print("Generating neutral SMPL body...")
    mesh = engine.get_neutral_mesh()

    print("Rendering body...")
    color, depth = engine.render_mesh(mesh)

    cv2.imwrite("tests/phase1_body_color.png", color)
    cv2.imwrite(
        "tests/phase1_body_depth.png",
        (depth / depth.max() * 255).astype("uint8")
    )

    print("✅ Phase 1 complete.")
    print("Saved:")
    print(" - tests/phase1_body_color.png")
    print(" - tests/phase1_body_depth.png")


if __name__ == "__main__":
    main()
