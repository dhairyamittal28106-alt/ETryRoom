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
        
        if not os.path.exists(obj_path):
            raise FileNotFoundError(f"3D Mesh not found at {obj_path}")
            
        self.mesh = trimesh.load(obj_path, process=False)
        self.rest_vertices = self.mesh.vertices.copy().astype(np.float32)

        
        if not hasattr(self.mesh.visual, "uv") or self.mesh.visual.uv is None:
            verts = self.rest_vertices
            u = (verts[:, 0] - verts[:, 0].min()) / (np.ptp(verts[:, 0]) + 1e-8)
            v = (verts[:, 1] - verts[:, 1].min()) / (np.ptp(verts[:, 1]) + 1e-8)
            uv = np.column_stack([u, v])
            self.mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv)

        
        
        texture_path = "assets/shirt.png"
        texture = cv2.imread(texture_path)

        if texture is not None:
            texture = cv2.cvtColor(texture, cv2.COLOR_BGR2RGB)
            self.mesh.visual.material.image = texture

        
        
        y = self.rest_vertices[:, 1]
        y_min, y_max = y.min(), y.max()
        t = (y - y_min) / (y_max - y_min + 1e-8)

        
        self.w_pelvis = np.clip(1.0 - t * 1.5, 0.0, 1.0)
        self.w_shoulders = 1.0 - self.w_pelvis
        
        
        self.w_pelvis_v = self.w_pelvis[:, np.newaxis, np.newaxis]
        self.w_shoulders_v = self.w_shoulders[:, np.newaxis, np.newaxis]
        
        
        
        x = self.rest_vertices[:, 0]
        x_range = np.max(np.abs(x))
        self.torso_mask = np.abs(x) < (x_range * 0.7)
        
        
        
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
        
        t_val = time.time()
        
        
        y_shift = amplitude * np.sin(2 * np.pi * frequency * t_val)
        
        
        vertices[:, 1] += y_shift * self.antigravity_damping
        
        return vertices

    def deform(self, body_pose):
        """
        Vectorized Linear Blend Skinning (LBS).
        Moves the shirt vertices based on pelvis and shoulder rotations.
        """
        
        pose_np = body_pose.detach().cpu().numpy()[0]

        
        
        if not hasattr(self, 'last_pose') or not np.array_equal(self.last_pose, pose_np):
            R_pelvis = self.axis_angle_to_matrix(pose_np[0:3])
            R_l_shoulder = self.axis_angle_to_matrix(pose_np[36:39]) 
            R_r_shoulder = self.axis_angle_to_matrix(pose_np[39:42]) 
            
            
            R_shoulders = (R_l_shoulder + R_r_shoulder) * 0.5

            
            
            R_vertex = (self.w_pelvis_v * R_pelvis) + (self.w_shoulders_v * R_shoulders)

            
            self.skinned_verts = np.einsum('nij,nj->ni', R_vertex, self.rest_vertices)
            self.last_pose = pose_np.copy()
            self.compute_normals = True

        new_verts = self.skinned_verts.copy()
        
        
        
        new_verts = self.apply_antigravity(new_verts, amplitude=0.05, frequency=1.5 / (2 * np.pi))

        
        self.mesh.vertices = new_verts
        
        
        if getattr(self, 'compute_normals', True):
            self.mesh.fix_normals()
            self.compute_normals = False

        return self.mesh