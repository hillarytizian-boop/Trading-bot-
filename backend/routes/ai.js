global.WebSocket = require('ws');
const router = require('express').Router();
const { instance } = require('../binanceData');
const tradingDesk = require('../tradingDesk');

async function getAIAnalysis(email, symbol, position = null) {
  try {
    const analysis = await instance.getFullAnalysis(symbol, 100);
    const telemetry = {
      symbol: analysis.symbol,
      currentPrice: analysis.currentPrice,
      rsi: analysis.rsi,
      macd: analysis.macd,
      sma20: analysis.sma20,
      sma50: analysis.sma50,
      ema20: analysis.ema20,
      ema50: analysis.ema50,
      position: position ? `Holding ${position.type} at $${position.entry_price}` : 'No active position'
    };

    return await tradingDesk.runFull17AgentPipeline(telemetry);
  } catch (error) {
    console.error('[AI] 17-Agent Route Error:', error.message);
    return { signal: 'HOLD', confidence: 0, reason: 'Analysis error: ' + error.message };
  }
}

router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const email = req.user?.email || req.body.email || 'demo@example.com';

  try {
    const result = await getAIAnalysis(email, symbol, null);
    res.json(result);
  } catch (error) {
    console.error('[AI] Express Route Error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

module.exports = { router, getAIAnalysis };
