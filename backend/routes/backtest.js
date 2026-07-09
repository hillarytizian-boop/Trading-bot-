const router = require('express').Router();
const Binance = require('binance-api-node').default;
const { analyze } = require('./ai');

// ─── Helper: fetch all historical klines ──────────────────────────
async function fetchAllKlines(symbol, startMs, endMs, interval = '1h') {
  const client = Binance();
  const limit = 1000;
  const allKlines = [];
  let from = startMs;

  while (from < endMs) {
    const klines = await client.klines({
      symbol: symbol || 'BTCUSDT',
      interval: interval,
      startTime: from,
      endTime: Math.min(from + limit * 3600000, endMs),
      limit: limit,
    });
    if (!klines || klines.length === 0) break;
    allKlines.push(...klines);
    from = klines[klines.length - 1].openTime + 1;
  }
  return allKlines;
}

// ─── Main backtest endpoint ──────────────────────────────────────
router.post('/run', async (req, res) => {
  const { symbol, startDate, endDate, initialBalance, riskPerTrade } = req.body;

  if (!symbol || !startDate || !endDate || !initialBalance) {
    return res.status(400).json({ error: 'Missing required params: symbol, startDate, endDate, initialBalance' });
  }

  try {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    // 1. Fetch historical data from Binance
    const klines = await fetchAllKlines(symbol, startMs, endMs);

    if (klines.length < 10) {
      return res.status(400).json({ error: 'Not enough historical data for the selected range' });
    }

    // 2. Simulate trading
    let balance = parseFloat(initialBalance);
    let position = 0; // 0 = no position, >0 = long, <0 = short
    let entryPrice = 0;
    let totalTrades = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let maxDrawdown = 0;
    let peakBalance = balance;
    let returns = [];

    const risk = parseFloat(riskPerTrade) / 100 || 0.02; // default 2%

    for (let i = 50; i < klines.length; i++) {
      const candle = klines[i];
      const price = parseFloat(candle.close);
      const prevCandle = klines[i - 1];
      const prevPrice = parseFloat(prevCandle.close);

      // Simulate indicators (simplified for backtest)
      const indicators = {
        rsi: 50 + Math.random() * 20 - 10, // simplified
        ema: prevPrice * 0.99,
        macd: (price - prevPrice) / prevPrice,
      };

      // Get AI signal
      const signal = await analyze({ market: symbol, price, indicators });

      // Execute trade logic
      if (position === 0) {
        // No position – enter if signal is strong
        if (signal.signal === 'BUY' && signal.confidence > 70) {
          const amount = balance * risk;
          const quantity = amount / price;
          entryPrice = price;
          position = quantity;
          totalTrades++;
          returns.push({ type: 'BUY', entryPrice, quantity });
        } else if (signal.signal === 'SELL' && signal.confidence > 70) {
          const amount = balance * risk;
          const quantity = amount / price;
          entryPrice = price;
          position = -quantity;
          totalTrades++;
          returns.push({ type: 'SELL', entryPrice, quantity: -quantity });
        }
      } else {
        // We have a position – check if we should exit
        const pnl = position * (price - entryPrice);
        const pnlPct = (pnl / (Math.abs(position) * entryPrice)) * 100;

        // Exit conditions: take profit (5%) or stop loss (2%)
        if (pnlPct >= 5) {
          // Take profit
          balance += pnl;
          if (pnl > 0) winningTrades++;
          else losingTrades++;
          if (balance > peakBalance) peakBalance = balance;
          const dd = peakBalance - balance;
          if (dd > maxDrawdown) maxDrawdown = dd;
          position = 0;
          entryPrice = 0;
        } else if (pnlPct <= -2) {
          // Stop loss
          balance += pnl;
          if (pnl > 0) winningTrades++;
          else losingTrades++;
          if (balance > peakBalance) peakBalance = balance;
          const dd = peakBalance - balance;
          if (dd > maxDrawdown) maxDrawdown = dd;
          position = 0;
          entryPrice = 0;
        } else if (i === klines.length - 1) {
          // End of data – close position
          balance += pnl;
          if (pnl > 0) winningTrades++;
          else losingTrades++;
          if (balance > peakBalance) peakBalance = balance;
          const dd = peakBalance - balance;
          if (dd > maxDrawdown) maxDrawdown = dd;
          position = 0;
          entryPrice = 0;
        }
      }
    }

    const totalReturn = ((balance - initialBalance) / initialBalance) * 100;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    res.json({
      totalReturn,
      winRate,
      maxDrawdown: (maxDrawdown / initialBalance) * 100,
      finalBalance: balance,
      totalTrades,
      winningTrades,
      losingTrades,
      message: `Backtest complete on ${klines.length} candles`,
    });
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ error: error.message || 'Failed to run backtest' });
  }
});

module.exports = router;
