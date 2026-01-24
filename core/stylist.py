import random

class ETryStylist:
    def __init__(self):
        self.positive_comments = [
            "This look is absolutely fire! 🔥",
            "The fit highlights your frame perfectly.",
            "That color palette is a 10/10 match for your tone.",
            "Trend alert! You're rocking the 2026 aesthetic.",
            "Bold choice! This really brings out your confidence."
        ]

    def calculate_score(self, skin_tone=None, fit_quality=0.9):
        # Simplified logic: In production, you'd compare Hex codes
        base_score = random.randint(85, 98) 
        comment = random.choice(self.positive_comments)
        
        return {
            "score": f"{base_score}%",
            "match_status": "Perfect Match",
            "commentary": comment
        }