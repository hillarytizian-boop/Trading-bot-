const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');

// Simple backtest engine – replays historical data
router.post('/run', async (req, res) => {
  const { symbol, startDate, endDate, initialBalance = 1000, riskPerTrade = 0.01 } = req.body;
  if (!symbol || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=1000&startTime=${startMs}&endTime=${endMs}`;
    const res = await fetch(url);
    const data = await res.json();
    const closes = data.map(c => parseFloat(c[4]));
    const volumes = data.map(c => parseFloat(c[5]));

    let balance = initialBalance;
    let position = 0;
    let entryPrice = 0;
    let trades = [];
    let totalTrades = 0;
    let wins = 0, losses = 0;
    let maxDrawdown = 0;
    let peak = balance;
    let equity = [balance];

    for (let i = 20; i < closes.length; i++) {
      const price = closes[i];
      const volume = volumes[i];
      // Simple mock signal: buy if RSI < 30, sell if RSI > 70
      const rsi = (() => {
        const slice = closes.slice(i-14, i);
        let gains = 0, losses = 0;
        for (let j = 1; j < slice.length; j++) {
          const diff = slice[j] - slice[j-1];
          if (diff >= 0) gains += diff;
          else losses += -diff;
        }
        const avgGain = gains / (slice.length - 1);
        const avgLoss = losses / (slice.length - 1);
        if (avgLoss === 0) return 100;
        return 100 - (100 / (1 + avgGain / avgLoss));
      })();
      const avgVolume = volumes.slice(i-20, i).reduce((a,b) => a+b, 0) / 20;
      const volumeOk = volume > avgVolume * 0.7;

      if (position === 0) {
        let signal = 'HOLD';
        if (rsi < 30 && volumeOk) signal = 'BUY';
        else if (rsi > 70 && volumeOk) signal = 'SELL';
        if (signal !== 'HOLD') {
          const riskAmount = balance * riskPerTrade;
          const quantity = riskAmount / price;
          entryPrice = price;
          position = signal === 'BUY' ? quantity : -quantity;
          totalTrades++;
          trades.push({ entry: price, type: signal, quantity: Math.abs(quantity) });
        }
      } else {
        const sl = entryPrice * (position > 0 ? 0.98 : 1.02);
        const tp = entryPrice * (position > 0 ? 1.05 : 0.95);
        let exit = false;
        let pnl = 0;
        if (position > 0 && (price <= sl || price >= tp)) {
          pnl = (price - entryPrice) * position;
          exit = true;
        } else if (position < 0 && (price >= sl || price <= tp)) {
          pnl = (entryPrice - price) * Math.abs(position);
          exit = true;
        }
        if (exit) {
          balance += pnl;
          trades[trades.length-1].exit = price;
          trades[trades.length-1].pnl = pnl;
          if (pnl > 0) wins++; else losses++;
          position = 0;
          if (balance > peak) peak = balance;
          const dd = peak - balance;
          if (dd > maxDrawdown) maxDrawdown = dd;
          equity.push(balance);
        }
      }
    }

    const totalReturn = ((balance - initialBalance) / initialBalance) * 100;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const avgWin = trades.filter(t => t.pnl > 0).reduce((s,t) => s + t.pnl, 0) / (wins || 1);
    const avgLoss = trades.filter(t => t.pnl < 0).reduce((s,t) => s + t.pnl, 0) / (losses || 1);
    const profitFactor = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;

    res.json({
      totalReturn,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      maxDrawdown: (maxDrawdown / initialBalance) * 100,
      finalBalance: balance,
      trades: trades.slice(-20),
      equityCurve: equity.slice(-100),
      message: `Backtest on ${closes.length} candles`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
