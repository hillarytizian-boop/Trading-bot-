import { useState, useEffect, useRef } from 'react';

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

// Simple canvas chart
function MiniChart({ data, color, label }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !data || data.length < 2) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    ctx.beginPath();
    ctx.strokeStyle = color || TG_BLUE;
    ctx.lineWidth = 2;
    data.forEach((v, i) => {
      const x = (i / (data.length-1)) * w;
      const y = h - ((v - min) / range) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data, color]);
  return <canvas ref={canvasRef} width={200} height={60} style={{ width: '100%', height: 60, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }} />;
}

export default function Dashboard({ binance, email }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState(null);
  const [balance, setBalance] = useState(binance?.balance || '0.00');
  const [trades, setTrades] = useState([]);
  const [equityCurve, setEquityCurve] = useState([]);

  useEffect(() => {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    ws.onmessage = (e) => {
      try { const d = JSON.parse(e.data); if (d.p) setPrice(parseFloat(d.p)); } catch {}
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch all trades
        const res = await fetch(`/api/trades?email=${encodeURIComponent(email)}`);
        const allTrades = await res.json();
        if (allTrades && allTrades.length > 0) {
          const closed = allTrades.filter(t => t.status === 'closed' && t.pnl !== undefined);
          setTrades(closed);
          // Build equity curve
          let cum = 0;
          const curve = closed.map(t => { cum += t.pnl; return cum; });
          setEquityCurve(curve);
          // Stats
          const total = closed.length;
          const wins = closed.filter(t => t.pnl > 0).length;
          const losses = closed.filter(t => t.pnl < 0).length;
          const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
          const winRate = total > 0 ? (wins / total) * 100 : 0;
          const avgWin = wins > 0 ? closed.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0)/wins : 0;
          const avgLoss = losses > 0 ? closed.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0)/losses : 0;
          const profitFactor = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
          let maxDrawdown = 0, peak = 0, running = 0;
          closed.forEach(t => { running += t.pnl; if (running > peak) peak = running; const dd = peak - running; if (dd > maxDrawdown) maxDrawdown = dd; });
          setStats({ totalTrades: total, wins, losses, totalPnl, winRate, avgWin, avgLoss, profitFactor, maxDrawdown });
        }
        // Balance
        if (binance?.connected) {
          const balRes = await fetch(`/api/binance/balance?email=${encodeURIComponent(email)}`);
          const balData = await balRes.json();
          if (balData.balance) setBalance(balData.balance);
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [email, binance?.connected]);

  if (loading) return <div style={{ flex:1, display:'flex', justifyContent:'center', alignItems:'center', color:MUTED }}>Loading...</div>;
  if (!stats) return <div style={{ padding:16, color:MUTED }}>No trade data yet.</div>;

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
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
        <MetricCard label="Profit Factor" value={stats.profitFactor.toFixed(2)} color={stats.profitFactor >= 1.5 ? GREEN : GOLD} />
        <MetricCard label="Max Drawdown" value={`$${stats.maxDrawdown.toFixed(2)}`} color={RED} />
      </div>
      <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <p style={{ fontSize:13, fontWeight:600, marginBottom:8, color:TEXT }}>Equity Curve</p>
        <MiniChart data={equityCurve} color={GREEN} />
      </div>
      <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 16 }}>
        <p style={{ fontSize:13, fontWeight:600, marginBottom:8, color:TEXT }}>Recent Trades</p>
        {trades.slice(-5).reverse().map((t, i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom: i < 4 ? `1px solid ${DARK_BORDER}` : 'none' }}>
            <span>{t.symbol} {t.type}</span>
            <span style={{ color: t.pnl >= 0 ? GREEN : RED }}>{t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}</span>
            <span style={{ fontSize:11, color:MUTED }}>{new Date(t.opened_at).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
      {!binance?.connected && <div style={{ marginTop:16, padding:12, background:'rgba(240,180,41,0.1)', border:`1px solid ${GOLD}33`, borderRadius:12, textAlign:'center', color:GOLD }}>⚠️ Connect Binance for live data</div>}
    </div>
  );
}
