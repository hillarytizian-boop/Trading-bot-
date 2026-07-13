import { useState, useEffect } from 'react';
const DARK_BG = "#0E1621", DARK_PANEL = "#17212B", DARK_BORDER = "rgba(255,255,255,0.07)";
const TEXT = "#E7ECF0", MUTED = "#6C7883", GREEN = "#4FCE5D", RED = "#FF5E5E", GOLD = "#F0B429", TG_BLUE = "#2AABEE";

function MetricCard({ label, value, color }) {
  return (
    <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 16, border: `1px solid ${DARK_BORDER}` }}>
      <p style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: color || TEXT, fontFamily: 'monospace' }}>{value}</p>
    </div>
  );
}

export default function Dashboard({ binance, email }) {
  const [stats, setStats] = useState({ totalTrades: 0, winningTrades: 0, losingTrades: 0, totalPnl: 0, winRate: 0, maxDrawdown: 0 });
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState(null);
  const [balance, setBalance] = useState(binance?.balance || '0.00');

  useEffect(() => {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    ws.onmessage = (e) => {
      try { const d = JSON.parse(e.data); if (d.p) setPrice(parseFloat(d.p)); } catch {}
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
          const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
          const winRate = total > 0 ? (wins / total) * 100 : 0;
          let maxDrawdown = 0, peak = 0, running = 0;
          closed.forEach(t => { running += t.pnl; if (running > peak) peak = running; const dd = peak - running; if (dd > maxDrawdown) maxDrawdown = dd; });
          setStats({ totalTrades: total, winningTrades: wins, losingTrades: losses, totalPnl, winRate, maxDrawdown });
        }
        if (binance?.connected) {
          const balRes = await fetch(`/api/binance/balance?email=${encodeURIComponent(email)}`);
          const balData = await balRes.json();
          if (balData.balance) setBalance(balData.balance);
        }
        setLoading(false);
      } catch { setLoading(false); }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [email, binance?.connected]);

  if (loading) return <div style={{ flex:1, display:'flex', justifyContent:'center', alignItems:'center', color:MUTED }}>Loading...</div>;
  const winRateColor = stats.winRate >= 60 ? GREEN : stats.winRate >= 40 ? GOLD : RED;
  return (
    <div style={{ flex:1, overflowY:'auto', background: DARK_BG, padding: 16 }}>
      <h2 style={{ fontSize:20, fontWeight:700, marginBottom:16, color:TEXT }}>Performance Dashboard</h2>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
        <MetricCard label="Balance" value={`$${parseFloat(balance).toFixed(2)}`} color={GREEN} />
        <MetricCard label="BTC/USDT" value={`$${price ? price.toFixed(2) : '...'}`} color={TG_BLUE} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16 }}>
        <MetricCard label="Total Trades" value={stats.totalTrades} />
        <MetricCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} color={winRateColor} />
        <MetricCard label="Total P&L" value={`$${stats.totalPnl.toFixed(2)}`} color={stats.totalPnl >= 0 ? GREEN : RED} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <MetricCard label="Max Drawdown" value={`$${stats.maxDrawdown.toFixed(2)}`} color={RED} />
        <MetricCard label="Win/Loss" value={`${stats.winningTrades}/${stats.losingTrades}`} color={TEXT} />
      </div>
      {!binance?.connected && <div style={{ marginTop:16, padding:12, background:'rgba(240,180,41,0.1)', border:`1px solid ${GOLD}33`, borderRadius:12, textAlign:'center', color:GOLD }}>⚠️ Connect Binance for live data</div>}
    </div>
  );
}
