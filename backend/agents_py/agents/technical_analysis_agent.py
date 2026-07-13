import pandas as pd
import numpy as np


class TechnicalAnalysisAgent:
    """
    Agent 2
    Technical Analysis Agent

    Responsible for analyzing market data using
    technical indicators and generating a
    BUY / SELL / HOLD signal.
    """

    def __init__(self, candles):
        self.df = pd.DataFrame(candles, columns=[
            "open_time",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "close_time",
            "quote_asset_volume",
            "number_of_trades",
            "taker_buy_base_volume",
            "taker_buy_quote_volume",
            "ignore"
        ])

        numeric = ["open", "high", "low", "close", "volume"]
        self.df[numeric] = self.df[numeric].astype(float)

    # -----------------------------
    # Indicators
    # -----------------------------

    def sma(self, period=20):
        return self.df["close"].rolling(period).mean()

    def ema(self, period=20):
        return self.df["close"].ewm(span=period, adjust=False).mean()

    def rsi(self, period=14):
        delta = self.df["close"].diff()

        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)

        avg_gain = gain.rolling(period).mean()
        avg_loss = loss.rolling(period).mean()

        rs = avg_gain / avg_loss

        return 100 - (100 / (1 + rs))

    def macd(self):
        ema12 = self.ema(12)
        ema26 = self.ema(26)

        macd = ema12 - ema26
        signal = macd.ewm(span=9, adjust=False).mean()

        return macd, signal

    def bollinger_bands(self):
        sma = self.sma(20)
        std = self.df["close"].rolling(20).std()

        upper = sma + (std * 2)
        lower = sma - (std * 2)

        return upper, lower

    def atr(self, period=14):

        high_low = self.df["high"] - self.df["low"]

        high_close = abs(
            self.df["high"] -
            self.df["close"].shift()
        )

        low_close = abs(
            self.df["low"] -
            self.df["close"].shift()
        )

        tr = pd.concat(
            [high_low, high_close, low_close],
            axis=1
        ).max(axis=1)

        return tr.rolling(period).mean()

    # -----------------------------
    # Trading Signal
    # -----------------------------

    def generate_signal(self):

        rsi = self.rsi().iloc[-1]

        ema20 = self.ema(20).iloc[-1]

        ema50 = self.ema(50).iloc[-1]

        macd, signal = self.macd()

        macd_value = macd.iloc[-1]

        signal_value = signal.iloc[-1]

        price = self.df["close"].iloc[-1]

        score = 0

        reasons = []

        if rsi < 30:
            score += 2
            reasons.append("RSI Oversold")

        elif rsi > 70:
            score -= 2
            reasons.append("RSI Overbought")

        if ema20 > ema50:
            score += 2
            reasons.append("EMA Bullish")

        else:
            score -= 2
            reasons.append("EMA Bearish")

        if macd_value > signal_value:
            score += 2
            reasons.append("MACD Bullish")

        else:
            score -= 2
            reasons.append("MACD Bearish")

        if price > ema20:
            score += 1
            reasons.append("Price Above EMA20")

        else:
            score -= 1
            reasons.append("Price Below EMA20")

        if score >= 5:
            action = "BUY"

        elif score <= -5:
            action = "SELL"

        else:
            action = "HOLD"

        confidence = min(abs(score) / 7, 1)

        return {
            "action": action,
            "confidence": round(confidence, 2),
            "score": score,
            "reasons": reasons
        }

    # -----------------------------
    # Main Analysis
    # -----------------------------

    def analyze(self):

        upper, lower = self.bollinger_bands()

        macd, signal = self.macd()

        return {

            "price": float(self.df["close"].iloc[-1]),

            "rsi": float(self.rsi().iloc[-1]),

            "ema20": float(self.ema(20).iloc[-1]),

            "ema50": float(self.ema(50).iloc[-1]),

            "macd": float(macd.iloc[-1]),

            "macd_signal": float(signal.iloc[-1]),

            "bollinger_upper": float(upper.iloc[-1]),

            "bollinger_lower": float(lower.iloc[-1]),

            "atr": float(self.atr().iloc[-1]),

            "signal": self.generate_signal()
        }


if __name__ == "__main__":

    from market_data_agent import MarketDataAgent

    market = MarketDataAgent()

    candles = market.get_candles()

    ta = TechnicalAnalysisAgent(candles)

    print(ta.analyze())
