const router = require('express').Router();
const { getAnalysis } = require('./ai');
const technical = require('technicalindicators');

async function getCandles(symbol, interval, limit = 1000) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(c => parseFloat(c[4])); // only closes for simplicity
}

router.post('/run', async (req, res) => {
  const { symbol, startDate, endDate, initialBalance = 1000, riskPerTrade = 0.01, confidenceThreshold = 50 } = req.body;
  if (!symbol || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing symbol, startDate, or endDate' });
  }

  try {
    // Fetch all candles (simplified – we'll use 1h candles)
    const closes = await getCandles(symbol, '1h', 1000);
    if (closes.length < 50) {
      return res.status(400).json({ error: 'Not enough data' });
    }

    let balance = initialBalance;
    let position = 0;
    let entryPrice = 0;
    let trades = [];
    let totalTrades = 0;
    let wins = 0, losses = 0;
    let maxDrawdown = 0;
    let peak = balance;
    let equity = [balance];

    for (let i = 50; i < closes.length; i++) {
      const price = closes[i];
      // If position open, check SL/TP
      if (position !== 0) {
        const sl = entryPrice * 0.98;
        const tp = entryPrice * 1.06;
        if (position > 0 && (price <= sl || price >= tp)) {
          const pnl = (price - entryPrice) * position;
          balance += pnl;
          trades.push({ entry: entryPrice, exit: price, pnl, type: 'BUY' });
          totalTrades++;
          if (pnl > 0) wins++; else losses++;
          position = 0;
          if (balance > peak) peak = balance;
          const dd = peak - balance;
          if (dd > maxDrawdown) maxDrawdown = dd;
          equity.push(balance);
        } else if (position < 0 && (price >= sl || price <= tp)) {
          const pnl = (entryPrice - price) * Math.abs(position);
          balance += pnl;
          trades.push({ entry: entryPrice, exit: price, pnl, type: 'SELL' });
          totalTrades++;
          if (pnl > 0) wins++; else losses++;
          position = 0;
          if (balance > peak) peak = balance;
          const dd = peak - balance;
          if (dd > maxDrawdown) maxDrawdown = dd;
          equity.push(balance);
        }
        continue;
      }

      // Generate signal
      const ind = { rsi: 50, macd: 0, closes: closes.slice(0, i+1) };
      // We need a simple signal – use the enhanced fallback from ai.js
      // We'll import getAnalysis but it's async; we'll use a simplified version.
      // For backtest, we'll just use a simple rule: buy when RSI < 30, sell when RSI > 70.
      const rsi = technical.RSI.calculate({ values: closes.slice(0, i+1), period: 14 });
      const lastRsi = rsi[rsi.length-1] || 50;
      let signal = 'HOLD';
      let confidence = 50;
      if (lastRsi < 30) { signal = 'BUY'; confidence = 70; }
      else if (lastRsi > 70) { signal = 'SELL'; confidence = 70; }

      if (signal === 'HOLD' || confidence < confidenceThreshold) continue;

      const riskAmount = balance * riskPerTrade;
      const quantity = riskAmount / price;
      entryPrice = price;
      position = (signal === 'BUY') ? quantity : -quantity;
    }

    // Close any open position at end
    if (position !== 0) {
      const lastPrice = closes[closes.length-1];
      const pnl = (position > 0) ? (lastPrice - entryPrice) * position : (entryPrice - lastPrice) * Math.abs(position);
      balance += pnl;
      trades.push({ entry: entryPrice, exit: lastPrice, pnl, type: position > 0 ? 'BUY' : 'SELL' });
      totalTrades++;
      if (pnl > 0) wins++; else losses++;
    }
    equity.push(balance);

    const totalReturn = ((balance - initialBalance) / initialBalance) * 100;
    const winRate = totalTrades > 0 ? wins / totalTrades * 100 : 0;
    const avgWin = trades.filter(t => t.pnl > 0).reduce((s,t) => s + t.pnl, 0) / (wins || 1);
    const avgLoss = trades.filter(t => t.pnl < 0).reduce((s,t) => s + t.pnl, 0) / (losses || 1);
    const profitFactor = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
    const expect = (winRate/100 * avgWin) - ((1 - winRate/100) * Math.abs(avgLoss));
    // Sharpe ratio (simplified)
    const returns = trades.map(t => t.pnl / initialBalance);
    const avgRet = returns.reduce((a,b) => a+b, 0) / (returns.length || 1);
    const stdRet = Math.sqrt(returns.reduce((a,b) => a + (b - avgRet)**2, 0) / (returns.length || 1));
    const sharpe = stdRet !== 0 ? (avgRet / stdRet) * Math.sqrt(252) : 0;

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
      equityCurve: equity.slice(-100), // last 100 points for chart
      trades: trades.slice(-20),
      message: `Backtest completed on ${closes.length} candles`,
    });
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
