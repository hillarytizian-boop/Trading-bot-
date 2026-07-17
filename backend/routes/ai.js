global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');
const { EMA, ADX } = require('technicalindicators');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODEL = 'deepseek-ai/deepseek-v4-pro';

// ─── Safe number helper ──────────────────────────────────────────
function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return isNaN(num) ? fallback : num;
}

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
  throw lastError || new Error('All NVIDIA attempts failed');
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

// ─── Main AI analysis function ──────────────────────────────────
async function getAIAnalysis(email, symbol, price, closes) {
  try {
    const data = await instance.getAnalysisData(symbol);
    if (!data || !data.closes || data.closes.length < 20) {
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data (need ≥20 candles)' };
    }

    // ─── Calculate indicators ──────────────────────────────────────
    const ind = instance.calculateIndicators(data.closes);
    if (!ind) {
      return { signal: 'HOLD', confidence: 0, reason: 'Indicator calculation failed' };
    }

    // ─── Validate all indicator values ──────────────────────────────
    const rsi = safeNumber(ind.rsi);
    const macd = safeNumber(ind.macd);
    const ema20 = safeNumber(ind.ema20);
    const ema50 = safeNumber(ind.ema50);
    const atr = safeNumber(ind.atr);
    const bbUpper = safeNumber(ind.bbUpper);
    const bbLower = safeNumber(ind.bbLower);
    const currentPrice = price || data.price || ind.currentPrice || 0;

    // ─── Extra indicators (EMAs) ──────────────────────────────────
    const extra = computeExtraIndicators(data.closes);
    const adx = computeADX(data.closes);

    // ─── Reject weak trend ──────────────────────────────────────────
    if (adx < 20) {
      return {
        signal: 'HOLD',
        confidence: 40,
        reason: `Weak trend (ADX ${adx.toFixed(1)} < 20). Market is ranging.`,
      };
    }

    // ─── Build prompt (all values guaranteed numbers) ──────────────
    const prompt = `You are an institutional-grade cryptocurrency trading analyst specializing in Binance spot and futures markets.

Your objective is to maximize risk-adjusted returns, not the number of trades.

Analyze the following market data:

Market: ${symbol}
Current Price: $${currentPrice.toFixed(2)}

Technical Indicators
- RSI(14): ${rsi.toFixed(2)}
- MACD: ${macd.toFixed(4)}
- EMA20: ${extra.ema20.toFixed(2)}
- EMA50: ${extra.ema50.toFixed(2)}
- EMA200: ${extra.ema200.toFixed(2)}
- ATR(14): ${atr.toFixed(4)}
- ADX: ${adx.toFixed(2)}
- Bollinger Upper: ${bbUpper.toFixed(2)}
- Bollinger Lower: ${bbLower.toFixed(2)}
- Volume: ${data.volumes?.[data.volumes.length-1] || 0}
- Average Volume: ${data.volumes ? (data.volumes.reduce((a,b) => a+b, 0) / data.volumes.length).toFixed(2) : 0}

Market Structure
- Trend: ${extra.ema20 > extra.ema50 && extra.ema50 > extra.ema200 ? 'Bullish' : extra.ema20 < extra.ema50 && extra.ema50 < extra.ema200 ? 'Bearish' : 'Sideways'}
- Support: ${(Math.min(...data.closes) * 0.99).toFixed(2)}
- Resistance: ${(Math.max(...data.closes) * 1.01).toFixed(2)}
- Recent High: ${Math.max(...data.closes).toFixed(2)}
- Recent Low: ${Math.min(...data.closes).toFixed(2)}

Multi-Timeframe
- 1m Trend: ${extra.ema20 > extra.ema50 ? 'Bullish' : 'Bearish'}
- 5m Trend: ${extra.ema20 > extra.ema50 ? 'Bullish' : 'Bearish'}
- 15m Trend: ${extra.ema20 > extra.ema50 ? 'Bullish' : 'Bearish'}
- 1h Trend: ${extra.ema20 > extra.ema50 ? 'Bullish' : 'Bearish'}

Risk Rules
- Never recommend a trade with Risk:Reward below 1:2.
- Reject trades that move directly into support or resistance.
- Reject trades with conflicting multi-timeframe trends.
- A BUY requires at least five bullish confirmations. A SELL requires at least five bearish confirmations.
  Indicators include RSI, MACD, EMA20, EMA50, EMA200, ADX, ATR, Bollinger Bands, Volume, Support/Resistance, Trend.
- Do not recommend trades against the higher timeframe trend.
- Return HOLD if fewer than five confirmations agree.
- Prefer trading with the dominant trend.
- Consider volatility before setting stop-loss.
- If confidence is below 75%, return HOLD.

Evaluate:

1. Trend strength
2. Momentum
3. Volatility
4. Volume confirmation
5. Indicator agreement
6. Breakout or reversal probability
7. Risk versus reward
8. Probability of success

Return ONLY valid JSON.

{
  "signal":"BUY|SELL|HOLD",
  "confidence":0,
  "trend":"Bullish|Bearish|Sideways",
  "market_regime":"Trending|Ranging|High Volatility",
  "entry_price":0,
  "stop_loss":0,
  "take_profit":0,
  "risk_reward":"1:2.5",
  "expected_move_percent":0,
  "trade_duration":"Scalp|Intraday|Swing",
  "reason":"Detailed explanation using all indicators.",
  "pros":["...","...","..."],
  "cons":["...","...","..."],
  "indicator_scores":{
    "RSI":0,
    "MACD":0,
    "EMA":0,
    "ADX":0,
    "Volume":0,
    "Trend":0,
    "SupportResistance":0
  }
}

Do not invent missing information.
If the provided data is insufficient, explain why and return HOLD.
Return only JSON with no markdown or additional text.`;

    let result;
    try {
      result = await queryNvidiaModel(prompt);
    } catch (error) {
      console.error('[AI] All NVIDIA attempts failed:', error.message);
      return { signal: 'HOLD', confidence: 0, reason: 'AI model unavailable' };
    }

    if (!result.success) {
      return { signal: 'HOLD', confidence: 0, reason: 'AI model error' };
    }

    let ai = result.data;
    const confidence = Math.max(0, Math.min(100, Number(ai.confidence) || 0));

    // ─── Reject if too close to S/R ──────────────────────────────────
    const support = Math.min(...data.closes) * 0.99;
    const resistance = Math.max(...data.closes) * 1.01;
    if (ai.signal === 'BUY' && Math.abs(resistance - currentPrice) / currentPrice < 0.01) {
      ai.signal = 'HOLD';
      ai.reason = (ai.reason || '') + ' Too close to resistance.';
    }
    if (ai.signal === 'SELL' && Math.abs(currentPrice - support) / currentPrice < 0.01) {
      ai.signal = 'HOLD';
      ai.reason = (ai.reason || '') + ' Too close to support.';
    }

    if (confidence < 75) {
      ai.signal = 'HOLD';
      ai.reason = (ai.reason || '') + ' (confidence below 75%)';
    }

    return {
      signal: ai.signal || 'HOLD',
      confidence: confidence,
      trend: ai.trend || 'Sideways',
      market_regime: ai.market_regime || 'Ranging',
      entry_price: safeNumber(ai.entry_price, currentPrice),
      stop_loss: safeNumber(ai.stop_loss, 0),
      take_profit: safeNumber(ai.take_profit, 0),
      risk_reward: ai.risk_reward || '1:1',
      expected_move_percent: safeNumber(ai.expected_move_percent, 0),
      trade_duration: ai.trade_duration || 'Intraday',
      reason: ai.reason || 'No reason provided',
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
