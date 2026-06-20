const axios = require('axios')

const AI_URL = "https://apis.prexzyvilla.site/ai/gpt-5"

function technicalAgent(data) {
  return {
    rsiSignal: data.rsi < 30 ? "BUY" : data.rsi > 70 ? "SELL" : "HOLD",
    trend: data.ema20 > data.ema50 ? "UP" : "DOWN",
    macd: data.macd,
    adx: data.adx
  }
}

function sentimentAgent(data) {
  return {
    volatility: data.volatility,
    candleTrend: data.lastCandles || "neutral",
    pressure: data.rsi < 30 ? "bullish" : "bearish"
  }
}

function riskAgent(balance, openTrades) {
  return {
    maxRisk: balance * 0.02,
    allowTrade: openTrades < 3,
    riskLevel: openTrades > 2 ? "HIGH" : "LOW"
  }
}

function strategyAgent(tech, sentiment) {
  let score = 0

  if (tech.trend === "UP") score += 1
  if (tech.rsiSignal === "BUY") score += 1
  if (sentiment.pressure === "bullish") score += 1

  if (tech.trend === "DOWN") score -= 1
  if (tech.rsiSignal === "SELL") score -= 1

  return {
    score,
    decision:
      score >= 2 ? "BUY" :
      score <= -2 ? "SELL" :
      "HOLD"
  }
}

async function aiBrain(payload) {
  const prompt = `
You are a hedge fund AI trading brain.

Analyze and refine this multi-agent decision.

Return ONLY JSON.

Data:
${JSON.stringify(payload)}

Return format:
{
  "signal": "BUY|SELL|HOLD",
  "confidence": 0-100,
  "risk": "LOW|MEDIUM|HIGH",
  "reason": "short professional explanation"
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
      reason: "AI parse error"
    }
  }
}

function portfolioManager(ai, risk) {
  if (!risk.allowTrade) return "BLOCKED"
  if (ai.confidence < 65) return "BLOCKED"
  if (ai.risk === "HIGH") return "BLOCKED"
  return "APPROVED"
}

module.exports = {
  technicalAgent,
  sentimentAgent,
  riskAgent,
  strategyAgent,
  aiBrain,
  portfolioManager
}
