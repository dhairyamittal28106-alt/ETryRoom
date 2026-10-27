import cv2
import mediapipe as mp

class ETryDetector:
    def __init__(self):
        """
        Initializes the ETryRoom tracking engine. 
        Provides anchors for Hair, Clothes, and Accessories.
        """
        
        self.mp_pose = mp.solutions.pose
        self.mp_holistic = mp.solutions.holistic
        self.mp_drawing = mp.solutions.drawing_utils
        
        self.segmentation_enabled = False
        self.holistic = self.mp_holistic.Holistic(
            static_image_mode=False,
            model_complexity=1,
            enable_segmentation=self.segmentation_enabled,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

    def find_all_anchors(self, frame):
        
        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.holistic.process(image_rgb)
        
        anchors = {
            "face": results.face_landmarks,
            "body": results.pose_landmarks,
            "left_hand": results.left_hand_landmarks,
            "right_hand": results.right_hand_landmarks
        }
        return anchors, results

    def draw_landmarks(self, frame, results):
        
        if results.face_landmarks:
            self.mp_drawing.draw_landmarks(
                frame, 
                results.face_landmarks, 
                self.mp_holistic.FACEMESH_CONTOURS,
                landmark_drawing_spec=None,
                connection_drawing_spec=self.mp_drawing.DrawingSpec(color=(0, 255, 0), thickness=1)
            )
        
        if results.pose_landmarks:
            self.mp_drawing.draw_landmarks(
                frame, 
                results.pose_landmarks, 
                self.mp_holistic.POSE_CONNECTIONS,
                landmark_drawing_spec=self.mp_drawing.DrawingSpec(color=(255, 0, 0), thickness=2),
                connection_drawing_spec=self.mp_drawing.DrawingSpec(color=(255, 255, 255), thickness=2)
            )
        return frame