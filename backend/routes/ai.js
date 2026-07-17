global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');

let nvidiaClient;
try {
  nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
  });
} catch (e) {
  console.error('[AI] OpenAI init error:', e.message);
}

const MODEL = 'z-ai/glm-5.2';

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// ─── Pure AI – no fallback ──────────────────────────────────────────
async function getAIAnalysis(email, symbol, price, closes) {
  try {
    const data = await instance.getAnalysisData(symbol);
    let priceData = closes && closes.length > 0 ? closes : data.closes;

    if (!priceData || priceData.length < 14) {
      return {
        signal: 'HOLD',
        confidence: 0,
        reason: 'Insufficient market data (need ≥14 candles)',
      };
    }

    const ind = instance.calculateIndicators(priceData);
    if (!ind) {
      return { signal: 'HOLD', confidence: 0, reason: 'Indicator calculation failed' };
    }

    const rsi = safeNumber(ind.rsi);
    const macd = safeNumber(ind.macd);
    const ema20 = safeNumber(ind.ema20);
    const ema50 = safeNumber(ind.ema50);
    const ema200 = safeNumber(ind.ema200 || ema50);
    const atr = safeNumber(ind.atr);
    const bbUpper = safeNumber(ind.bbUpper);
    const bbLower = safeNumber(ind.bbLower);
    const currentPrice = price || data.price || ind.currentPrice || 0;

    // ─── NVIDIA AI only ──────────────────────────────────────────────
    if (!nvidiaClient) {
      return { signal: 'HOLD', confidence: 0, reason: 'NVIDIA client not initialized' };
    }

    const prompt = `Analyze ${symbol} at $${currentPrice.toFixed(2)}.
RSI: ${rsi.toFixed(2)}, MACD: ${macd.toFixed(4)}
EMA20: ${ema20.toFixed(2)}, EMA50: ${ema50.toFixed(2)}, EMA200: ${ema200.toFixed(2)}
ATR: ${atr.toFixed(4)}, BB Upper: ${bbUpper.toFixed(2)}, BB Lower: ${bbLower.toFixed(2)}
Return JSON: {"signal":"BUY|SELL|HOLD","confidence":0,"reason":"..."}`;

    const decision = await nvidiaClient.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 300,
      timeout: 8000,
    });

    const content = decision.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON returned from NVIDIA');

    const parsed = JSON.parse(match[0]);
    const signal = parsed.signal || 'HOLD';
    const confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 0));
    const reason = parsed.reason || 'AI decision';

    // Enforce confidence threshold (no fallback)
    const finalSignal = confidence >= 75 ? signal : 'HOLD';
    const finalReason = confidence < 75 ? `${reason} (confidence ${confidence}% < 75%)` : reason;

    return {
      signal: finalSignal,
      confidence: confidence,
      trend: parsed.trend || 'Sideways',
      market_regime: parsed.market_regime || 'Ranging',
      entry_price: currentPrice,
      stop_loss: 0,
      take_profit: 0,
      risk_reward: '1:1',
      expected_move_percent: 0,
      trade_duration: 'Intraday',
      reason: finalReason,
      pros: [],
      cons: [],
      indicator_scores: {},
      data: { price: currentPrice, rsi, macd, ema20, ema50, ema200, atr },
    };
  } catch (error) {
    console.error('[AI] Error:', error.message);
    // No fallback – return HOLD with error
    return {
      signal: 'HOLD',
      confidence: 0,
      reason: `NVIDIA AI error: ${error.message}`,
    };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const email = req.user?.email || req.body.email || 'demo@example.com';
  if (!email) return res.status(400).json({ error: 'Email required' });

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 12000));
  try {
    const result = await Promise.race([
      getAIAnalysis(email, symbol, null, req.body.closes || null),
      timeout,
    ]);
    res.json(result);
  } catch (error) {
    console.error('[AI] Route error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: `Request error: ${error.message}` });
  }
});

router.get('/market-data', async (req, res) => {
  let { symbol = 'BTCUSDT' } = req.query;
  symbol = symbol.replace(/\//g, '');
  try {
    const data = await instance.getAnalysisData(symbol);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, getAIAnalysis };
