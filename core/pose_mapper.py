import numpy as np
import torch

class PoseMapper:
    def __init__(self, device, smooth=0.85):
        """
        Initializes the bridge between MediaPipe 2D and SMPL 3D.
       
        """
        self.device = device
        self.smooth = smooth  
        self.prev_body_pose = torch.zeros((1, 63), device=device)

    
    
    
    def _vec(self, a, b):
        v = np.array(b) - np.array(a)
        n = np.linalg.norm(v) + 1e-8
        return v / n

    def _axis_angle(self, v1, v2):
        """Calculates rotation needed to align v1 to v2."""
        axis = np.cross(v1, v2)
        sin = np.linalg.norm(axis)
        cos = np.clip(np.dot(v1, v2), -1.0, 1.0)
        if sin < 1e-6:
            return np.zeros(3)
        axis = axis / (sin + 1e-8)
        angle = np.arctan2(sin, cos)
        return axis * angle

    def _smooth(self, current):
        """Applies EMA to prevent high-frequency jitter in the 3D mesh."""
        smoothed = self.smooth * self.prev_body_pose + (1 - self.smooth) * current
        self.prev_body_pose = smoothed.detach()
        return smoothed

    
    
    
    def map(self, mp_landmarks, w, h):
        """
        Maps MediaPipe Pose landmarks to SMPL-X body pose parameters.
       
        """
        body = torch.zeros((1, 63), device=self.device)
        translation = np.zeros(3)

        if mp_landmarks is None:
            return self._smooth(body), translation

        lm = mp_landmarks.landmark

        def p(i):
            
            return np.array([lm[i].x * w, lm[i].y * h, lm[i].z])

        
        LS, RS = 11, 12 
        LE, RE = 13, 14 
        LW, RW = 15, 16 
        LH, RH = 23, 24 

        
        ls, rs = p(LS), p(RS)
        le, re = p(LE), p(RE)
        lw, rw = p(LW), p(RW)
        lh, rh = p(LH), p(RH)

        
        
        
        torso_up = self._vec((lh + rh) * 0.5, (ls + rs) * 0.5)
        world_up = np.array([0, -1, 0])
        torso_rot = self._axis_angle(world_up, torso_up)

        
        
        
        l_arm = self._axis_angle(self._vec(ls, lh), self._vec(ls, le))
        r_arm = self._axis_angle(self._vec(rs, rh), self._vec(rs, re))

        
        l_arm = np.clip(l_arm, -1.5, 1.5)
        r_arm = np.clip(r_arm, -1.5, 1.5)

        
        
        
        l_forearm = self._axis_angle(self._vec(ls, le), self._vec(le, lw))
        r_forearm = self._axis_angle(self._vec(rs, re), self._vec(re, rw))

        
        
        
        
        body[0, 0:3] = torch.tensor(torso_rot, device=self.device)   
        body[0, 36:39] = torch.tensor(l_arm, device=self.device)     
        body[0, 39:42] = torch.tensor(r_arm, device=self.device)     
        body[0, 42:45] = torch.tensor(l_forearm, device=self.device) 
        body[0, 45:48] = torch.tensor(r_forearm, device=self.device) 

        
        
        
        
        mid_x = (lm[LS].x + lm[RS].x) / 2
        mid_y = (lm[LS].y + lm[RS].y) / 2
        
        
        
        trans_x = (mid_x - 0.5) * 2.5 
        trans_y = (0.5 - mid_y) * 2.5 
        translation = np.array([trans_x, trans_y, 0])

        return self._smooth(body), translation