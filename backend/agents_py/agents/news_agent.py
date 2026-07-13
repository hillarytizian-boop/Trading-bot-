import requests
from datetime import datetime


class NewsAgent:
    """
    Agent 3
    News Agent

    Collects crypto news and estimates whether
    it is bullish, bearish, or neutral.
    """

    def __init__(self, api_key=None):
        self.api_key = api_key
        self.news_api = "https://newsapi.org/v2/everything"

    # ----------------------------
    # Fetch News
    # ----------------------------

    def fetch_news(self, query="bitcoin OR crypto", page_size=20):

        if not self.api_key:
            return []

        try:
            response = requests.get(
                self.news_api,
                params={
                    "q": query,
                    "language": "en",
                    "sortBy": "publishedAt",
                    "pageSize": page_size,
                    "apiKey": self.api_key
                },
                timeout=10
            )

            response.raise_for_status()

            return response.json().get("articles", [])

        except Exception as e:
            print("News Error:", e)
            return []

    # ----------------------------
    # Sentiment Analysis
    # ----------------------------

    def analyze_sentiment(self, articles):

        bullish = [
            "approval",
            "adoption",
            "partnership",
            "surge",
            "growth",
            "bull",
            "record",
            "buy"
        ]

        bearish = [
            "hack",
            "ban",
            "lawsuit",
            "crash",
            "sell",
            "bear",
            "fraud",
            "collapse"
        ]

        score = 0
        reasons = []

        for article in articles:

            text = (
                article.get("title", "") +
                " " +
                article.get("description", "")
            ).lower()

            for word in bullish:
                if word in text:
                    score += 1
                    reasons.append(f"Bullish: {word}")

            for word in bearish:
                if word in text:
                    score -= 1
                    reasons.append(f"Bearish: {word}")

        if score > 3:
            signal = "BULLISH"

        elif score < -3:
            signal = "BEARISH"

        else:
            signal = "NEUTRAL"

        return {
            "signal": signal,
            "score": score,
            "confidence": min(abs(score) / 10, 1),
            "reasons": reasons[:10]
        }

    # ----------------------------
    # Main Analysis
    # ----------------------------

    def analyze(self):

        articles = self.fetch_news()

        sentiment = self.analyze_sentiment(articles)

        return {

            "timestamp": datetime.utcnow().isoformat(),

            "articles_found": len(articles),

            "top_headlines": [
                article.get("title")
                for article in articles[:5]
            ],

            "sentiment": sentiment
        }


if __name__ == "__main__":

    agent = NewsAgent(
        api_key="YOUR_NEWS_API_KEY"
    )

    print(agent.analyze())

