global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');
const { EMA, ADX } = require('technicalindicators');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Use the model that was tested in the Python script
const MODEL = 'z-ai/glm-5.2';

// ─── Safe number helper ──────────────────────────────────────────
function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return isNaN(num) ? fallback : num;
}

// ─── Query NVIDIA with retries ──────────────────────────────────
async function queryNvidiaModel(prompt) {
  const messages = [{ role: 'user', content: prompt }];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await nvidiaClient.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.4,
        top_p: 0.9,
        max_tokens: 700,
        stream: false,
        timeout: 15000,
      });
      const content = completion.choices[0].message.content;
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON returned');
        parsed = JSON.parse(match[0]);
      }
      if (parsed.signal && parsed.confidence !== undefined) {
        return { success: true, data: parsed };
      }
      const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
      const confidenceMatch = content.match(/(\d{1,3})%/);
      return {
        success: true,
        data: {
          signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
          confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
          reason: content.slice(0, 300),
        },
      };
    } catch (error) {
      lastError = error;
      console.warn(`[AI] Attempt ${attempt+1} failed:`, error.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.error('[AI] All NVIDIA attempts failed:', lastError?.message);
  return { success: false, error: lastError?.message || 'Unknown error' };
}

// ─── Compute EMAs with fallback ──────────────────────────────────
function computeExtraIndicators(closes) {
  if (!closes || closes.length === 0) {
    return { ema20: 0, ema50: 0, ema200: 0 };
  }
  const lastClose = closes[closes.length-1] || 0;
  let ema20 = lastClose, ema50 = lastClose, ema200 = lastClose;
  try {
    if (closes.length >= 20) {
      const e20 = EMA.calculate({ period: 20, values: closes });
      if (e20 && e20.length > 0) ema20 = e20[e20.length-1];
    }
    if (closes.length >= 50) {
      const e50 = EMA.calculate({ period: 50, values: closes });
      if (e50 && e50.length > 0) ema50 = e50[e50.length-1];
    }
    if (closes.length >= 200) {
      const e200 = EMA.calculate({ period: 200, values: closes });
      if (e200 && e200.length > 0) ema200 = e200[e200.length-1];
    }
  } catch (e) {
    console.warn('[AI] EMA calculation failed, using fallback');
  }
  return {
    ema20: safeNumber(ema20, lastClose),
    ema50: safeNumber(ema50, lastClose),
    ema200: safeNumber(ema200, lastClose),
  };
}

// ─── Compute ADX with fallback ──────────────────────────────────
function computeADX(closes) {
  if (!closes || closes.length < 14) return 25;
  try {
    const adx = ADX.calculate({
      high: closes.map(c => c * 1.001),
      low: closes.map(c => c * 0.999),
      close: closes,
      period: 14
    });
    if (adx && adx.length > 0) {
      const val = adx[adx.length-1];
      return safeNumber(val, 25);
    }
    return 25;
  } catch {
    return 25;
  }
}

// ─── Rule‑based fallback (if AI fails) ─────────────────────────
function ruleBasedSignal(ind, currentPrice, extra, adx) {
  let score = 0;
  const { rsi, macd, ema20, ema50 } = ind;
  const { ema20: e20, ema50: e50, ema200: e200 } = extra;
  const reasons = [];

  if (rsi < 30) { score += 2; reasons.push('RSI oversold'); }
  else if (rsi > 70) { score -= 2; reasons.push('RSI overbought'); }
  else if (rsi < 45) { score += 1; reasons.push('RSI low'); }
  else if (rsi > 55) { score -= 1; reasons.push('RSI high'); }

  if (macd > 0) { score += 1; reasons.push('MACD positive'); }
  else if (macd < 0) { score -= 1; reasons.push('MACD negative'); }

  if (currentPrice > e20 && e20 > e50 && e50 > e200) { score += 2; reasons.push('Strong uptrend'); }
  else if (currentPrice < e20 && e20 < e50 && e50 < e200) { score -= 2; reasons.push('Strong downtrend'); }
  else if (currentPrice > e20 && e20 > e50) { score += 1; reasons.push('Uptrend'); }
  else if (currentPrice < e20 && e20 < e50) { score -= 1; reasons.push('Downtrend'); }

  let signal = 'HOLD';
  let confidence = 30;
  if (score >= 3) { signal = 'BUY'; confidence = 60 + score * 5; }
  else if (score <= -3) { signal = 'SELL'; confidence = 60 + Math.abs(score) * 5; }
  else if (score >= 2) { signal = 'BUY'; confidence = 50 + score * 5; }
  else if (score <= -2) { signal = 'SELL'; confidence = 50 + Math.abs(score) * 5; }
  else { signal = 'HOLD'; confidence = 30 + Math.abs(score) * 5; }
  confidence = Math.min(100, Math.max(0, confidence));

  return {
    signal,
    confidence,
    reason: `Rule‑based: ${reasons.join(', ')}`,
    trend: (score > 0) ? 'Bullish' : (score < 0) ? 'Bearish' : 'Sideways',
    market_regime: (adx > 25) ? 'Trending' : 'Ranging',
  };
}

// ─── Main AI analysis function ──────────────────────────────────
async function getAIAnalysis(email, symbol, price, closes) {
  try {
    const data = await instance.getAnalysisData(symbol);
    if (!data || !data.closes || data.closes.length < 20) {
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data (need ≥20 candles)' };
    }

    const ind = instance.calculateIndicators(data.closes);
    if (!ind) {
      return { signal: 'HOLD', confidence: 0, reason: 'Indicator calculation failed' };
    }

    // Validate and sanitize indicators
    const rsi = safeNumber(ind.rsi);
    const macd = safeNumber(ind.macd);
    const atr = safeNumber(ind.atr);
    const bbUpper = safeNumber(ind.bbUpper);
    const bbLower = safeNumber(ind.bbLower);
    const currentPrice = price || data.price || ind.currentPrice || 0;
    const extra = computeExtraIndicators(data.closes);
    const adx = computeADX(data.closes);

    // ─── Try NVIDIA AI first ──────────────────────────────────────
    const prompt = `You are a professional crypto trader. Analyze:
Price: $${currentPrice.toFixed(2)}
RSI: ${rsi.toFixed(2)}
MACD: ${macd.toFixed(4)}
EMA20: ${extra.ema20.toFixed(2)}
EMA50: ${extra.ema50.toFixed(2)}
EMA200: ${extra.ema200.toFixed(2)}
ATR: ${atr.toFixed(4)}
ADX: ${adx.toFixed(2)}
Bollinger Upper: ${bbUpper.toFixed(2)}
Bollinger Lower: ${bbLower.toFixed(2)}
Return JSON: {"signal":"BUY|SELL|HOLD","confidence":0,"reason":"..."}`;

    let result;
    try {
      result = await queryNvidiaModel(prompt);
    } catch (error) {
      console.error('[AI] NVIDIA query error:', error.message);
      result = { success: false };
    }

    let ai = null;
    if (result && result.success) {
      ai = result.data;
    }

    // ─── Fallback to rule‑based if AI failed ────────────────────
    if (!ai || !ai.signal || ai.confidence < 0) {
      console.log('[AI] Using rule‑based fallback');
      const fallback = ruleBasedSignal(ind, currentPrice, extra, adx);
      return {
        signal: fallback.signal,
        confidence: fallback.confidence,
        trend: fallback.trend,
        market_regime: fallback.market_regime,
        entry_price: currentPrice,
        stop_loss: 0,
        take_profit: 0,
        risk_reward: '1:1',
        expected_move_percent: 0,
        trade_duration: 'Intraday',
        reason: fallback.reason,
        pros: ['Rule‑based signal'],
        cons: ['No AI confirmation'],
        indicator_scores: { RSI: 0, MACD: 0, EMA: 0, ADX: 0, Volume: 0, Trend: 0, SupportResistance: 0 },
        data: { price: currentPrice, rsi, macd, ema20: extra.ema20, ema50: extra.ema50, ema200: extra.ema200, atr, adx },
      };
    }

    // ─── Process AI response ──────────────────────────────────────
    const confidence = Math.max(0, Math.min(100, Number(ai.confidence) || 0));
    let signal = ai.signal || 'HOLD';
    let reason = ai.reason || '';

    // Reject if too close to S/R
    const support = Math.min(...data.closes) * 0.99;
    const resistance = Math.max(...data.closes) * 1.01;
    if (signal === 'BUY' && Math.abs(resistance - currentPrice) / currentPrice < 0.01) {
      signal = 'HOLD';
      reason += ' Too close to resistance.';
    }
    if (signal === 'SELL' && Math.abs(currentPrice - support) / currentPrice < 0.01) {
      signal = 'HOLD';
      reason += ' Too close to support.';
    }

    if (confidence < 75) {
      signal = 'HOLD';
      reason = (reason ? reason + ' ' : '') + '(confidence below 75%)';
    }

    return {
      signal: signal,
      confidence: confidence,
      trend: ai.trend || 'Sideways',
      market_regime: ai.market_regime || 'Ranging',
      entry_price: safeNumber(ai.entry_price, currentPrice),
      stop_loss: safeNumber(ai.stop_loss, 0),
      take_profit: safeNumber(ai.take_profit, 0),
      risk_reward: ai.risk_reward || '1:1',
      expected_move_percent: safeNumber(ai.expected_move_percent, 0),
      trade_duration: ai.trade_duration || 'Intraday',
      reason: reason || 'No reason provided',
      pros: Array.isArray(ai.pros) ? ai.pros : [],
      cons: Array.isArray(ai.cons) ? ai.cons : [],
      indicator_scores: ai.indicator_scores || {},
      data: {
        price: currentPrice,
        rsi: rsi,
        macd: macd,
        ema20: extra.ema20,
        ema50: extra.ema50,
        ema200: extra.ema200,
        atr: atr,
        adx: adx,
      },
    };
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return { signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message };
  }
}

// ─── HTTP endpoints ──────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const email = req.user?.email || req.body.email || 'demo@example.com';
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const result = await getAIAnalysis(email, symbol, null, null);
    res.json(result);
  } catch (error) {
    console.error('[AI] Endpoint error:', error.message);
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
