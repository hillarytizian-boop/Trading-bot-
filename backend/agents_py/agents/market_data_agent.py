import requests
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)


class MarketDataAgent:
    """
    Agent 1
    Market Data Agent

    Responsible for collecting market data
    from Binance.
    """

    SPOT_API = "https://api.binance.com/api/v3"
    FUTURES_API = "https://fapi.binance.com/fapi/v1"

    def __init__(
        self,
        symbol="BTCUSDT",
        interval="1m",
        limit=200
    ):
        self.symbol = symbol.upper()
        self.interval = interval
        self.limit = limit

    # -------------------------
    # Spot Market
    # -------------------------

    def get_price(self):
        try:
            return requests.get(
                f"{self.SPOT_API}/ticker/price",
                params={"symbol": self.symbol},
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return {}

    def get_24h_stats(self):
        try:
            return requests.get(
                f"{self.SPOT_API}/ticker/24hr",
                params={"symbol": self.symbol},
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return {}

    def get_average_price(self):
        try:
            return requests.get(
                f"{self.SPOT_API}/avgPrice",
                params={"symbol": self.symbol},
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return {}

    def get_order_book(self, depth=20):
        try:
            return requests.get(
                f"{self.SPOT_API}/depth",
                params={
                    "symbol": self.symbol,
                    "limit": depth
                },
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return {}

    def get_recent_trades(self, limit=50):
        try:
            return requests.get(
                f"{self.SPOT_API}/trades",
                params={
                    "symbol": self.symbol,
                    "limit": limit
                },
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return []

    def get_candles(self):
        try:
            return requests.get(
                f"{self.SPOT_API}/klines",
                params={
                    "symbol": self.symbol,
                    "interval": self.interval,
                    "limit": self.limit
                },
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return []

    def get_exchange_info(self):
        try:
            return requests.get(
                f"{self.SPOT_API}/exchangeInfo",
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return {}

    # -------------------------
    # Futures Market
    # -------------------------

    def get_mark_price(self):
        try:
            return requests.get(
                f"{self.FUTURES_API}/premiumIndex",
                params={"symbol": self.symbol},
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return {}

    def get_funding_rate(self):
        try:
            return requests.get(
                f"{self.FUTURES_API}/fundingRate",
                params={
                    "symbol": self.symbol,
                    "limit": 1
                },
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return []

    def get_open_interest(self):
        try:
            return requests.get(
                f"{self.FUTURES_API}/openInterest",
                params={"symbol": self.symbol},
                timeout=10
            ).json()
        except Exception as e:
            logging.error(e)
            return {}

    # -------------------------
    # Main Analysis
    # -------------------------

    def analyze(self):

        logging.info(
            f"Collecting market data for {self.symbol}"
        )

        return {

            "timestamp": datetime.utcnow().isoformat(),

            "symbol": self.symbol,

            "price": self.get_price(),

            "stats24h": self.get_24h_stats(),

            "average_price": self.get_average_price(),

            "candles": self.get_candles(),

            "order_book": self.get_order_book(),

            "recent_trades": self.get_recent_trades(),

            "exchange_info": self.get_exchange_info(),

            "mark_price": self.get_mark_price(),

            "funding_rate": self.get_funding_rate(),

            "open_interest": self.get_open_interest()

        }


if __name__ == "__main__":

    agent = MarketDataAgent(
        symbol="BTCUSDT",
        interval="5m",
        limit=100
    )

    data = agent.analyze()

    print(data)
