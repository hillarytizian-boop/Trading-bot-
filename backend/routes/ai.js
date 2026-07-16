const router = require('express').Router();
const OpenAI = require('openai');
const technical = require('technicalindicators');

// ─── NVIDIA API client ──────────────────────────────────────────
const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODELS = ['deepseek-ai/deepseek-v4-pro', 'z-ai/glm-5.2'];

// ─── Calculate real technical indicators ──────────────────────
function calculateIndicators(closes) {
  if (!closes || closes.length < 30) return null;

  const rsi = technical.RSI.calculate({ values: closes, period: 14 });
  const macd = technical.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
  });
  const bb = technical.BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  });
  const ema20 = technical.EMA.calculate({ values: closes, period: 20 });
  const ema50 = technical.EMA.calculate({ values: closes, period: 50 });
  const atr = technical.ATR.calculate({
    high: closes.map(c => c * 1.001),
    low: closes.map(c => c * 0.999),
    close: closes,
    period: 14,
  });

  return {
    rsi: rsi[rsi.length-1] || 50,
    macd: macd[macd.length-1] || { MACD: 0, signal: 0 },
    bb: bb[bb.length-1] || { upper: closes[closes.length-1] * 1.02, lower: closes[closes.length-1] * 0.98 },
    ema20: ema20[ema20.length-1] || closes[closes.length-1],
    ema50: ema50[ema50.length-1] || closes[closes.length-1],
    atr: atr[atr.length-1] || 0,
    price: closes[closes.length-1],
  };
}

// ─── Generate signal from indicators (fallback) ──────────────
function generateSignal(ind) {
  if (!ind) return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data' };

  let score = 0;
  let reasons = [];

  // RSI
  if (ind.rsi < 30) { score += 3; reasons.push(`RSI oversold (${ind.rsi.toFixed(1)})`); }
  else if (ind.rsi > 70) { score -= 3; reasons.push(`RSI overbought (${ind.rsi.toFixed(1)})`); }
  else if (ind.rsi < 45) { score += 1; reasons.push(`RSI low (${ind.rsi.toFixed(1)})`); }
  else if (ind.rsi > 55) { score -= 1; reasons.push(`RSI high (${ind.rsi.toFixed(1)})`); }
  else { reasons.push(`RSI neutral (${ind.rsi.toFixed(1)})`); }

  // MACD
  const macdDiff = ind.macd.MACD - ind.macd.signal;
  if (macdDiff > 0) { score += 2; reasons.push('MACD bullish'); }
  else if (macdDiff < 0) { score -= 2; reasons.push('MACD bearish'); }
  else { reasons.push('MACD neutral'); }

  // Bollinger Bands
  const bbPos = (ind.price - ind.bb.lower) / (ind.bb.upper - ind.bb.lower);
  if (bbPos < 0.2) { score += 2; reasons.push('Price near lower BB'); }
  else if (bbPos > 0.8) { score -= 2; reasons.push('Price near upper BB'); }
  else { reasons.push('Price within BB'); }

  // EMA crossover
  if (ind.ema20 > ind.ema50) { score += 1; reasons.push('EMA20 > EMA50'); }
  else if (ind.ema20 < ind.ema50) { score -= 1; reasons.push('EMA20 < EMA50'); }
  else { reasons.push('EMA20 = EMA50'); }

  // Determine signal
  let signal = 'HOLD';
  let confidence = 30;
  let reason = reasons.join('; ');

  if (score >= 5) {
    signal = 'BUY';
    confidence = Math.min(70 + (score - 5) * 5, 100);
    reason = `Strong BUY: ${reason}`;
  } else if (score <= -5) {
    signal = 'SELL';
    confidence = Math.min(70 + (Math.abs(score) - 5) * 5, 100);
    reason = `Strong SELL: ${reason}`;
  } else if (score >= 3) {
    signal = 'BUY';
    confidence = 50 + (score - 3) * 8;
    reason = `Moderate BUY: ${reason}`;
  } else if (score <= -3) {
    signal = 'SELL';
    confidence = 50 + (Math.abs(score) - 3) * 8;
    reason = `Moderate SELL: ${reason}`;
  } else {
    signal = 'HOLD';
    confidence = 30 + Math.abs(score) * 5;
    reason = `HOLD: ${reason}`;
  }

  confidence = Math.min(confidence, 100);
  confidence = Math.max(confidence, 20);

  return { signal, confidence, reason };
}

// ─── Main endpoint ────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // ─── Try NVIDIA AI first ──────────────────────────────────────
    const rsi = indicators?.rsi ?? 50;
    const macd = indicators?.macd ?? 0;
    const ema = indicators?.ema ?? price;

    const prompt = `BTC/USDT price: $${price}, RSI: ${rsi}, EMA: ${ema}, MACD: ${macd}. Provide trading signal (BUY/SELL/HOLD) with confidence and reason. JSON only.`;

    const results = await Promise.allSettled(
      MODELS.map(model => queryNvidiaModel(model, prompt))
    );
    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value.data);

    if (successful.length > 0) {
      const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
      successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
      const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
      const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);

      return res.json({
        signal: finalSignal,
        confidence: avgConfidence,
        reason: `NVIDIA AI: ${successful.map(d => d.reason).join(' ')}`,
        breakdown: successful.map((d, i) => ({
          model: MODELS[i],
          signal: d.signal,
          confidence: d.confidence,
          reason: d.reason,
        })),
      });
    }

    // ─── Fallback: technical indicators ──────────────────────────
    let closesData = closes || [];
    if (closesData.length < 30) {
      // Try to fetch from Binance if not provided
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=50`;
        const response = await fetch(url);
        const data = await response.json();
        closesData = data.map(c => parseFloat(c[4]));
      } catch (e) {
        console.warn('Could not fetch candles, using provided data');
      }
    }

    const ind = calculateIndicators(closesData);
    const result = generateSignal(ind);
    return res.json(result);

  } catch (error) {
    console.error('[AI] Error:', error.message);
    // Ultimate fallback: use provided indicators
    const rsi = indicators?.rsi ?? 50;
    const macd = indicators?.macd ?? 0;
    let signal = 'HOLD';
    let confidence = 30;
    let reason = 'Fallback';
    if (rsi < 30) { signal = 'BUY'; confidence = 70; reason = 'RSI oversold'; }
    else if (rsi > 70) { signal = 'SELL'; confidence = 70; reason = 'RSI overbought'; }
    return res.json({ signal, confidence, reason });
  }
});

// ─── NVIDIA query helper ──────────────────────────────────────────
async function queryNvidiaModel(model, prompt) {
  try {
    const completion = await nvidiaClient.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 256,
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
    return { model, success: false, error: error.message };
  }
}

// ─── Status endpoint ───────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    await nvidiaClient.chat.completions.create({
      model: 'deepseek-ai/deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 10,
    });
    res.json({ nvidia: 'connected', models: MODELS });
  } catch (error) {
    res.json({ nvidia: 'error', message: error.message });
  }
});

module.exports = router;
