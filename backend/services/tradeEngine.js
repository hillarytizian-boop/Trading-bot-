const WebSocket = require('ws')
const {
  technicalAgent,
  sentimentAgent,
  riskAgent,
  strategyAgent,
  aiBrain,
  portfolioManager
} = require('./multiAgentEngine')

const DERIV_WS = "wss://ws.deriv.com/websockets/v3?app_id=1089"

let ws = null
let running = false
let openTrades = 0
let balance = 100

function connect(token) {
  ws = new WebSocket(DERIV_WS)

  ws.on('open', () => {
    ws.send(JSON.stringify({ authorize: token }))
    ws.send(JSON.stringify({ ticks: "R_100", subscribe: 1 }))
  })

  ws.on('message', async (msg) => {
    if (!running) return

    const data = JSON.parse(msg)
    if (!data.tick) return

    const price = data.tick.quote

    const market = {
      symbol: "R_100",
      price,
      rsi: 50,
      ema20: price,
      ema50: price - 1,
      macd: 0,
      adx: 30,
      volatility: "medium"
    }

    // 🧠 MULTI AGENT PIPELINE
    const tech = technicalAgent(market)
    const sentiment = sentimentAgent(market)
    const risk = riskAgent(balance, openTrades)
    const strategy = strategyAgent(tech, sentiment)

    const ai = await aiBrain({
      market,
      tech,
      sentiment,
      strategy,
      risk
    })

    const decision = portfolioManager(ai, risk)

    if (decision !== "APPROVED") return

    if (ai.signal === "HOLD") return

    executeTrade(ai.signal)
  })
}

function executeTrade(signal) {
  const contract = signal === "BUY" ? "CALL" : "PUT"

  console.log("EXECUTING HEDGE FUND TRADE:", signal)

  ws.send(JSON.stringify({
    buy: 1,
    price: 2,
    parameters: {
      amount: 2,
      basis: "stake",
      contract_type: contract,
      currency: "USD",
      duration: 5,
      duration_unit: "t",
      symbol: "R_100"
    }
  }))

  openTrades++
}

function start(token) {
  if (running) return
  running = true
  connect(token)
  console.log("Hedge Fund Bot Started")
}

function stop() {
  running = false
  if (ws) ws.close()
}

module.exports = { start, stop }
