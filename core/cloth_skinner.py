import numpy as np
import time
import trimesh
import torch
import cv2
import os

class ClothSkinner:
    def __init__(self, obj_path):
        """
        Initializes the 3D shirt skinner with vectorized deformation logic.
        """
        # 1. Load mesh safely
        if not os.path.exists(obj_path):
            raise FileNotFoundError(f"3D Mesh not found at {obj_path}")
            
        self.mesh = trimesh.load(obj_path, process=False)
        self.rest_vertices = self.mesh.vertices.copy().astype(np.float32)

        # 2. AUTO UV GENERATION (if missing)
        if not hasattr(self.mesh.visual, "uv") or self.mesh.visual.uv is None:
            verts = self.rest_vertices
            u = (verts[:, 0] - verts[:, 0].min()) / (np.ptp(verts[:, 0]) + 1e-8)
            v = (verts[:, 1] - verts[:, 1].min()) / (np.ptp(verts[:, 1]) + 1e-8)
            uv = np.column_stack([u, v])
            self.mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv)

        # 3. LOAD TEXTURE (shirt.png)
        # Assuming the same structure: assets/shirt.png
        texture_path = "assets/shirt.png"
        texture = cv2.imread(texture_path)

        if texture is not None:
            texture = cv2.cvtColor(texture, cv2.COLOR_BGR2RGB)
            self.mesh.visual.material.image = texture

        # 4. PRECOMPUTE WEIGHTS (Linear Blend Skinning)
        # t=0 at bottom (pelvis), t=1 at top (shoulders)
        y = self.rest_vertices[:, 1]
        y_min, y_max = y.min(), y.max()
        t = (y - y_min) / (y_max - y_min + 1e-8)

        # Torso stronger influence at bottom, shoulders stronger at top
        self.w_pelvis = np.clip(1.0 - t * 1.5, 0.0, 1.0)
        self.w_shoulders = 1.0 - self.w_pelvis
        
        # Reshape weights for broadcasting (N, 1, 1) to multiply with (3, 3) matrices
        self.w_pelvis_v = self.w_pelvis[:, np.newaxis, np.newaxis]
        self.w_shoulders_v = self.w_shoulders[:, np.newaxis, np.newaxis]
        
        # 5. PRECOMPUTE ANTIGRAVITY DAMPING & TORSO MASK
        # Filter for torso vertices only: exclude outer sleeves based on X coordinate threshold
        x = self.rest_vertices[:, 0]
        x_range = np.max(np.abs(x))
        self.torso_mask = np.abs(x) < (x_range * 0.7)
        
        # We use (1.0 - t) so damping is 0.0 at top (stable) and 1.0 at bottom.
        # Squared falloff looks more realistic for cloth hanging.
        self.antigravity_damping = np.square(1.0 - t) * self.torso_mask

    def axis_angle_to_matrix(self, aa):
        """Vectorized conversion of axis-angle to 3x3 rotation matrix."""
        theta = np.linalg.norm(aa)
        if theta < 1e-8:
            return np.eye(3)

        axis = aa / theta
        x, y, z = axis
        c = np.cos(theta)
        s = np.sin(theta)
        t = 1 - c

        return np.array([
            [t*x*x + c,   t*x*y - z*s, t*x*z + y*s],
            [t*x*y + z*s, t*y*y + c,   t*y*z - x*s],
            [t*x*z - y*s, t*y*z + x*s, t*z*z + c]
        ])

    def apply_antigravity(self, vertices, amplitude=0.005, frequency=2.0):
        """
        Simulates micro-gravity fabric float with vertical oscillation.
        Optimized for 60 FPS on RTX 2050 (vectorized NumPy).
        """
        # Time-based sine wave running continuously
        t_val = time.time()
        
        # Calculate base vertical shift (vectorized)
        y_shift = amplitude * np.sin(2 * np.pi * frequency * t_val)
        
        # Apply damping: affects only isolated torso vertices with bottom-heavy falloff
        vertices[:, 1] += y_shift * self.antigravity_damping
        
        return vertices

    def deform(self, body_pose):
        """
        Vectorized Linear Blend Skinning (LBS).
        Moves the shirt vertices based on pelvis and shoulder rotations.
        """
        # 1. Extract rotations from SMPL-style pose vector
        pose_np = body_pose.detach().cpu().numpy()[0]

        # Physics Interpolator optimization: 
        # Caches the heavy skinning computation and only updates Y-axis at 60Hz
        if not hasattr(self, 'last_pose') or not np.array_equal(self.last_pose, pose_np):
            R_pelvis = self.axis_angle_to_matrix(pose_np[0:3])
            R_l_shoulder = self.axis_angle_to_matrix(pose_np[36:39]) # SMPL Left Shoulder
            R_r_shoulder = self.axis_angle_to_matrix(pose_np[39:42]) # SMPL Right Shoulder
            
            # Average shoulder rotation for simplified torso bending
            R_shoulders = (R_l_shoulder + R_r_shoulder) * 0.5

            # 2. Batch calculate the Per-Vertex Rotation Matrices (N, 3, 3)
            # Each vertex gets a blended rotation based on its Y-height
            R_vertex = (self.w_pelvis_v * R_pelvis) + (self.w_shoulders_v * R_shoulders)

            # 3. Vectorized Vertex Transformation using Einstein Summation
            self.skinned_verts = np.einsum('nij,nj->ni', R_vertex, self.rest_vertices)
            self.last_pose = pose_np.copy()
            self.compute_normals = True

        new_verts = self.skinned_verts.copy()
        
        # 4. Apply Antigravity Physics (Vectorized) logic running at 60Hz
        # Static-Mesh Override Physics: V_y = V_y + 0.05 * sin(1.5 * t)
        new_verts = self.apply_antigravity(new_verts, amplitude=0.05, frequency=1.5 / (2 * np.pi))

        # 5. Update the mesh for the renderer
        self.mesh.vertices = new_verts
        
        # Only recompute normals when the skinning changes to save render time
        if getattr(self, 'compute_normals', True):
            self.mesh.fix_normals()
            self.compute_normals = False

        return self.mesh