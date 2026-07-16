global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');

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

router.post('/analyze', async (req, res) => {
  const { email, symbol = req.body.market || 'BTCUSDT' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const data = await instance.getAnalysisData(symbol);
    console.log(`[AI] Fetched ${data.closes.length} candles for ${symbol}`);
    if (!data || !data.closes || data.closes.length < 14) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Insufficient data from Binance' });
    }

    const ind = instance.calculateIndicators(data.closes);
    if (!ind) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Indicator calculation failed' });
    }

    const currentPrice = data.price || ind.currentPrice;

    const prompt = `You are a professional cryptocurrency trader.

Analyze the following market data for ${symbol}:
Price: $${currentPrice}
RSI: ${ind.rsi.toFixed(2)}
MACD: ${ind.macd.toFixed(4)}
EMA20: ${ind.ema20.toFixed(2)}
EMA50: ${ind.ema50.toFixed(2)}
ATR: ${ind.atr.toFixed(4)}
Bollinger Upper: ${ind.bbUpper.toFixed(2)}
Bollinger Lower: ${ind.bbLower.toFixed(2)}
VWAP: ${ind.vwap.toFixed(2)}
ADX: ${ind.adx.toFixed(2)}

Provide a trading signal (BUY, SELL, or HOLD) with:
- Confidence (0-100)
- Brief reason (max 30 words)

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
        data: {
          price: currentPrice,
          rsi: ind.rsi,
          macd: ind.macd,
          ema20: ind.ema20,
          ema50: ind.ema50,
          atr: ind.atr,
        },
      });
    }

    // ─── Fallback (only if NVIDIA fails) ──────────────────────────
    let score = 0;
    let reasons = [];
    const { rsi, macd, ema20, ema50 } = ind;
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

    res.json({
      signal,
      confidence,
      reason: `Fallback: ${reasons.join(', ')}`,
      data: {
        price: currentPrice,
        rsi: ind.rsi,
        macd: ind.macd,
        ema20: ind.ema20,
        ema50: ind.ema50,
        atr: ind.atr,
      },
    });
  } catch (error) {
    console.error('[AI] Error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

router.get('/market-data', async (req, res) => {
  const { symbol = 'BTCUSDT' } = req.query;
  try {
    const data = await instance.getAnalysisData(symbol);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
