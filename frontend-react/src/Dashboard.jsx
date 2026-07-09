import { useState, useEffect } from 'react';
const DARK_BG = "#0E1621";
const DARK_PANEL = "#17212B";
const DARK_BORDER = "rgba(255,255,255,0.07)";
const TEXT = "#E7ECF0";
const MUTED = "#6C7883";
const GREEN = "#4FCE5D";
const RED = "#FF5E5E";
const GOLD = "#F0B429";
const TG_BLUE = "#2AABEE";
function MetricCard({ label, value, color, sub }) {
  return (
    <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 16, border: `1px solid ${DARK_BORDER}` }}>
      <p style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: color || TEXT, fontFamily: 'monospace' }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{sub}</p>}
    </div>
  );
}
function ProgressBar({ value, max, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color || TG_BLUE, borderRadius: 3, transition: 'width 0.3s' }} />
    </div>
  );
}
export default function Dashboard({ binance, email }) {
  const [stats, setStats] = useState({
    totalTrades: 0, winningTrades: 0, losingTrades: 0, totalPnl: 0,
    maxDrawdown: 0, winRate: 0, averageWin: 0, averageLoss: 0,
    profitFactor: 0, sharpeRatio: 0,
  });
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState(null);
  const [balance, setBalance] = useState(binance?.balance || '0.00');
  useEffect(() => {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.p) setPrice(parseFloat(data.p));
      } catch (err) { /* ignore */ }
    };
    return () => ws.close();
  }, []);
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/trades?email=${encodeURIComponent(email)}`);
        const trades = await res.json();
        if (trades && trades.length > 0) {
          const closed = trades.filter(t => t.status === 'closed' && t.pnl !== undefined);
          const total = closed.length;
          const wins = closed.filter(t => t.pnl > 0).length;
          const losses = closed.filter(t => t.pnl < 0).length;
          const totalPnl = closed.reduce((sum, t) => sum + t.pnl, 0);
          const winRate = total > 0 ? (wins / total) * 100 : 0;
          const winPnl = closed.filter(t => t.pnl > 0).map(t => t.pnl);
          const lossPnl = closed.filter(t => t.pnl < 0).map(t => Math.abs(t.pnl));
          const avgWin = winPnl.length > 0 ? winPnl.reduce((a, b) => a + b, 0) / winPnl.length : 0;
          const avgLoss = lossPnl.length > 0 ? lossPnl.reduce((a, b) => a + b, 0) / lossPnl.length : 0;
          let maxDrawdown = 0, peak = 0, runningTotal = 0;
          closed.forEach(t => { runningTotal += t.pnl; if (runningTotal > peak) peak = runningTotal; const dd = peak - runningTotal; if (dd > maxDrawdown) maxDrawdown = dd; });
          const grossProfit = winPnl.reduce((a, b) => a + b, 0);
          const grossLoss = lossPnl.reduce((a, b) => a + b, 0);
          const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
          const returns = closed.map(t => t.pnl / 100);
          const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
          const variance = returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / (returns.length || 1);
          const stdDev = Math.sqrt(variance);
          const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
          setStats({ totalTrades: total, winningTrades: wins, losingTrades: losses, totalPnl, maxDrawdown, winRate, averageWin: avgWin, averageLoss: avgLoss, profitFactor, sharpeRatio });
        }
        if (binance?.connected) {
          const balRes = await fetch(`/api/binance/balance?email=${encodeURIComponent(email)}`);
          const balData = await balRes.json();
          if (balData.balance) setBalance(balData.balance);
        }
        setLoading(false);
      } catch (err) { console.error('Dashboard error:', err); setLoading(false); }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [email, binance?.connected]);
  if (loading) return <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', background: DARK_BG, color: MUTED }}>Loading dashboard...</div>;
  const winRateColor = stats.winRate >= 60 ? GREEN : stats.winRate >= 40 ? GOLD : RED;
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: DARK_BG, padding: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: TEXT }}>Performance Dashboard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <MetricCard label="Balance" value={`$${parseFloat(balance).toFixed(2)}`} color={GREEN} />
        <MetricCard label="BTC/USDT" value={`$${price ? price.toFixed(2) : '...'}`} color={TG_BLUE} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
        <MetricCard label="Total Trades" value={stats.totalTrades} />
        <MetricCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} color={winRateColor} />
        <MetricCard label="Total P&L" value={`$${stats.totalPnl.toFixed(2)}`} color={stats.totalPnl >= 0 ? GREEN : RED} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
        <MetricCard label="Profit Factor" value={stats.profitFactor.toFixed(2)} color={stats.profitFactor >= 1.5 ? GREEN : GOLD} />
        <MetricCard label="Sharpe Ratio" value={stats.sharpeRatio.toFixed(2)} color={stats.sharpeRatio >= 1 ? GREEN : GOLD} />
        <MetricCard label="Max Drawdown" value={`$${stats.maxDrawdown.toFixed(2)}`} color={RED} />
      </div>
      <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 16, border: `1px solid ${DARK_BORDER}`, marginBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: TEXT }}>Trade Breakdown</p>
        <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
          <div><span style={{ color: GREEN }}>Wins:</span> <span style={{ fontWeight: 700 }}>{stats.winningTrades}</span></div>
          <div><span style={{ color: RED }}>Losses:</span> <span style={{ fontWeight: 700 }}>{stats.losingTrades}</span></div>
          <div><span style={{ color: MUTED }}>Avg Win:</span> <span style={{ fontWeight: 700, color: GREEN }}>${stats.averageWin.toFixed(2)}</span></div>
          <div><span style={{ color: MUTED }}>Avg Loss:</span> <span style={{ fontWeight: 700, color: RED }}>${stats.averageLoss.toFixed(2)}</span></div>
        </div>
        <ProgressBar value={stats.winningTrades} max={stats.totalTrades || 1} color={winRateColor} />
      </div>
      {!binance?.connected && <div style={{ background: 'rgba(240,180,41,0.1)', border: `1px solid ${GOLD}33`, borderRadius: 12, padding: 12, textAlign: 'center' }}><span style={{ color: GOLD, fontSize: 13 }}>⚠️ Connect your Binance account to see live data</span></div>}
    </div>
  );
}
