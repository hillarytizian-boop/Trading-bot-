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

// ─── Retry helper ────────────────────────────────────────────────────
async function callWithRetry(fn, retries = 3, delay = 1500) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.warn(`[AI] Attempt ${i+1} failed: ${err.message}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

async function getAIAnalysis(email, symbol, position = null, closes = null) {
  try {
    // ─── Fetch full analysis with indicators ──────────────────────
    const analysis = await instance.getFullAnalysis(symbol, 100);
    const currentPrice = analysis.currentPrice;

    // ─── Build prompt with indicators and position ──────────────────
    let positionText = position ? `You currently hold a ${position.type} position opened at $${position.entry_price}.` : 'You have no open position.';
    const prompt = `You are a professional crypto trader. Analyze the following market data and provide a decision.

Symbol: ${analysis.symbol}
Current Price: $${currentPrice}
RSI(14): ${analysis.rsi}
MACD: ${analysis.macd ? `${analysis.macd.macd.toFixed(2)} (signal: ${analysis.macd.signal.toFixed(2)}, histogram: ${analysis.macd.histogram.toFixed(2)})` : 'N/A'}
SMA20: ${analysis.sma20.toFixed(2)}
SMA50: ${analysis.sma50.toFixed(2)}
EMA20: ${analysis.ema20.toFixed(2)}
EMA50: ${analysis.ema50.toFixed(2)}

Position: ${positionText}

Based on the indicators and your position, what should you do? Return ONLY valid JSON with keys: "signal" (BUY, SELL, or HOLD), "confidence" (0-100), "reason" (string).`;

    console.log(`[AI] Sending prompt to ${MODEL}`);

    const decision = await callWithRetry(() =>
      nvidiaClient.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 300,
        stream: false,
      })
    );

    const content = decision.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON returned');

    const parsed = JSON.parse(match[0]);
    const signal = parsed.signal || 'HOLD';
    const confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 0));
    const reason = parsed.reason || 'No reason provided';

    return {
      signal,
      confidence,
      reason,
      data: {
        price: currentPrice,
        rsi: analysis.rsi,
        macd: analysis.macd,
        ema20: analysis.ema20,
        ema50: analysis.ema50,
      },
    };
  } catch (error) {
    console.error('[AI] Error:', error.message);
    // Fallback: HOLD with low confidence
    return { signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message };
  }
}

// ─── HTTP endpoints ──────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const email = req.user?.email || req.body.email || 'demo@example.com';
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const result = await getAIAnalysis(email, symbol, null);
    res.json(result);
  } catch (error) {
    console.error('[AI] Route error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
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
