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

const RESEARCH_MODEL = 'deepseek-ai/deepseek-v4-flash';
const DECISION_MODEL = 'z-ai/glm-5.2';

// ─── Helper: OpenAI call with one retry ──────────────────────────
async function openaiCall(model, messages, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const attempt = async (tryNum) => {
    try {
      const result = await nvidiaClient.chat.completions.create(
        { model, messages, ...opts },
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      if (tryNum === 1) {
        console.warn(`[AI] ${model} attempt 1 failed:`, err.message);
        // One retry
        await new Promise(r => setTimeout(r, 1000));
        try {
          const result = await nvidiaClient.chat.completions.create(
            { model, messages, ...opts },
            { signal: controller.signal }
          );
          clearTimeout(timeoutId);
          return result;
        } catch (err2) {
          clearTimeout(timeoutId);
          throw err2;
        }
      }
      clearTimeout(timeoutId);
      throw err;
    }
  };
  return attempt(1);
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// ─── Rule‑based fallback (no AI) ──────────────────────────────────
function ruleBasedSignal(ind, currentPrice, extra) {
  let score = 0;
  const reasons = [];
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
  confidence = Math.min(100, Math.max(0, confidence));
  if (confidence < 75) signal = 'HOLD';

  return {
    signal,
    confidence,
    reason: `Rule‑based: ${reasons.join(', ')}`,
    trend: score > 0 ? 'Bullish' : score < 0 ? 'Bearish' : 'Sideways',
    market_regime: 'Ranging',
  };
}

// ─── Main analysis ──────────────────────────────────────────────────
async function getAIAnalysis(email, symbol, price, closes) {
  const start = Date.now();

  try {
    console.log('[AI] Fetching market data...');
    const data = await instance.getAnalysisData(symbol);
    if (!data || !data.closes || data.closes.length < 20) {
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient market data' };
    }

    console.log('[AI] Calculating indicators...');
    const ind = instance.calculateIndicators(data.closes);
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

    // ─── Attempt AI decision (only if NVIDIA client exists) ──────
    let aiResult = null;
    if (nvidiaClient) {
      try {
        console.log('[AI] Calling GLM for decision...');
        const prompt = `Analyze ${symbol} at $${currentPrice}.
RSI: ${rsi.toFixed(2)}, MACD: ${macd.toFixed(4)}
EMA20: ${ema20.toFixed(2)}, EMA50: ${ema50.toFixed(2)}, EMA200: ${ema200.toFixed(2)}
ATR: ${atr.toFixed(4)}, BB Upper: ${bbUpper.toFixed(2)}, BB Lower: ${bbLower.toFixed(2)}
Return JSON: {"signal":"BUY|SELL|HOLD","confidence":0,"reason":"..."}`;

        const decision = await openaiCall(
          DECISION_MODEL,
          [{ role: 'user', content: prompt }],
          { temperature: 0.4, max_tokens: 300 },
          8000 // 8s timeout
        );

        const content = decision.choices[0].message.content;
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          aiResult = {
            signal: parsed.signal || 'HOLD',
            confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
            reason: parsed.reason || 'AI decision',
            trend: parsed.trend || 'Sideways',
            market_regime: parsed.market_regime || 'Ranging',
          };
          console.log('[AI] GLM decision:', aiResult.signal, aiResult.confidence);
        }
      } catch (e) {
        console.warn('[AI] GLM failed:', e.message);
      }
    }

    // ─── If AI succeeded and confidence ≥ 75, use it ──────────────
    if (aiResult && aiResult.confidence >= 75) {
      return {
        signal: aiResult.signal,
        confidence: aiResult.confidence,
        trend: aiResult.trend || 'Sideways',
        market_regime: aiResult.market_regime || 'Ranging',
        entry_price: currentPrice,
        stop_loss: 0,
        take_profit: 0,
        risk_reward: '1:1',
        expected_move_percent: 0,
        trade_duration: 'Intraday',
        reason: aiResult.reason || 'AI signal',
        pros: [],
        cons: [],
        indicator_scores: {},
        data: { price: currentPrice, rsi, macd, ema20, ema50, ema200, atr },
      };
    }

    // ─── Fallback: rule‑based signal ──────────────────────────────
    console.log('[AI] Using rule‑based fallback');
    const fallback = ruleBasedSignal(ind, currentPrice, { ema20, ema50 });
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
      reason: fallback.reason + (aiResult ? ' (AI unavailable)' : ''),
      pros: [],
      cons: [],
      indicator_scores: {},
      data: { price: currentPrice, rsi, macd, ema20, ema50, ema200, atr },
    };
  } catch (error) {
    console.error('[AI] Fatal error:', error.message);
    return {
      signal: 'HOLD',
      confidence: 0,
      reason: `Error: ${error.message}`,
    };
  } finally {
    console.log(`[AI] Total time: ${Date.now() - start}ms`);
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
    const result = await Promise.race([getAIAnalysis(email, symbol, null, null), timeout]);
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
