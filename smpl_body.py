import importlib
import os
import torch


def _optional_import(name):
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            f"Optional dependency '{name}' is required for SMPL export. "
            "Install it with: pip install -r requirements.txt"
        ) from exc

# Use GPU when available, fall back to CPU when not
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODEL_PATH = "models/smpl"

def generate_base_mesh():
    if not os.path.exists(os.path.join(MODEL_PATH, "SMPL_NEUTRAL.pkl")):
        print("ERROR: SMPL_NEUTRAL.pkl is missing from models/smpl/")
        return

    # Initialize the 3D Human Model
    smplx = _optional_import("smplx")
    trimesh = _optional_import("trimesh")
    model = smplx.create(MODEL_PATH, model_type="smpl", gender="neutral").to(DEVICE)

    # Generate a neutral standing pose at origin (0,0,0)
    output = model(body_pose=torch.zeros((1, 69), device=DEVICE))
    vertices = output.vertices[0].detach().cpu().numpy()

    # Save as a real 3D Object
    mesh = trimesh.Trimesh(vertices, model.faces)
    mesh.export("neutral_body.obj")
    print("SUCCESS: neutral_body.obj created!")

if __name__ == "__main__":
    generate_base_mesh()