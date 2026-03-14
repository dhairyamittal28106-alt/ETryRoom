import os
import torch
import smplx
import trimesh
import pyrender
import numpy as np
import cv2

from core.cloth_skinner import ClothSkinner

class Engine3D:
    def __init__(self, model_path="models/smplx"):
        """
        Initializes the 3D Rendering Engine for ETryRoom.ai.
        Specifically optimized for RTX 2050 CUDA cores.
        """
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        # ---------------- 1. SMPL-X MODEL INITIALIZATION ----------------
        # Loads the parametric body model with 6,890 vertices.
        self.model = smplx.create(
            model_path=model_path,
            model_type="smplx",
            gender="neutral",
            use_pca=False,
            batch_size=1
        ).to(self.device)

        # ---------------- 2. LOAD SHIRT MESH ----------------
        # Loads the .obj shirt geometry that will deform with the body.
        self.shirt = ClothSkinner("assets/shirts_3d/basic_shirt.obj")

        # ---------------- 3. AUTO UV GENERATION ----------------
        # Maps the 2D shirt.png onto the 3D shirt.obj vertices.
        verts = self.shirt.mesh.vertices
        u = (verts[:, 0] - verts[:, 0].min()) / (np.ptp(verts[:, 0]) + 1e-8)
        v = (verts[:, 1] - verts[:, 1].min()) / (np.ptp(verts[:, 1]) + 1e-8)

        uv = np.column_stack([u, v])
        self.shirt.mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv)

        # ---------------- 4. LOAD SHIRT TEXTURE ----------------
        texture_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "assets",
            "shirt.png"
        )

        tex_img = cv2.imread(texture_path)
        if tex_img is None:
            raise RuntimeError(f"FAILED TO LOAD shirt.png at {texture_path}")

        tex_img = cv2.cvtColor(tex_img, cv2.COLOR_BGR2RGB)
        self.shirt_texture = pyrender.Texture(
            source=tex_img,
            source_channels="RGB"
        )

        # ---------------- 5. MATERIALS & PBR ----------------
        self.cloth_material = pyrender.MetallicRoughnessMaterial(
            baseColorTexture=self.shirt_texture,
            metallicFactor=0.0,
            roughnessFactor=0.85
        )

        self.body_material = pyrender.MetallicRoughnessMaterial(
            baseColorFactor=[0.6, 0.6, 0.6, 1.0],
            metallicFactor=0.0,
            roughnessFactor=1.0
        )

    def update_texture(self, image_url):
        """Texture-Mapping Pipeline: Downloads an external URL and maps it to the 6,890 SMPL-X vertices."""
        import urllib.request
        try:
            req = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=5) as response:
                img_array = np.asarray(bytearray(response.read()), dtype=np.uint8)
                tex_img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
                if tex_img is not None:
                    tex_img = cv2.cvtColor(tex_img, cv2.COLOR_BGR2RGB)
                    self.shirt_texture = pyrender.Texture(
                        source=tex_img,
                        source_channels="RGB"
                    )
                    self.cloth_material.baseColorTexture = self.shirt_texture
        except Exception as e:
            raise RuntimeError(f"Deep-Link Image Transfer Failed: {e}")

    def body_mesh(self, body_pose):
        """Generates the SMPL-X body surface for the current pose."""
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

    def render_with_depth(self, meshes, materials, w, h):
        """Handles GPU-accelerated 3D rendering with Z-buffering."""
        scene = pyrender.Scene(bg_color=[0, 0, 0, 0])

        for m, mat in zip(meshes, materials):
            scene.add(
                pyrender.Mesh.from_trimesh(m, material=mat, smooth=True)
            )

        cam = pyrender.PerspectiveCamera(yfov=np.pi / 3.2)
        cam_pose = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 2.7],
            [0, 0, 0, 1]
        ])

        scene.add(cam, pose=cam_pose)
        scene.add(pyrender.DirectionalLight(color=np.ones(3), intensity=2.0), pose=cam_pose)

        r = pyrender.OffscreenRenderer(w, h)
        color, depth = r.render(scene)
        r.delete()

        return color, depth

    def render_live(self, body_pose, w, h):
        """Main entry point for real-time shirt deformation."""
        # Deforms the 3D cloth based on the new SMPL pose
        cloth = self.shirt.deform(body_pose)
        cloth_color, cloth_depth = self.render_with_depth(
            [cloth], [self.cloth_material], w, h
        )
        return cloth_color

    def align_to_body(self, render_bgr, pose_landmarks, frame_shape):
        """Aligns the 3D render to the 2D webcam coordinate space."""
        h, w = frame_shape[:2]
        lm = pose_landmarks.landmark
    
        ls = lm[11]   # left shoulder
        rs = lm[12]   # right shoulder
        lh = lm[23]   # left hip
        rh = lm[24]   # right hip

        # Calculate shoulder center for anchoring the shirt
        cx = int((ls.x + rs.x) * 0.5 * w)
        cy = int((ls.y + rs.y) * 0.5 * h)

        # Dynamic scaling based on torso height
        hip_y = int((lh.y + rh.y) * 0.5 * h)
        torso_height = abs(hip_y - cy)
        scale = np.clip(torso_height / 350.0, 0.9, 1.6)

        render = cv2.resize(render_bgr, None, fx=scale, fy=scale)
        rhh, rww = render.shape[:2]

        # Offset shirt top to sit correctly on neck line
        x1 = int(cx - rww / 2)
        y1 = int(cy - rhh * 0.08)
        x2, y2 = x1 + rww, y1 + rhh
        
        out = np.zeros((h, w, 3), dtype=np.uint8)

        # Clipping safety logic for edge of screen
        x1c, y1c = max(0, x1), max(0, y1)
        x2c, y2c = min(w, x2), min(h, y2)

        out[y1c:y2c, x1c:x2c] = render[
            (y1c - y1):(y2c - y1),
            (x1c - x1):(x2c - x1)
        ]

        return out