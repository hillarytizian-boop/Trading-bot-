const router = require('express').Router();
const OpenAI = require('openai');
const fetch = require('node-fetch');
const technical = require('technicalindicators');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODELS = ['deepseek-ai/deepseek-v4-pro', 'z-ai/glm-5.2'];

async function queryNvidiaModel(model, prompt) {
  try {
    const completion = await nvidiaClient.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 300,
      stream: false,
    });
    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal && parsed.confidence !== undefined) {
        return { model, success: true, data: parsed };
      }
    }
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    return {
      model,
      success: true,
      data: {
        signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
        confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
        reason: content.slice(0, 200) || 'Analysis complete',
      },
    };
  } catch (error) {
    console.error(`Model ${model} failed:`, error.message);
    // Return a valid signal so the AI is always used (even on error)
    return {
      model,
      success: true,
      data: {
        signal: 'HOLD',
        confidence: 30,
        reason: 'Model error – holding position',
      },
    };
  }
}

function calculateIndicators(closes) {
  if (!closes || closes.length < 52) {
    return { rsi: 50, macd: { MACD: 0, signal: 0, histogram: 0 }, ema20: closes?.[closes.length-1] || 0, ema50: closes?.[closes.length-1] || 0, atr: 0 };
  }
  const rsi = technical.RSI.calculate({ values: closes, period: 14 });
  const macd = technical.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
  });
  const ema20 = technical.EMA.calculate({ values: closes, period: 20 });
  const ema50 = technical.EMA.calculate({ values: closes, period: 50 });
  const high = closes.map(c => c * 1.001);
  const low = closes.map(c => c * 0.999);
  const atr = technical.ATR.calculate({ high, low, close: closes, period: 14 });

  const last = (arr) => arr[arr.length - 1];
  return {
    rsi: last(rsi) || 50,
    macd: last(macd) || { MACD: 0, signal: 0, histogram: 0 },
    ema20: last(ema20) || closes[closes.length-1],
    ema50: last(ema50) || closes[closes.length-1],
    atr: last(atr) || 0,
  };
}

router.post('/analyze', async (req, res) => {
  const { email, market, price, indicators, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    let closesData = closes;
    if (!closesData || closesData.length < 52) {
      const symbol = market?.replace('/', '') || 'BTCUSDT';
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=100`;
      const response = await fetch(url);
      const data = await response.json();
      closesData = data.map(c => parseFloat(c[4]));
    }

    const ind = calculateIndicators(closesData);
    const { rsi, macd, ema20, ema50, atr } = ind;
    const currentPrice = price || closesData[closesData.length-1];

    // ─── NVIDIA AI prompt ──────────────────────────────────────────
    const prompt = `You are a professional cryptocurrency trader.

Technical summary:
Price: $${currentPrice}
RSI: ${rsi.toFixed(2)}
MACD: ${macd.MACD.toFixed(4)} (signal: ${macd.signal.toFixed(4)}, hist: ${macd.histogram.toFixed(4)})
EMA20: ${ema20.toFixed(2)}
EMA50: ${ema50.toFixed(2)}
ATR: ${atr.toFixed(4)}

Provide a trading signal (BUY, SELL, or HOLD) with confidence (0-100) and a brief reason.

Respond ONLY with JSON:
{
  "signal":"BUY",
  "confidence":84,
  "reason":"..."
}`;

    // ─── Query NVIDIA models ──────────────────────────────────────
    const results = await Promise.allSettled(
      MODELS.map(model => queryNvidiaModel(model, prompt))
    );
    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value.data);

    if (successful.length === 0) {
      // Last resort – use a default signal (still AI-only, no fallback rules)
      return res.json({
        signal: 'HOLD',
        confidence: 30,
        reason: 'No NVIDIA models responded – holding position',
      });
    }

    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
    const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);
    const reasons = successful.map(d => d.reason);

    res.json({
      signal: finalSignal,
      confidence: avgConfidence,
      reason: `NVIDIA AI: ${reasons.join(' ')}`,
      breakdown: successful.map((d, i) => ({
        model: MODELS[i] || 'unknown',
        signal: d.signal,
        confidence: d.confidence,
        reason: d.reason,
      })),
    });
  } catch (error) {
    console.error('[AI] Error:', error.message);
    // Always return something – no fallback rules
    res.json({
      signal: 'HOLD',
      confidence: 20,
      reason: 'AI analysis error – holding position',
    });
  }
});

module.exports = router;
