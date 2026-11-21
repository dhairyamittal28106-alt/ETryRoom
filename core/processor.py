import cv2
import numpy as np
import mediapipe as mp


class ETryProcessor:
    def __init__(self):
        self.mp_selfie = mp.solutions.selfie_segmentation
        self.segmenter = self.mp_selfie.SelfieSegmentation(model_selection=1)

    
    
    
    def get_body_mask(self, frame):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = self.segmenter.process(rgb)
        mask = (result.segmentation_mask > 0.35).astype(np.uint8) * 255
        mask = cv2.GaussianBlur(mask, (31, 31), 0)
        return mask

    
    
    
    def extract_shirt_mask(self, shirt_img):
        gray = cv2.cvtColor(shirt_img, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
        mask = cv2.GaussianBlur(mask, (7, 7), 0)
        return mask

    
    
    
    def warp_clothing(self, frame, shirt_img, body_anchors):
        if not body_anchors:
            return frame

        lm = body_anchors.landmark
        h, w, _ = frame.shape

        
        body_mask = self.get_body_mask(frame) / 255.0

        
        ls = np.array([lm[11].x * w, lm[11].y * h])
        rs = np.array([lm[12].x * w, lm[12].y * h])
        lh = np.array([lm[23].x * w, lm[23].y * h])
        rh = np.array([lm[24].x * w, lm[24].y * h])

        if np.linalg.norm(ls - rs) < 30:
            return frame

        
        width = max(np.linalg.norm(ls - rs), np.linalg.norm(lh - rh))
        expand = width * 0.3

        ls -= [expand, 0]
        rs += [expand, 0]
        lh -= [expand, 0]
        rh += [expand, 0]

        dst_pts = np.float32([ls, rs, rh, lh])

        sh, sw = shirt_img.shape[:2]
        src_pts = np.float32([
            [0.12 * sw, 0.05 * sh],
            [0.88 * sw, 0.05 * sh],
            [0.92 * sw, 0.95 * sh],
            [0.08 * sw, 0.95 * sh]
        ])

        matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)

        
        shirt_mask = self.extract_shirt_mask(shirt_img)
        warped_shirt = cv2.warpPerspective(shirt_img, matrix, (w, h))
        warped_mask = cv2.warpPerspective(shirt_mask, matrix, (w, h))
        warped_mask = cv2.GaussianBlur(warped_mask, (31, 31), 0) / 255.0

        
        
        
        depth_map = np.zeros((h, w), dtype=np.float32)

        for idx in [13, 14, 15, 16]:  
            x = int(lm[idx].x * w)
            y = int(lm[idx].y * h)
            z = lm[idx].z
            cv2.circle(depth_map, (x, y), 45, -z, -1)

        depth_map = cv2.GaussianBlur(depth_map, (51, 51), 0)
        occlusion_mask = (depth_map < 0).astype(np.float32)

        
        
        
        bulge = np.exp(-((np.linspace(-1, 1, w)) ** 2)) * 6
        for y in range(h):
            warped_shirt[y] = np.roll(warped_shirt[y], int(bulge.mean()), axis=0)

        
        
        
        final_alpha = warped_mask * body_mask * (1 - occlusion_mask)

        for c in range(3):
            frame[:, :, c] = (
                (1 - final_alpha) * frame[:, :, c]
                + final_alpha * warped_shirt[:, :, c]
            )

        
        shadow = np.zeros_like(frame)
        neck_y = int((ls[1] + rs[1]) / 2)
        cv2.ellipse(
            shadow,
            (int((ls[0] + rs[0]) / 2), neck_y + 18),
            (int(width * 0.45), 24),
            0, 0, 360,
            (0, 0, 0),
            -1
        )
        frame = cv2.addWeighted(frame, 1.0, shadow, 0.06, 0)

        return frame

    
    
    
    def apply_hair_color(self, frame, face_landmarks, color_bgr=(180, 0, 255)):
        if not face_landmarks:
            return frame

        h, w, _ = frame.shape
        hair_indices = [
            10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
            361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
            176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
            162, 21, 54, 103, 67, 109
        ]

        points = [
            [
                int(face_landmarks.landmark[idx].x * w),
                int(face_landmarks.landmark[idx].y * h) - 25
            ]
            for idx in hair_indices
        ]

        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(mask, [np.array(points)], 255)
        mask = cv2.GaussianBlur(mask, (51, 51), 0)

        color_layer = np.full(frame.shape, color_bgr, dtype=np.uint8)
        alpha = cv2.merge([mask, mask, mask]) / 255.0

        return (
            frame * (1 - alpha * 0.4)
            + color_layer * (alpha * 0.4)
        ).astype(np.uint8)

    
    
    
    def fit_accessory(self, frame, item_img, face_landmarks):
        return frame
