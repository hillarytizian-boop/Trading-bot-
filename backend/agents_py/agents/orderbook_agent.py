import requests
from datetime import datetime


class OrderBookAgent:
    """
    Agent 6
    Order Book Agent

    Analyzes Binance order book to determine
    buying and selling pressure.
    """

    BASE_URL = "https://api.binance.com/api/v3/depth"

    def __init__(self, symbol="BTCUSDT", limit=100):
        self.symbol = symbol.upper()
        self.limit = limit

    # ------------------------------------
    # Fetch Order Book
    # ------------------------------------

    def get_order_book(self):

        try:
            response = requests.get(
                self.BASE_URL,
                params={
                    "symbol": self.symbol,
                    "limit": self.limit
                },
                timeout=10
            )

            response.raise_for_status()

            return response.json()

        except Exception as e:

            print("Order Book Error:", e)

            return {}

    # ------------------------------------
    # Analyze Order Book
    # ------------------------------------

    def analyze(self):

        book = self.get_order_book()

        bids = book.get("bids", [])
        asks = book.get("asks", [])

        bid_volume = sum(float(qty) for _, qty in bids)
        ask_volume = sum(float(qty) for _, qty in asks)

        total = bid_volume + ask_volume

        imbalance = (
            (bid_volume - ask_volume) / total
            if total > 0 else 0
        )

        if imbalance > 0.20:
            signal = "BULLISH"

        elif imbalance < -0.20:
            signal = "BEARISH"

        else:
            signal = "NEUTRAL"

        return {

            "timestamp": datetime.utcnow().isoformat(),

            "symbol": self.symbol,

            "bid_volume": round(bid_volume, 4),

            "ask_volume": round(ask_volume, 4),

            "imbalance": round(imbalance, 4),

            "top_bid": bids[0] if bids else None,

            "top_ask": asks[0] if asks else None,

            "signal": signal,

            "confidence": round(min(abs(imbalance), 1), 2)

        }


if __name__ == "__main__":

    agent = OrderBookAgent(symbol="BTCUSDT")

    print(agent.analyze())

