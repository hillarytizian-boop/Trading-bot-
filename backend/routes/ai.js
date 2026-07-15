const router = require('express').Router();
const axios = require('axios');
const technical = require('technicalindicators');

// ─── TRUE AI: learns from every trade, adapts, makes all decisions ──
class TrueAI {
  constructor() {
    // ─── Machine Learning state ──────────────────────────────────
    this.model = {
      // Weights for each indicator (learned over time)
      weights: {
        rsi: 0.15,
        macd: 0.20,
        bb: 0.15,
        ema: 0.10,
        volume: 0.10,
        momentum: 0.15,
        volatility: 0.15,
      },
      // Adaptive thresholds
      thresholds: {
        buy: 0.60,
        sell: 0.60,
        hold: 0.40,
      },
      // Performance tracking per indicator
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

    // Adjust weights based on win/loss
    if (trade.pnl > 0) {
      // Winning trade – reinforce indicators that were strong
      for (const [indicator, value] of Object.entries(trade.indicators)) {
        if (this.model.indicatorPerformance[indicator]) {
          this.model.indicatorPerformance[indicator].wins += 1;
          // Increase weight slightly for winning indicators
          this.model.weights[indicator] = Math.min(
            this.model.weights[indicator] + this.learningRate,
            0.30
          );
        }
      }
    } else {
      // Losing trade – penalize indicators that were strong
      for (const [indicator, value] of Object.entries(trade.indicators)) {
        if (this.model.indicatorPerformance[indicator]) {
          this.model.indicatorPerformance[indicator].losses += 1;
          // Decrease weight for losing indicators
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
    this.model.thresholds.buy = Math.max(0.40, Math.min(0.70, this.model.thresholds.buy));
    this.model.thresholds.sell = Math.max(0.40, Math.min(0.70, this.model.thresholds.sell));
  }

  // ─── Extract features from market data ──────────────────────────
  extractFeatures(price, closes) {
    if (!closes || closes.length < 30) return null;

    // Technical indicators
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

    // Volume (approximate from price changes)
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

  // ─── Predict using the model ─────────────────────────────────────
  predict(features) {
    if (!features) return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data' };

    // Calculate scores for each indicator
    const scores = {
      rsi: features.rsi < 30 ? 0.8 : features.rsi > 70 ? 0.2 : 0.5,
      macd: features.macd > 0 ? 0.7 : features.macd < 0 ? 0.3 : 0.5,
      bb: features.bb < 0.2 ? 0.8 : features.bb > 0.8 ? 0.2 : 0.5,
      ema: features.ema > 0 ? 0.6 : features.ema < 0 ? 0.4 : 0.5,
      volume: features.volume > 0.002 ? 0.7 : features.volume < 0.001 ? 0.3 : 0.5,
      momentum: features.momentum > 0.005 ? 0.8 : features.momentum < -0.005 ? 0.2 : 0.5,
      volatility: features.volatility > 0.02 ? 0.4 : features.volatility < 0.01 ? 0.6 : 0.5,
    };

    // Weighted score
    let weightedScore = 0;
    let totalWeight = 0;
    const reasons = [];
    for (const [indicator, score] of Object.entries(scores)) {
      const weight = this.model.weights[indicator] || 0.1;
      weightedScore += score * weight;
      totalWeight += weight;
      reasons.push(`${indicator}: ${(score * 100).toFixed(0)}%`);
    }
    weightedScore = totalWeight > 0 ? weightedScore / totalWeight : 0.5;

    // Determine signal with adaptive thresholds
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

    // Add detailed breakdown
    const breakdown = {
      weightedScore,
      scores,
      weights: this.model.weights,
      thresholds: this.model.thresholds,
    };

    return {
      signal,
      confidence,
      reason: `${reason} | ${reasons.join(', ')}`,
      breakdown,
      features,
    };
  }

  // ─── Determine position size using Kelly ────────────────────────
  getPositionSize(balance, winRate, avgWin, avgLoss) {
    if (balance < 1) return 0;
    // Kelly Criterion
    const kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / (avgWin * avgWin);
    let fraction = Math.max(0, Math.min(kelly * 0.25, 0.03));
    // Cap at $0.50
    let amount = balance * fraction;
    amount = Math.min(amount, 0.50);
    amount = Math.max(amount, 0.10);
    return amount;
  }
}

// ─── Singleton AI instance ──────────────────────────────────────────
const ai = new TrueAI();

// ─── Endpoint ──────────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // Try Python agent first (if available)
    const response = await axios.post('http://localhost:5002/analyze', {
      symbol: market.replace('/', ''),
      email,
      price,
      indicators,
    }, { timeout: 2500 });
    // Learn from the response if it's a trade
    if (response.data.signal && response.data.signal !== 'HOLD') {
      // We'll learn after the trade is closed
    }
    return res.json(response.data);
  } catch (error) {
    console.log('Python agent unavailable, using True AI');

    // Get closes from indicators or fetch
    let closes = indicators?.closes || [];
    if (closes.length < 30) {
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${market.replace('/', '')}&interval=1m&limit=50`;
        const response = await fetch(url);
        const data = await response.json();
        closes = data.map(c => parseFloat(c[4]));
      } catch (e) {
        console.error('Failed to fetch candles:', e);
      }
    }

    // ─── True AI analysis ──────────────────────────────────────────
    const features = ai.extractFeatures(price, closes);
    if (!features) {
      return res.json({ signal: 'HOLD', confidence: 20, reason: 'Insufficient data' });
    }

    const result = ai.predict(features);
    const response = {
      signal: result.signal,
      confidence: result.confidence,
      reason: result.reason,
      breakdown: result.breakdown,
      // Learning state
      learning: {
        weights: ai.model.weights,
        thresholds: ai.model.thresholds,
        tradesLearned: ai.tradeHistory.length,
      },
    };

    return res.json(response);
  }
});

// ─── Learning endpoint (call after a trade closes) ──────────────
router.post('/learn', async (req, res) => {
  const { email, trade } = req.body;
  if (!email || !trade) return res.status(400).json({ error: 'Missing data' });

  // Validate trade
  if (trade.pnl !== undefined && trade.indicators) {
    ai.learn(trade);
    return res.json({ success: true, message: 'AI learned from trade', trades: ai.tradeHistory.length });
  }
  res.status(400).json({ error: 'Invalid trade data' });
});

// ─── Get AI status ──────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  res.json({
    weights: ai.model.weights,
    thresholds: ai.model.thresholds,
    tradesLearned: ai.tradeHistory.length,
    indicatorPerformance: ai.model.indicatorPerformance,
  });
});

module.exports = router;
