import requests
from datetime import datetime


class SentimentAgent:
    """
    Agent 4
    Sentiment Agent

    Analyzes overall crypto market sentiment
    using the Fear & Greed Index.
    """

    FEAR_GREED_API = "https://api.alternative.me/fng/"

    def __init__(self):
        pass

    # ---------------------------------
    # Fear & Greed
    # ---------------------------------

    def get_fear_greed(self):

        try:
            response = requests.get(
                self.FEAR_GREED_API,
                timeout=10
            )

            response.raise_for_status()

            return response.json()["data"][0]

        except Exception as e:

            print("Fear & Greed Error:", e)

            return None

    # ---------------------------------
    # Analyze
    # ---------------------------------

    def analyze(self):

        data = self.get_fear_greed()

        if not data:

            return {
                "status": "error"
            }

        value = int(data["value"])

        if value <= 25:

            sentiment = "EXTREME_FEAR"

        elif value <= 45:

            sentiment = "FEAR"

        elif value <= 55:

            sentiment = "NEUTRAL"

        elif value <= 75:

            sentiment = "GREED"

        else:

            sentiment = "EXTREME_GREED"

        return {

            "timestamp": datetime.utcnow().isoformat(),

            "fear_greed_index": value,

            "classification": data["value_classification"],

            "market_sentiment": sentiment,

            "confidence": round(value / 100, 2)
        }


if __name__ == "__main__":

    agent = SentimentAgent()

    print(agent.analyze())

