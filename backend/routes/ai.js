const router = require('express').Router();
const OpenAI = require('openai');
const fetch = require('node-fetch');

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
        reason: content.slice(0, 200) || 'No reason',
      },
    };
  } catch (error) {
    console.error(`Model ${model} failed:`, error.message);
    return { model, success: false, error: error.message };
  }
}

function calculateIndicators(closes) {
  if (!closes || closes.length < 14) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains / (closes.length - 1);
  const avgLoss = losses / (closes.length - 1);
  const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  const ema12 = closes.slice(-12).reduce((a,b) => a+b, 0) / Math.min(12, closes.length);
  const ema26 = closes.slice(-26).reduce((a,b) => a+b, 0) / Math.min(26, closes.length);
  const macd = ema12 - ema26;
  const ema20 = closes.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, closes.length);
  const ema50 = closes.slice(-50).reduce((a,b) => a+b, 0) / Math.min(50, closes.length);
  let atr = 0;
  if (closes.length > 14) {
    let trSum = 0;
    for (let i = 1; i < closes.length; i++) {
      const high = closes[i] * 1.001;
      const low = closes[i] * 0.999;
      const prevClose = closes[i-1];
      trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    atr = trSum / (closes.length - 1);
  }
  return { rsi, macd, ema20, ema50, atr };
}

router.post('/analyze', async (req, res) => {
  const { email, market, price, indicators, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    let closesData = closes;
    if (!closesData || closesData.length < 14) {
      const symbol = market?.replace('/', '') || 'BTCUSDT';
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=50`;
      const response = await fetch(url);
      const data = await response.json();
      closesData = data.map(c => parseFloat(c[4]));
    }

    const ind = calculateIndicators(closesData);
    if (!ind) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Insufficient data' });
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

    const results = await Promise.allSettled(MODELS.map(model => queryNvidiaModel(model, prompt)));
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value.data);

    if (successful.length > 0) {
      const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
      successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
      const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
      const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);
      const reasons = successful.map(d => d.reason);
      return res.json({
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
    }

    let score = 0;
    let reasons = [];
    if (rsi < 30) { score += 2; reasons.push('RSI oversold'); }
    else if (rsi > 70) { score -= 2; reasons.push('RSI overbought'); }
    else if (rsi < 45) { score += 1; reasons.push('RSI low'); }
    else if (rsi > 55) { score -= 1; reasons.push('RSI high'); }
    if (macd > 0) { score += 1; reasons.push('MACD positive'); }
    else if (macd < 0) { score -= 1; reasons.push('MACD negative'); }
    if (currentPrice > ema20 && ema20 > ema50) { score += 1; reasons.push('Uptrend'); }
    else if (currentPrice < ema20 && ema20 < ema50) { score -= 1; reasons.push('Downtrend'); }

    let signal = 'HOLD';
    let confidence = 30;
    if (score >= 2) { signal = 'BUY'; confidence = 60 + score * 5; }
    else if (score <= -2) { signal = 'SELL'; confidence = 60 + Math.abs(score) * 5; }
    else { signal = 'HOLD'; confidence = 30 + Math.abs(score) * 5; }
    confidence = Math.min(confidence, 100);

    res.json({ signal, confidence, reason: `Fallback: ${reasons.join(', ')}` });
  } catch (error) {
    console.error('[AI] Error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

module.exports = router;
