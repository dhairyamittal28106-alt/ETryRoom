import numpy as np
import trimesh
import torch


class ClothSkinner:
    def __init__(self, obj_path):
        self.mesh = trimesh.load(obj_path, process=False)
        self.rest_vertices = self.mesh.vertices.copy()

        # Precompute weights based on height (Y axis)
        y = self.rest_vertices[:, 1]
        y_min, y_max = y.min(), y.max()
        t = (y - y_min) / (y_max - y_min + 1e-8)

        # Weights: torso + shoulders
        self.w_pelvis = np.clip(1.0 - t * 1.5, 0.2, 1.0)
        self.w_shoulders = 1.0 - self.w_pelvis

    def axis_angle_to_matrix(self, aa):
        theta = np.linalg.norm(aa)
        if theta < 1e-8:
            return np.eye(3)

        axis = aa / theta
        x, y, z = axis
        c = np.cos(theta)
        s = np.sin(theta)

        return np.array([
            [c + x*x*(1-c),     x*y*(1-c)-z*s, x*z*(1-c)+y*s],
            [y*x*(1-c)+z*s, c + y*y*(1-c),     y*z*(1-c)-x*s],
            [z*x*(1-c)-y*s, z*y*(1-c)+x*s, c + z*z*(1-c)]
        ])

    def deform(self, body_pose):
        body_pose = body_pose.detach().cpu().numpy()[0]

        pelvis_rot = self.axis_angle_to_matrix(body_pose[0:3])
        l_shoulder_rot = self.axis_angle_to_matrix(body_pose[15:18])
        r_shoulder_rot = self.axis_angle_to_matrix(body_pose[18:21])

        verts = self.rest_vertices.copy()

        for i, v in enumerate(verts):
            R = (
                self.w_pelvis[i] * pelvis_rot +
                self.w_shoulders[i] * 0.5 * (l_shoulder_rot + r_shoulder_rot)
            )
            verts[i] = R @ v

        self.mesh.vertices = verts
        return self.mesh
