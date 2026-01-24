import torch
import smplx
import trimesh
import pyrender
import numpy as np
import cv2

from core.cloth_skinner import ClothSkinner


class Engine3D:
    def __init__(self, model_path="models/smplx"):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        self.model = smplx.create(
            model_path=model_path,
            model_type="smplx",
            gender="neutral",
            use_pca=False,
            batch_size=1
        ).to(self.device)

        self.shirt = ClothSkinner("assets/shirts_3d/basic_shirt.obj")

    # ---------------- BODY ----------------
    def body_mesh(self, body_pose):
        output = self.model(
            betas=torch.zeros((1, 10), device=self.device),
            body_pose=body_pose,
            global_orient=torch.zeros((1, 3), device=self.device),
            left_hand_pose=torch.zeros((1, 45), device=self.device),
            right_hand_pose=torch.zeros((1, 45), device=self.device),
            expression=torch.zeros((1, 10), device=self.device),
            jaw_pose=torch.zeros((1, 3), device=self.device),
            leye_pose=torch.zeros((1, 3), device=self.device),
            reye_pose=torch.zeros((1, 3), device=self.device)
        )

        verts = output.vertices[0].detach().cpu().numpy()
        faces = self.model.faces
        return trimesh.Trimesh(verts, faces, process=False)

    # ---------------- RENDER ----------------
    def render_with_depth(self, meshes, w, h):
        scene = pyrender.Scene(bg_color=[0, 0, 0, 0])

        for m in meshes:
            scene.add(pyrender.Mesh.from_trimesh(m, smooth=True))

        cam = pyrender.PerspectiveCamera(yfov=np.pi / 3)
        cam_pose = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 2.5],
            [0, 0, 0, 1]
        ])
        scene.add(cam, pose=cam_pose)

        light = pyrender.DirectionalLight(color=np.ones(3), intensity=3.0)
        scene.add(light, pose=cam_pose)

        r = pyrender.OffscreenRenderer(w, h)
        color, depth = r.render(scene)
        r.delete()

        return color, depth

    # ---------------- LIVE TRY-ON ----------------
    def render_live(self, body_pose, w, h):
        body = self.body_mesh(body_pose)
        cloth = self.shirt.deform(body_pose)

        body_color, body_depth = self.render_with_depth([body], w, h)
        cloth_color, cloth_depth = self.render_with_depth([cloth], w, h)

        final = body_color.copy()

        mask = (cloth_depth > 0) & (
            (body_depth == 0) | (cloth_depth < body_depth)
        )

        for c in range(3):
            final[:, :, c][mask] = cloth_color[:, :, c][mask]

        return final

    # ---------------- CAMERA COMPOSITING ----------------
    def composite_on_camera(self, camera_bgr, body_pose):
        h, w = camera_bgr.shape[:2]

        render_rgb = self.render_live(body_pose, w, h)
        render_bgr = cv2.cvtColor(render_rgb, cv2.COLOR_RGB2BGR)

        gray = cv2.cvtColor(render_bgr, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 5, 255, cv2.THRESH_BINARY)
        mask = cv2.GaussianBlur(mask, (7, 7), 0)
        alpha = (mask / 255.0)[..., None]

        return (alpha * render_bgr + (1 - alpha) * camera_bgr).astype("uint8")

    # ---------------- ALIGN TO BODY ----------------
    def align_to_body(self, render_bgr, pose_landmarks, frame_shape):
        h, w = frame_shape[:2]

        lm = pose_landmarks.landmark
        ls = lm[11]  # left shoulder
        rs = lm[12]  # right shoulder

        # Shoulder center
        cx = int((ls.x + rs.x) * 0.5 * w)
        cy = int((ls.y + rs.y) * 0.5 * h)

        # Shoulder width → scale
        shoulder_dist = np.sqrt(
            ((ls.x - rs.x) * w) ** 2 +
            ((ls.y - rs.y) * h) ** 2
        )

        scale = np.clip(shoulder_dist / 180.0, 0.6, 1.4)

        render = cv2.resize(
            render_bgr,
            None,
            fx=scale,
            fy=scale,
            interpolation=cv2.INTER_LINEAR
        )

        rh, rw = render.shape[:2]

        x1 = max(cx - rw // 2, 0)
        y1 = max(cy - int(rh * 0.15), 0)
        x2 = min(x1 + rw, w)
        y2 = min(y1 + rh, h)

        out = np.zeros((h, w, 3), dtype=np.uint8)
        out[y1:y2, x1:x2] = render[0:y2 - y1, 0:x2 - x1]

        return out
