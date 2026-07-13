import requests
from datetime import datetime


class OnChainAgent:
    """
    Agent 5
    On-Chain Agent

    Collects blockchain metrics and generates
    a simple on-chain market signal.
    """

    def __init__(self):
        self.blockchain_info = "https://blockchain.info/stats?format=json"
        self.mempool_api = "https://mempool.space/api/v1/fees/recommended"

    # ------------------------------------
    # Bitcoin Network Statistics
    # ------------------------------------

    def get_network_stats(self):
        try:
            response = requests.get(
                self.blockchain_info,
                timeout=10
            )

            response.raise_for_status()

            return response.json()

        except Exception as e:
            print("Network Error:", e)
            return {}

    # ------------------------------------
    # Current Network Fees
    # ------------------------------------

    def get_fee_data(self):
        try:
            response = requests.get(
                self.mempool_api,
                timeout=10
            )

            response.raise_for_status()

            return response.json()

        except Exception as e:
            print("Fee Error:", e)
            return {}

    # ------------------------------------
    # Analyze
    # ------------------------------------

    def analyze(self):

        network = self.get_network_stats()
        fees = self.get_fee_data()

        score = 0
        reasons = []

        hash_rate = network.get("hash_rate", 0)

        if hash_rate > 400000000:
            score += 2
            reasons.append("Strong network hash rate")

        minutes_between_blocks = network.get(
            "minutes_between_blocks",
            10
        )

        if minutes_between_blocks < 10:
            score += 1
            reasons.append("Fast block production")

        fastest_fee = fees.get("fastestFee", 0)

        if fastest_fee > 50:
            score += 1
            reasons.append("High network activity")

        if score >= 3:
            signal = "BULLISH"

        elif score <= -2:
            signal = "BEARISH"

        else:
            signal = "NEUTRAL"

        return {

            "timestamp": datetime.utcnow().isoformat(),

            "hash_rate": hash_rate,

            "minutes_between_blocks":
                minutes_between_blocks,

            "fastest_fee": fastest_fee,

            "signal": signal,

            "confidence": round(min(score / 4, 1), 2),

            "reasons": reasons
        }


if __name__ == "__main__":

    agent = OnChainAgent()

    print(agent.analyze())

