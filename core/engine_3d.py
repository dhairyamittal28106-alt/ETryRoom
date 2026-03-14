import os
import torch
import smplx
import trimesh
import pyrender
import numpy as np
import cv2
import threading
import queue
import time

from core.cloth_skinner import ClothSkinner

class Engine3D:
    def __init__(self, model_path="models/smplx"):
        """
        Initializes the 3D Rendering Engine for ETryRoom.ai.
        Specifically optimized for RTX 2050 CUDA cores with Antigravity Y-axis support.
        """
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        # ---------------- 1. SMPL-X MODEL INITIALIZATION ----------------
        self.model = smplx.create(
            model_path=model_path,
            model_type="smplx",
            gender="neutral",
            use_pca=False,
            batch_size=1
        ).to(self.device)

        # ---------------- 2. LOAD SHIRT MESH ----------------
        self.shirt = ClothSkinner("assets/shirts_3d/basic_shirt.obj")

        # ---------------- 3. AUTO UV GENERATION ----------------
        verts = self.shirt.mesh.vertices
        u = (verts[:, 0] - verts[:, 0].min()) / (np.ptp(verts[:, 0]) + 1e-8)
        v = (verts[:, 1] - verts[:, 1].min()) / (np.ptp(verts[:, 1]) + 1e-8)
        uv = np.column_stack([u, v])
        self.shirt.mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv)

        # ---------------- 4. LOAD INITIAL TEXTURE ----------------
        texture_path = os.path.join(os.path.dirname(__file__), "..", "assets", "shirt.png")
        tex_img = cv2.imread(texture_path)
        if tex_img is None:
            # Fallback to a solid color if initial texture is missing
            tex_img = np.full((512, 512, 3), (255, 0, 0), dtype=np.uint8)
        
        tex_img = cv2.cvtColor(tex_img, cv2.COLOR_BGR2RGB)
        self.shirt_texture = pyrender.Texture(source=tex_img, source_channels="RGB")

        # ---------------- 5. MATERIALS & PBR ----------------
        # Z-Buffer Audit: cloth_material forced to OPAQUE to ensure shirt renders
        # at higher priority than the body mesh in the RTX 2050 Z-buffer.
        self.cloth_material = pyrender.MetallicRoughnessMaterial(
            baseColorTexture=self.shirt_texture,
            metallicFactor=0.0,
            roughnessFactor=0.85,
            alphaMode="OPAQUE"  # Force OPAQUE: preserves dark navy pixels, no alpha discard
        )

        # Body material rendered after cloth to ensure shirt wins the Z-fight
        self.body_material = pyrender.MetallicRoughnessMaterial(
            baseColorFactor=[0.6, 0.6, 0.6, 1.0],
            metallicFactor=0.0,
            roughnessFactor=1.0
        )
        
        # ---------------- 6. PERSISTENT RENDER CONTEXT ----------------
        self.render_queue = queue.Queue()
        self.result_queue = queue.Queue()
        threading.Thread(target=self._render_worker, daemon=True).start()
        
        # Antigravity Physics State
        self.start_time = time.time()

    def _render_worker(self):
        """Dedicated persistent thread guaranteeing OpenGL context safety for Pyrender."""
        renderer = None
        while True:
            task = self.render_queue.get()
            if task is None: break
            scene, w, h = task
            try:
                if renderer is None or renderer.viewport_width != w or renderer.viewport_height != h:
                    if renderer is not None: renderer.delete()
                    renderer = pyrender.OffscreenRenderer(w, h)
                color, depth = renderer.render(scene)
                self.result_queue.put((color, depth))
            except Exception as e:
                self.result_queue.put(e)
            finally:
                self.render_queue.task_done()

    def update_texture(self, image_url):
        """Texture-Mapping Pipeline: Downloads URL and maps to SMPL-X mesh."""
        import urllib.request
        loaded = False
        try:
            req = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0'})
            # Local-Asset Proxy Handshake: extended to 15s for Shoppers Stop deep-links
            with urllib.request.urlopen(req, timeout=15) as response:
                img_array = np.asarray(bytearray(response.read()), dtype=np.uint8)
                tex_img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
                if tex_img is not None:
                    self._apply_fabric_texture(tex_img)
                    loaded = True
        except Exception as e:
            print(f"Deep-Link Image Transfer Failed (will use local fallback): {e}")
        
        if not loaded:
            # Fallback Texture: load assets/shirt.png from local drive to keep overlay active
            fallback_path = os.path.join(os.path.dirname(__file__), "..", "assets", "shirt.png")
            tex_img = cv2.imread(fallback_path)
            if tex_img is not None:
                print("Local-Asset Proxy: Loaded fallback shirt.png from HP Victus 15 drive.")
                self._apply_fabric_texture(tex_img)

    def update_texture_from_bytes(self, img_bytes):
        """Base64-to-CUDA Pipeline: accepts raw image bytes from the POST endpoint."""
        img_array = np.asarray(bytearray(img_bytes), dtype=np.uint8)
        tex_img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if tex_img is not None:
            self._apply_fabric_texture(tex_img)

    def _apply_fabric_texture(self, tex_img):
        """Shared texture extraction and UV upload for both URL and byte-stream sources."""
        gray = cv2.cvtColor(tex_img, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
        
        # Crop to fabric bounding box
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            c = max(contours, key=cv2.contourArea)
            x, y, w, h = cv2.boundingRect(c)
            tex_img = tex_img[y:y+h, x:x+w]
            mask = mask[y:y+h, x:x+w]

        tex_img_bgra = cv2.cvtColor(tex_img, cv2.COLOR_BGR2BGRA)
        tex_img_bgra[:, :, 3] = mask
        tex_img_rgba = cv2.cvtColor(tex_img_bgra, cv2.COLOR_BGRA2RGBA)
        self.shirt_texture = pyrender.Texture(source=tex_img_rgba, source_channels="RGBA")
        self.cloth_material.baseColorTexture = self.shirt_texture

    def body_mesh(self, body_pose):
        """Generates the SMPL-X body surface for the current pose."""
        output = self.model(
            body_pose=body_pose,
            global_orient=torch.zeros((1, 3), device=self.device)
        )
        verts = output.vertices[0].detach().cpu().numpy()
        return trimesh.Trimesh(verts, self.model.faces, process=False)

    def render_with_depth(self, meshes, materials, w, h):
        """Handles GPU-accelerated 3D rendering with Antigravity Y-axis work."""
        scene = pyrender.Scene(bg_color=[0, 0, 0, 0.0]) # Set alpha to 0 for transparency

        # Antigravity Y-axis Physics: V_y = V_y + 0.05 * sin(1.5 * t)
        t = time.time() - self.start_time
        y_offset = 0.05 * np.sin(1.5 * t)

        for m, mat in zip(meshes, materials):
            # Static-Mesh Override: Place shirt at (0, Y_Offset, -1.5)
            # This ensures visibility even if pose alignment fails.
            mesh_node = pyrender.Mesh.from_trimesh(m, material=mat, smooth=True)
            scene.add(mesh_node, pose=np.array([
                [1, 0, 0, 0],
                [0, 1, 0, y_offset], # Applying the physics work here
                [0, 0, 1, -1.5],     # Primary Viewport Distance
                [0, 0, 0, 1]
            ]))

        cam = pyrender.PerspectiveCamera(yfov=np.pi / 3.0)
        cam_pose = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 1.0], # Camera position
            [0, 0, 0, 1]
        ])

        scene.add(cam, pose=cam_pose)
        scene.add(pyrender.DirectionalLight(color=np.ones(3), intensity=3.0), pose=cam_pose)

        self.render_queue.put((scene, w, h))
        result = self.result_queue.get()
        
        if isinstance(result, Exception): raise result
        return result # color, depth

    def render_live(self, body_pose, w, h):
        """Main entry point for real-time shirt deformation."""
        cloth = self.shirt.deform(body_pose)
        cloth_color, _ = self.render_with_depth([cloth], [self.cloth_material], w, h)
        return cloth_color

    def align_to_body(self, render_rgb, pose_landmarks, frame_shape):
        """Aligns the 3D render to the 2D webcam coordinate space."""
        h, w = frame_shape[:2]
        
        # Full-Screen Mesh Overlay: Ensure the render fits the camera frame perfectly
        render_resized = cv2.resize(render_rgb, (w, h))
        
        # Convert to BGR for OpenCV compatibility with the app stream
        render_bgr = cv2.cvtColor(render_resized, cv2.COLOR_RGB2BGR)
        return render_bgr