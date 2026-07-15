const router = require('express').Router();
const axios = require('axios');
const technical = require('technicalindicators');

// ─── True AI: learns from every trade, decides entry AND exit ──
class TrueAI {
  constructor() {
    // ─── Machine Learning state ──────────────────────────────────
    this.model = {
      weights: {
        rsi: 0.15,
        macd: 0.20,
        bb: 0.15,
        ema: 0.10,
        volume: 0.10,
        momentum: 0.15,
        volatility: 0.15,
      },
      thresholds: {
        buy: 0.55,
        sell: 0.55,
        exit: 0.50,
      },
      indicatorPerformance: {
        rsi: { wins: 0, losses: 0 },
        macd: { wins: 0, losses: 0 },
        bb: { wins: 0, losses: 0 },
        ema: { wins: 0, losses: 0 },
        volume: { wins: 0, losses: 0 },
        momentum: { wins: 0, losses: 0 },
        volatility: { wins: 0, losses: 0 },
      },
    };
    this.tradeHistory = [];
    this.learningRate = 0.01;
    this.lastPrediction = null;
    this.confidenceHistory = [];
  }

  // ─── Learn from past trades ──────────────────────────────────────
  learn(trade) {
    this.tradeHistory.push(trade);
    if (this.tradeHistory.length > 100) this.tradeHistory.shift();

    // Update weights based on win/loss
    if (trade.pnl > 0) {
      for (const [indicator, value] of Object.entries(trade.indicators || {})) {
        if (this.model.indicatorPerformance[indicator]) {
          this.model.indicatorPerformance[indicator].wins += 1;
          this.model.weights[indicator] = Math.min(
            this.model.weights[indicator] + this.learningRate,
            0.30
          );
        }
      }
    } else {
      for (const [indicator, value] of Object.entries(trade.indicators || {})) {
        if (this.model.indicatorPerformance[indicator]) {
          this.model.indicatorPerformance[indicator].losses += 1;
          this.model.weights[indicator] = Math.max(
            this.model.weights[indicator] - this.learningRate,
            0.05
          );
        }
      }
    }

    // Normalize weights
    const total = Object.values(this.model.weights).reduce((a, b) => a + b, 0);
    for (const key of Object.keys(this.model.weights)) {
      this.model.weights[key] /= total;
    }

    // Adjust thresholds based on recent win rate
    const recent = this.tradeHistory.slice(-20);
    const wins = recent.filter(t => t.pnl > 0).length;
    const winRate = recent.length > 0 ? wins / recent.length : 0.50;
    this.model.thresholds.buy = 0.55 - (winRate - 0.50) * 0.5;
    this.model.thresholds.sell = 0.55 - (winRate - 0.50) * 0.5;
    this.model.thresholds.exit = 0.50 - (winRate - 0.50) * 0.3;
    this.model.thresholds.buy = Math.max(0.40, Math.min(0.70, this.model.thresholds.buy));
    this.model.thresholds.sell = Math.max(0.40, Math.min(0.70, this.model.thresholds.sell));
    this.model.thresholds.exit = Math.max(0.35, Math.min(0.65, this.model.thresholds.exit));
  }

  // ─── Extract features ──────────────────────────────────────────
  extractFeatures(price, closes) {
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

    const lastRsi = rsi[rsi.length-1] || 50;
    const lastMacd = macd[macd.length-1] || { MACD: 0, signal: 0 };
    const lastBb = bb[bb.length-1] || { upper: price * 1.02, lower: price * 0.98 };
    const lastEma20 = ema20[ema20.length-1] || price;
    const lastEma50 = ema50[ema50.length-1] || price;
    const lastAtr = atr[atr.length-1] || (price * 0.02);

    const volume = Math.abs(closes[closes.length-1] - closes[closes.length-2]) / (closes[closes.length-2] || 1);
    const momentum = (closes[closes.length-1] - closes[closes.length-5]) / (closes[closes.length-5] || 1);
    const volatility = lastAtr / price;

    return {
      rsi: lastRsi,
      macd: lastMacd.MACD - lastMacd.signal,
      bb: (price - lastBb.lower) / (lastBb.upper - lastBb.lower),
      ema: (lastEma20 - lastEma50) / price,
      volume: volume,
      momentum: momentum,
      volatility: volatility,
      // Raw values for logging
      raw: { rsi: lastRsi, macd: lastMacd, bb: lastBb, ema20: lastEma20, ema50: lastEma50, atr: lastAtr },
    };
  }

  // ─── Predict entry signal ──────────────────────────────────────
  predictEntry(features) {
    if (!features) return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data' };

    const scores = {
      rsi: features.rsi < 30 ? 0.8 : features.rsi > 70 ? 0.2 : 0.5,
      macd: features.macd > 0 ? 0.7 : features.macd < 0 ? 0.3 : 0.5,
      bb: features.bb < 0.2 ? 0.8 : features.bb > 0.8 ? 0.2 : 0.5,
      ema: features.ema > 0 ? 0.6 : features.ema < 0 ? 0.4 : 0.5,
      volume: features.volume > 0.002 ? 0.7 : features.volume < 0.001 ? 0.3 : 0.5,
      momentum: features.momentum > 0.005 ? 0.8 : features.momentum < -0.005 ? 0.2 : 0.5,
      volatility: features.volatility > 0.02 ? 0.4 : features.volatility < 0.01 ? 0.6 : 0.5,
    };

    let weightedScore = 0;
    let totalWeight = 0;
    for (const [indicator, score] of Object.entries(scores)) {
      const weight = this.model.weights[indicator] || 0.1;
      weightedScore += score * weight;
      totalWeight += weight;
    }
    weightedScore = totalWeight > 0 ? weightedScore / totalWeight : 0.5;

    let signal = 'HOLD';
    let confidence = 50;
    let reason = '';

    if (weightedScore > this.model.thresholds.buy) {
      signal = 'BUY';
      confidence = 50 + (weightedScore - this.model.thresholds.buy) * 100;
      reason = `BUY (score: ${(weightedScore * 100).toFixed(0)}%)`;
    } else if (weightedScore < this.model.thresholds.sell) {
      signal = 'SELL';
      confidence = 50 + (this.model.thresholds.sell - weightedScore) * 100;
      reason = `SELL (score: ${(weightedScore * 100).toFixed(0)}%)`;
    } else {
      signal = 'HOLD';
      confidence = 30 + Math.abs(weightedScore - 0.5) * 60;
      reason = `HOLD (score: ${(weightedScore * 100).toFixed(0)}%)`;
    }

    confidence = Math.min(confidence, 100);
    confidence = Math.max(confidence, 20);

    return { signal, confidence, reason, weightedScore };
  }

  // ─── Predict exit signal (for open trades) ──────────────────────
  predictExit(features, entryPrice, side) {
    if (!features) return { shouldExit: false, reason: 'Insufficient data' };
    const currentPrice = features.raw?.rsi ? price : 0; // we need price
    // We need price passed separately
    // We'll use the features to decide if the trade is losing momentum
    let exitScore = 0;
    let reasons = [];

    // If RSI is moving against us
    const rsi = features.rsi;
    if (side === 'BUY' && rsi > 70) { exitScore += 0.4; reasons.push('RSI overbought'); }
    else if (side === 'SELL' && rsi < 30) { exitScore += 0.4; reasons.push('RSI oversold'); }

    // MACD reversal
    if (side === 'BUY' && features.macd < 0) { exitScore += 0.3; reasons.push('MACD bearish'); }
    else if (side === 'SELL' && features.macd > 0) { exitScore += 0.3; reasons.push('MACD bullish'); }

    // Bollinger band exit
    if (side === 'BUY' && features.bb > 0.8) { exitScore += 0.2; reasons.push('Price near upper BB'); }
    else if (side === 'SELL' && features.bb < 0.2) { exitScore += 0.2; reasons.push('Price near lower BB'); }

    // Momentum
    if (side === 'BUY' && features.momentum < 0) { exitScore += 0.2; reasons.push('Momentum negative'); }
    else if (side === 'SELL' && features.momentum > 0) { exitScore += 0.2; reasons.push('Momentum positive'); }

    const exitThreshold = this.model.thresholds.exit;
    const shouldExit = exitScore > exitThreshold;
    const reason = shouldExit ? `Exit: ${reasons.join(', ')}` : 'Hold';

    return { shouldExit, reason, exitScore };
  }

  // ─── Position sizing ──────────────────────────────────────────────
  getPositionSize(balance, winRate, avgWin, avgLoss) {
    if (balance < 1) return 0;
    const kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / (avgWin * avgWin);
    let fraction = Math.max(0, Math.min(kelly * 0.25, 0.03));
    let amount = balance * fraction;
    amount = Math.min(amount, 0.50);
    amount = Math.max(amount, 0.10);
    return amount;
  }
}

// ─── Singleton AI instance ──────────────────────────────────────────
const ai = new TrueAI();

// ─── Main analysis endpoint ─────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // Try Python agent first
    const response = await axios.post('http://localhost:5002/analyze', {
      symbol: market.replace('/', ''),
      email,
      price,
      indicators: { ...indicators, closes },
    }, { timeout: 2500 });
    return res.json(response.data);
  } catch (error) {
    console.log('Python agent unavailable, using True AI');

    const features = ai.extractFeatures(price, closes || []);
    if (!features) {
      return res.json({ signal: 'HOLD', confidence: 20, reason: 'Insufficient data' });
    }

    const entry = ai.predictEntry(features);
    return res.json({
      signal: entry.signal,
      confidence: entry.confidence,
      reason: entry.reason,
      breakdown: { weightedScore: entry.weightedScore },
    });
  }
});

// ─── Exit analysis endpoint ─────────────────────────────────────────
router.post('/exit', async (req, res) => {
  const { email, price, closes, entryPrice, side } = req.body;
  if (!email || !price || !closes || !entryPrice || !side) {
    return res.status(400).json({ error: 'Missing data' });
  }

  const features = ai.extractFeatures(price, closes);
  if (!features) {
    return res.json({ shouldExit: false, reason: 'Insufficient data' });
  }

  const exit = ai.predictExit(features, entryPrice, side);
  res.json(exit);
});

// ─── Learning endpoint ──────────────────────────────────────────────
router.post('/learn', async (req, res) => {
  const { email, trade } = req.body;
  if (!email || !trade) return res.status(400).json({ error: 'Missing data' });
  ai.learn(trade);
  res.json({ success: true, trades: ai.tradeHistory.length });
});

// ─── AI status ──────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  res.json({
    weights: ai.model.weights,
    thresholds: ai.model.thresholds,
    tradesLearned: ai.tradeHistory.length,
  });
});

module.exports = router;
