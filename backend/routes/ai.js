const router = require('express').Router();
const OpenAI = require('openai');
const fetch = require('node-fetch');

// ─── Check if key is set ──────────────────────────────────────────
const hasKey = !!process.env.NVIDIA_API_KEY;
console.log(`[AI] NVIDIA_API_KEY present: ${hasKey}`);
if (hasKey) {
  console.log(`[AI] Key starts with: ${process.env.NVIDIA_API_KEY.slice(0,4)}...`);
} else {
  console.warn('[AI] ⚠️ NVIDIA_API_KEY is NOT set in environment.');
}

// ─── Initialize client only if key exists ────────────────────────
let nvidiaClient = null;
if (hasKey) {
  nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
  });
}

const MODELS = ['deepseek-ai/deepseek-v4-pro', 'z-ai/glm-5.2'];

// ─── Query functions (unchanged) ──────────────────────────────────
async function queryNvidiaModel(model, prompt) {
  if (!nvidiaClient) {
    return { model, success: false, error: 'No API key configured' };
  }
  try {
    console.log(`[AI] Querying ${model}...`);
    const completion = await nvidiaClient.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });
    const content = completion.choices[0].message.content;
    console.log(`[AI] ${model} raw response:`, content);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal) return { model, success: true, data: parsed };
    }
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    return {
      model,
      success: true,
      data: {
        signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
        confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
        reason: content.slice(0, 200),
      },
    };
  } catch (e) {
    console.error(`[AI] ${model} error:`, e.message);
    return { model, success: false, error: e.message };
  }
}

function getIndicators(closes) {
  if (!closes || closes.length < 14) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    diff >= 0 ? gains += diff : losses -= diff;
  }
  const avgGain = gains / (closes.length - 1);
  const avgLoss = losses / (closes.length - 1);
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  const ema12 = closes.slice(-12).reduce((a,b) => a+b, 0) / Math.min(12, closes.length);
  const ema26 = closes.slice(-26).reduce((a,b) => a+b, 0) / Math.min(26, closes.length);
  const macd = ema12 - ema26;
  const ema20 = closes.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, closes.length);
  const ema50 = closes.slice(-50).reduce((a,b) => a+b, 0) / Math.min(50, closes.length);
  let atr = 0;
  if (closes.length > 14) {
    let sum = 0;
    for (let i = 1; i < closes.length; i++) {
      const high = closes[i] * 1.001, low = closes[i] * 0.999;
      sum += Math.max(high - low, Math.abs(high - closes[i-1]), Math.abs(low - closes[i-1]));
    }
    atr = sum / (closes.length - 1);
  }
  return { rsi, macd, ema20, ema50, atr };
}

async function getAIAnalysis(email, market, price, closes) {
  console.log(`[AI] getAIAnalysis called: market=${market}, price=${price}`);
  if (!nvidiaClient) {
    return { signal: 'HOLD', confidence: 0, reason: 'NVIDIA_API_KEY missing in environment' };
  }

  try {
    let closesData = closes;
    if (!closesData || closesData.length < 14) {
      const symbol = (market || 'BTCUSDT').replace('/', '');
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=50`;
      console.log(`[AI] Fetching klines from ${url}`);
      const response = await fetch(url);
      const data = await response.json();
      closesData = data.map(c => parseFloat(c[4]));
    }
    const ind = getIndicators(closesData);
    if (!ind) {
      console.log('[AI] Not enough indicators');
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data' };
    }

    const { rsi, macd, ema20, ema50, atr } = ind;
    const currentPrice = price || closesData[closesData.length-1];

    const prompt = `You are a professional cryptocurrency trader.
Analyze:
Price: $${currentPrice}
RSI: ${rsi.toFixed(2)}
MACD: ${macd.toFixed(4)}
EMA20: ${ema20.toFixed(2)}
EMA50: ${ema50.toFixed(2)}
ATR: ${atr.toFixed(4)}
Respond ONLY as JSON:
{"signal":"BUY","confidence":84,"reason":"..."}
Never return HOLD unless there is genuinely no trading edge.`;

    console.log('[AI] Prompt:', prompt);
    const results = await Promise.allSettled(MODELS.map(m => queryNvidiaModel(m, prompt)));
    const good = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value.data);

    if (good.length === 0) {
      console.error('[AI] All models failed');
      return { signal: 'HOLD', confidence: 0, reason: 'All NVIDIA models failed' };
    }

    const counts = { BUY: 0, SELL: 0, HOLD: 0 };
    good.forEach(d => counts[d.signal]++);
    const finalSignal = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    const avgConf = Math.round(good.reduce((s, d) => s + d.confidence, 0) / good.length);

    const response = {
      signal: finalSignal,
      confidence: avgConf,
      reason: `NVIDIA AI: ${good.map(d => d.reason).join(' ')}`,
      breakdown: good.map((d, i) => ({ model: MODELS[i] || 'unknown', ...d })),
    };
    console.log('[AI] Final response:', JSON.stringify(response));
    return response;
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return { signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message };
  }
}

// ─── Endpoint: analyze (POST) ─────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const { email, market, price, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  console.log(`[AI] /analyze request: email=${email}, market=${market}, price=${price}`);
  const result = await getAIAnalysis(email, market, price, closes);
  res.json(result);
});

// ─── Endpoint: status (GET) – safe debug ──────────────────────────
router.get('/status', (req, res) => {
  const key = process.env.NVIDIA_API_KEY;
  res.json({
    keySet: !!key,
    keyPrefix: key ? key.slice(0,6) + '...' : null,
    models: MODELS,
  });
});

console.log('[AI] ✅ Routes registered: POST /analyze, GET /status');
module.exports = { router, getAIAnalysis };
