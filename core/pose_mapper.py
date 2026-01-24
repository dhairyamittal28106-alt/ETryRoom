import numpy as np
import torch


class PoseMapper:
    def __init__(self, device, smooth=0.85):
        self.device = device
        self.smooth = smooth  # EMA smoothing factor

        self.prev_body_pose = torch.zeros((1, 63), device=device)

    # ------------------------
    # Utility math
    # ------------------------
    def _vec(self, a, b):
        v = np.array(b) - np.array(a)
        n = np.linalg.norm(v) + 1e-8
        return v / n

    def _axis_angle(self, v1, v2):
        axis = np.cross(v1, v2)
        sin = np.linalg.norm(axis)
        cos = np.clip(np.dot(v1, v2), -1.0, 1.0)
        if sin < 1e-6:
            return np.zeros(3)
        axis = axis / (sin + 1e-8)
        angle = np.arctan2(sin, cos)
        return axis * angle

    def _smooth(self, current):
        smoothed = self.smooth * self.prev_body_pose + (1 - self.smooth) * current
        self.prev_body_pose = smoothed.detach()
        return smoothed

    # ------------------------
    # Main mapping
    # ------------------------
    def map(self, mp_landmarks, w, h):
        body = torch.zeros((1, 63), device=self.device)

        if mp_landmarks is None:
            return self._smooth(body)

        lm = mp_landmarks.landmark

        def p(i):
            return np.array([lm[i].x * w, lm[i].y * h, lm[i].z])

        # MediaPipe indices
        LS, RS = 11, 12
        LE, RE = 13, 14
        LH, RH = 23, 24

        # Points
        ls, rs = p(LS), p(RS)
        le, re = p(LE), p(RE)
        lh, rh = p(LH), p(RH)

        # ------------------------
        # Torso orientation (stable)
        # ------------------------
        torso_up = self._vec((lh + rh) * 0.5, (ls + rs) * 0.5)
        world_up = np.array([0, -1, 0])
        torso_rot = self._axis_angle(world_up, torso_up)

        # ------------------------
        # Arms (clamped)
        # ------------------------
        l_arm = self._axis_angle(self._vec(ls, lh), self._vec(ls, le))
        r_arm = self._axis_angle(self._vec(rs, rh), self._vec(rs, re))

        l_arm = np.clip(l_arm, -1.2, 1.2)
        r_arm = np.clip(r_arm, -1.2, 1.2)

        # ------------------------
        # Assign to SMPL-X body
        # ------------------------
        body[0, 0:3] = torch.tensor(torso_rot, device=self.device)     # pelvis
        body[0, 15:18] = torch.tensor(l_arm, device=self.device)       # left shoulder
        body[0, 18:21] = torch.tensor(r_arm, device=self.device)       # right shoulder

        return self._smooth(body)
