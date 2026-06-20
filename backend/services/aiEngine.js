const axios = require('axios')

const AI_URL = "https://apis.prexzyvilla.site/ai/gpt-5"

async function analyzeMarket(data) {
  const prompt = `
You are a professional trading engine.

Return ONLY JSON.

Symbol: ${data.symbol}
Price: ${data.price}
RSI: ${data.rsi}
EMA20: ${data.ema20}
EMA50: ${data.ema50}
MACD: ${data.macd}
ADX: ${data.adx}
Volatility: ${data.volatility}

Return format:
{
  "signal": "BUY|SELL|HOLD",
  "confidence": 0,
  "risk": "LOW|MEDIUM|HIGH",
  "reason": "short technical explanation"
}
`

  const res = await axios.get(AI_URL, {
    params: { text: prompt }
  })

  try {
    return JSON.parse(res.data.text)
  } catch (e) {
    return {
      signal: "HOLD",
      confidence: 0,
      risk: "HIGH",
      reason: "parse error"
    }
  }
}

module.exports = { analyzeMarket }
