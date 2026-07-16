global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Use only the faster, more reliable model
const MODEL = 'deepseek-ai/deepseek-v4-pro';

async function queryNvidiaModel(prompt) {
  try {
    const completion = await nvidiaClient.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,          // lower = more deterministic
      top_p: 0.9,
      max_tokens: 600,           // enough for detailed JSON
      stream: false,
      timeout: 10000,            // 10 seconds
    });
    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal && parsed.confidence !== undefined) {
        return { success: true, data: parsed };
      }
    }
    // If not JSON, try to extract basic info
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
    console.error('[AI] Model error:', error.message);
    return { success: false, error: error.message };
  }
}

// ─── Helper: compute extra indicators ─────────────────────────────
function computeExtraIndicators(closes, highs, lows, volumes) {
  // Minimal – you can expand later
  const avgVolume = volumes ? volumes.reduce((a,b) => a+b, 0) / volumes.length : 0;
  const currentVolume = volumes ? volumes[volumes.length-1] : 0;
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const support = low * 0.99;
  const resistance = high * 1.01;
  // Trend from EMA alignment
  const ema20 = closes.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, closes.length);
  const ema50 = closes.slice(-50).reduce((a,b) => a+b, 0) / Math.min(50, closes.length);
  const ema200 = closes.slice(-200).reduce((a,b) => a+b, 0) / Math.min(200, closes.length);
  let trend = 'Sideways';
  if (ema20 > ema50 && ema50 > ema200) trend = 'Bullish';
  else if (ema20 < ema50 && ema50 < ema200) trend = 'Bearish';
  // Multi‑timeframe – simplified
  const trend1m = trend; // placeholder
  const trend5m = trend;
  const trend15m = trend;
  const trend1h = trend;
  return {
    avgVolume,
    currentVolume,
    high,
    low,
    support,
    resistance,
    trend,
    trend1m,
    trend5m,
    trend15m,
    trend1h,
  };
}

router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const data = await instance.getAnalysisData(symbol);
    console.log(`[AI] Fetched ${data.closes.length} candles for ${symbol}`);
    if (!data || !data.closes || data.closes.length < 20) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Insufficient data (need 20+ candles)' });
    }

    const ind = instance.calculateIndicators(data.closes);
    if (!ind) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Indicator calculation failed' });
    }

    const extra = computeExtraIndicators(
      data.closes,
      data.highs || [],
      data.lows || [],
      data.volumes || []
    );

    const currentPrice = data.price || ind.currentPrice;

    // ─── Build the professional prompt ──────────────────────────────
    const prompt = `You are an institutional-grade cryptocurrency trading analyst specializing in Binance spot and futures markets.

Your objective is to maximize risk-adjusted returns, not the number of trades.

Analyze the following market data:

Market: ${symbol}
Current Price: $${currentPrice}

Technical Indicators
- RSI(14): ${ind.rsi.toFixed(2)}
- MACD: ${ind.macd.toFixed(4)}
- EMA20: ${ind.ema20.toFixed(2)}
- EMA50: ${ind.ema50.toFixed(2)}
- EMA200: ${ind.ema50.toFixed(2)} (approximated)
- ATR(14): ${ind.atr.toFixed(4)}
- ADX: ${ind.adx || 25}
- Bollinger Upper: ${ind.bbUpper.toFixed(2)}
- Bollinger Lower: ${ind.bbLower.toFixed(2)}
- Volume: ${extra.currentVolume}
- Average Volume: ${extra.avgVolume}

Market Structure
- Trend: ${extra.trend}
- Support: $${extra.support.toFixed(2)}
- Resistance: $${extra.resistance.toFixed(2)}
- Recent High: $${extra.high.toFixed(2)}
- Recent Low: $${extra.low.toFixed(2)}

Multi-Timeframe
- 1m Trend: ${extra.trend1m}
- 5m Trend: ${extra.trend5m}
- 15m Trend: ${extra.trend15m}
- 1h Trend: ${extra.trend1h}

Risk Rules
- Never recommend a trade with Risk:Reward below 1:2.
- Reject trades that move directly into support or resistance.
- Reject trades with conflicting multi-timeframe trends.
- Require confirmation from at least three independent indicators.
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
  "pros":[
    "...",
    "...",
    "..."
  ],
  "cons":[
    "...",
    "...",
    "..."
  ],
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

    // ─── Query the single model ──────────────────────────────────────
    const result = await queryNvidiaModel(prompt);
    if (!result.success) {
      // Fallback to rule‑based (only if AI fails completely)
      return res.json({
        signal: 'HOLD',
        confidence: 0,
        reason: 'AI model unavailable',
        data: { price: currentPrice, rsi: ind.rsi, macd: ind.macd },
      });
    }

    const ai = result.data;
    // Enforce the 75% confidence rule
    if (ai.confidence < 75) {
      ai.signal = 'HOLD';
      ai.reason = (ai.reason || '') + ' (confidence below 75%)';
    }

    // Ensure we have all fields, fill defaults
    const response = {
      signal: ai.signal || 'HOLD',
      confidence: ai.confidence || 0,
      trend: ai.trend || 'Sideways',
      market_regime: ai.market_regime || 'Ranging',
      entry_price: ai.entry_price || currentPrice,
      stop_loss: ai.stop_loss || 0,
      take_profit: ai.take_profit || 0,
      risk_reward: ai.risk_reward || '1:1',
      expected_move_percent: ai.expected_move_percent || 0,
      trade_duration: ai.trade_duration || 'Intraday',
      reason: ai.reason || 'No reason provided',
      pros: ai.pros || [],
      cons: ai.cons || [],
      indicator_scores: ai.indicator_scores || {},
      data: {
        price: currentPrice,
        rsi: ind.rsi,
        macd: ind.macd,
        ema20: ind.ema20,
        ema50: ind.ema50,
        atr: ind.atr,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('[AI] Error:', error.message);
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
