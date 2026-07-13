import requests
from datetime import datetime


class WhaleAgent:
    """
    Agent 7
    Whale Agent

    Detects large trades ("whale" activity) from
    Binance recent trades and estimates whether
    buying or selling pressure is dominant.
    """

    BASE_URL = "https://api.binance.com/api/v3/trades"

    def __init__(
        self,
        symbol="BTCUSDT",
        limit=500,
        whale_usdt=100000
    ):
        self.symbol = symbol.upper()
        self.limit = limit
        self.whale_usdt = whale_usdt

    # -----------------------------------
    # Fetch Recent Trades
    # -----------------------------------

    def get_recent_trades(self):

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

            print("Trade Error:", e)

            return []

    # -----------------------------------
    # Analyze Whale Activity
    # -----------------------------------

    def analyze(self):

        trades = self.get_recent_trades()

        whale_buys = 0
        whale_sells = 0

        buy_volume = 0
        sell_volume = 0

        whales = []

        for trade in trades:

            price = float(trade["price"])
            qty = float(trade["qty"])

            value = price * qty

            if value >= self.whale_usdt:

                whales.append({

                    "price": price,

                    "qty": qty,

                    "value": round(value, 2),

                    "buyer_is_maker": trade["isBuyerMaker"]

                })

                if trade["isBuyerMaker"]:
                    whale_sells += 1
                    sell_volume += value
                else:
                    whale_buys += 1
                    buy_volume += value

        score = whale_buys - whale_sells

        if score > 5:
            signal = "BULLISH"

        elif score < -5:
            signal = "BEARISH"

        else:
            signal = "NEUTRAL"

        confidence = min(abs(score) / 10, 1)

        return {

            "timestamp": datetime.utcnow().isoformat(),

            "symbol": self.symbol,

            "whale_threshold": self.whale_usdt,

            "total_whale_trades": len(whales),

            "whale_buys": whale_buys,

            "whale_sells": whale_sells,

            "buy_volume": round(buy_volume, 2),

            "sell_volume": round(sell_volume, 2),

            "signal": signal,

            "confidence": round(confidence, 2),

            "recent_whales": whales[:10]

        }


if __name__ == "__main__":

    agent = WhaleAgent(
        symbol="BTCUSDT"
    )

    print(agent.analyze())

