const router = require('express').Router();
const { getAnalysis } = require('./ai');
const technical = require('technicalindicators');

// ─── CONFIG ──────────────────────────────────────────────────────────────
const CONFIG = {
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  baseConfidenceThreshold: 70,
  riskPerTrade: 0.01,
  atrMultiplierSL: 2,
  rewardToRisk: 3,
  qualityThreshold: 85,
  minTradeAmount: 0.10,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────

async function getCandles(symbol, interval, limit = 1000) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(c => ({
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    time: new Date(c[0]),
  }));
}

function computeIndicators(closes) {
  if (closes.length < 30) return null;
  const rsi = technical.RSI.calculate({ values: closes, period: CONFIG.rsiPeriod });
  const ema50 = technical.EMA.calculate({ values: closes, period: 50 });
  const ema100 = technical.EMA.calculate({ values: closes, period: 100 });
  const ema200 = technical.EMA.calculate({ values: closes, period: 200 });
  const macd = technical.MACD.calculate({
    values: closes,
    fastPeriod: CONFIG.macdFast,
    slowPeriod: CONFIG.macdSlow,
    signalPeriod: CONFIG.macdSignal,
  });
  const bb = technical.BollingerBands.calculate({
    values: closes,
    period: CONFIG.bollingerPeriod,
    stdDev: CONFIG.bollingerStdDev,
  });
  return {
    rsi: rsi[rsi.length-1],
    ema50: ema50[ema50.length-1],
    ema100: ema100[ema100.length-1],
    ema200: ema200[ema200.length-1],
    macd: macd[macd.length-1],
    bb: bb[bb.length-1],
    atr: 0.02 * closes[closes.length-1],
  };
}

function detectRegime(closes) {
  if (closes.length < 20) return 'unknown';
  const recent = closes.slice(-20);
  const diffs = [];
  for (let i = 1; i < recent.length; i++) {
    diffs.push(recent[i] - recent[i-1]);
  }
  const avgMove = diffs.reduce((a,b) => a + Math.abs(b), 0) / diffs.length;
  const netMove = recent[recent.length-1] - recent[0];
  const strength = Math.abs(netMove) / avgMove;
  if (strength > 2.5) return 'trending';
  if (strength > 1.5) return 'weak_trend';
  return 'ranging';
}

// ─── BACKTEST SIMULATION ──────────────────────────────────────────────────

router.post('/run', async (req, res) => {
  const { symbol, startDate, endDate, initialBalance = 1000, riskPerTrade = 0.01, confidenceThreshold = 70 } = req.body;
  if (!symbol || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing symbol, startDate, or endDate' });
  }

  try {
    // Fetch all candles for the period
    const candles = await getCandles(symbol, '1h', 1000);
    // Filter by date (simplified – we'll just take the whole range)
    // In production, you'd paginate.
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    if (closes.length < 50) {
      return res.status(400).json({ error: 'Not enough data for the selected range' });
    }

    // Simulate trading
    let balance = initialBalance;
    let position = 0; // quantity
    let entryPrice = 0;
    let trades = [];
    let totalTrades = 0;
    let wins = 0, losses = 0;
    let maxDrawdown = 0;
    let peak = balance;
    let dailyPnL = 0;

    // We'll use a simple loop over candles
    for (let i = 50; i < closes.length; i++) {
      const price = closes[i];
      const prevClose = closes[i-1];

      // Check if we have an open position
      if (position !== 0) {
        // Check stop-loss or take-profit
        const sl = entryPrice - (entryPrice * 0.02); // simplified
        const tp = entryPrice + (entryPrice * 0.06);
        if (position > 0) {
          if (price <= sl || price >= tp) {
            // Close trade
            const pnl = (price - entryPrice) * position;
            balance += pnl;
            if (pnl > 0) wins++; else losses++;
            trades.push({ entry: entryPrice, exit: price, pnl, type: 'BUY' });
            totalTrades++;
            position = 0;
            if (balance > peak) peak = balance;
            const dd = peak - balance;
            if (dd > maxDrawdown) maxDrawdown = dd;
          }
        } else {
          if (price >= -sl || price <= -tp) {
            const pnl = (entryPrice - price) * Math.abs(position);
            balance += pnl;
            if (pnl > 0) wins++; else losses++;
            trades.push({ entry: entryPrice, exit: price, pnl, type: 'SELL' });
            totalTrades++;
            position = 0;
            if (balance > peak) peak = balance;
            const dd = peak - balance;
            if (dd > maxDrawdown) maxDrawdown = dd;
          }
        }
        continue;
      }

      // No position – get signal
      const ind = computeIndicators(closes.slice(0, i+1));
      if (!ind) continue;

      const regime = detectRegime(closes.slice(0, i+1));
      const priceAboveEMA = price > ind.ema50 && ind.ema50 > ind.ema100 && ind.ema100 > ind.ema200;
      const priceBelowEMA = price < ind.ema50 && ind.ema50 < ind.ema100 && ind.ema100 < ind.ema200;

      let preliminarySignal = 'HOLD';
      if (priceAboveEMA && ind.rsi < 50) preliminarySignal = 'BUY';
      else if (priceBelowEMA && ind.rsi > 50) preliminarySignal = 'SELL';

      // AI confirmation (simplified – we'll use a mock AI response)
      let aiSignal = { signal: 'HOLD', confidence: 0 };
      if (preliminarySignal !== 'HOLD') {
        // Simulate AI call with a simple logic
        const aiConf = 70 + Math.random() * 20; // random confidence for demo
        aiSignal = { signal: preliminarySignal, confidence: aiConf };
      }

      const finalDecision = (preliminarySignal !== 'HOLD' && aiSignal.signal === preliminarySignal && aiSignal.confidence >= confidenceThreshold)
        ? preliminarySignal
        : 'HOLD';

      if (finalDecision === 'HOLD') continue;

      // Trade quality score (simplified)
      let tradeScore = 0;
      if (priceAboveEMA && finalDecision === 'BUY') tradeScore += 20;
      else if (priceBelowEMA && finalDecision === 'SELL') tradeScore += 20;
      if (ind.rsi < 30 && finalDecision === 'BUY') tradeScore += 15;
      else if (ind.rsi > 70 && finalDecision === 'SELL') tradeScore += 15;
      if (ind.macd && ind.macd.MACD > ind.macd.signal && finalDecision === 'BUY') tradeScore += 10;
      else if (ind.macd && ind.macd.MACD < ind.macd.signal && finalDecision === 'SELL') tradeScore += 10;
      if (ind.bb && finalDecision === 'BUY' && price < ind.bb.lower) tradeScore += 10;
      else if (ind.bb && finalDecision === 'SELL' && price > ind.bb.upper) tradeScore += 10;
      tradeScore = Math.min(tradeScore, 100);

      if (tradeScore < CONFIG.qualityThreshold) continue;

      // Position sizing
      const riskAmount = balance * riskPerTrade;
      const quantity = riskAmount / price;
      entryPrice = price;
      position = (finalDecision === 'BUY') ? quantity : -quantity;
    }

    // Calculate metrics
    const totalReturn = (balance - initialBalance) / initialBalance * 100;
    const winRate = totalTrades > 0 ? wins / totalTrades * 100 : 0;
    const avgWin = trades.filter(t => t.pnl > 0).reduce((s,t) => s + t.pnl, 0) / (wins || 1);
    const avgLoss = trades.filter(t => t.pnl < 0).reduce((s,t) => s + t.pnl, 0) / (losses || 1);
    const profitFactor = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
    const sharpe = 0; // placeholder
    const expect = (winRate/100 * avgWin) - ((1 - winRate/100) * Math.abs(avgLoss));

    res.json({
      totalReturn,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      sharpe,
      expect,
      totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      maxDrawdown: (maxDrawdown / initialBalance) * 100,
      finalBalance: balance,
      trades: trades.slice(-20), // last 20 trades for display
      message: `Backtest completed on ${closes.length} candles`,
    });
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── PARAMETER OPTIMIZER ────────────────────────────────────────────────────

router.post('/optimize', async (req, res) => {
  const { symbol, startDate, endDate, initialBalance = 1000 } = req.body;
  if (!symbol || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Grid search over parameters
    const riskValues = [0.005, 0.01, 0.015, 0.02];
    const thresholdValues = [60, 70, 80];
    const atrMultipliers = [1.5, 2, 2.5];

    let bestScore = -Infinity;
    let bestParams = {};
    const results = [];

    // For each combination, run a backtest (simplified)
    for (const risk of riskValues) {
      for (const threshold of thresholdValues) {
        for (const atrMult of atrMultipliers) {
          // Simulate a backtest with these params
          // We'll use a dummy score for demonstration
          const score = Math.random() * 100; // placeholder
          results.push({ risk, threshold, atrMult, score });
          if (score > bestScore) {
            bestScore = score;
            bestParams = { risk, threshold, atrMult };
          }
        }
      }
    }

    res.json({
      bestParams,
      results: results.slice(0, 10), // top 10
      message: 'Optimization complete (simulated)',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
