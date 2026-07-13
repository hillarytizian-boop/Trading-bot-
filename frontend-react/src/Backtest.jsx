import { useState } from 'react';
const DARK_BG = "#0E1621", DARK_PANEL = "#17212B", DARK_BORDER = "rgba(255,255,255,0.07)";
const TEXT = "#E7ECF0", MUTED = "#6C7883", GREEN = "#4FCE5D", RED = "#FF5E5E", GOLD = "#F0B429", TG_BLUE = "#2AABEE";

function MetricCard({ label, value, color }) {
  return (
    <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 16, border: `1px solid ${DARK_BORDER}` }}>
      <p style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: color || TEXT, fontFamily: 'monospace' }}>{value}</p>
    </div>
  );
}

export default function Backtest() {
  const [params, setParams] = useState({ symbol: 'BTCUSDT', startDate: '2026-06-01', endDate: '2026-07-01', initialBalance: 1000, riskPerTrade: 2 });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runBacktest = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/backtest/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backtest failed');
      setResults(data);
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  return (
    <div style={{ flex:1, overflowY:'auto', background: DARK_BG, padding: 16 }}>
      <h2 style={{ fontSize:20, fontWeight:700, marginBottom:16, color:TEXT }}>Backtest Strategy</h2>
      <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 16, border: `1px solid ${DARK_BORDER}`, marginBottom: 16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
          <div><label style={{ fontSize:12, color:MUTED, display:'block', marginBottom:4 }}>Symbol</label><input type="text" value={params.symbol} onChange={e=>setParams({...params, symbol:e.target.value})} style={{ width:'100%', padding:8, background:'#0E1621', border:`1px solid ${DARK_BORDER}`, borderRadius:8, color:TEXT }} /></div>
          <div><label style={{ fontSize:12, color:MUTED, display:'block', marginBottom:4 }}>Risk per Trade (%)</label><input type="number" value={params.riskPerTrade} onChange={e=>setParams({...params, riskPerTrade:parseFloat(e.target.value)})} style={{ width:'100%', padding:8, background:'#0E1621', border:`1px solid ${DARK_BORDER}`, borderRadius:8, color:TEXT }} /></div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
          <div><label style={{ fontSize:12, color:MUTED, display:'block', marginBottom:4 }}>Start Date</label><input type="date" value={params.startDate} onChange={e=>setParams({...params, startDate:e.target.value})} style={{ width:'100%', padding:8, background:'#0E1621', border:`1px solid ${DARK_BORDER}`, borderRadius:8, color:TEXT }} /></div>
          <div><label style={{ fontSize:12, color:MUTED, display:'block', marginBottom:4 }}>End Date</label><input type="date" value={params.endDate} onChange={e=>setParams({...params, endDate:e.target.value})} style={{ width:'100%', padding:8, background:'#0E1621', border:`1px solid ${DARK_BORDER}`, borderRadius:8, color:TEXT }} /></div>
        </div>
        <div><label style={{ fontSize:12, color:MUTED, display:'block', marginBottom:4 }}>Initial Balance ($)</label><input type="number" value={params.initialBalance} onChange={e=>setParams({...params, initialBalance:parseFloat(e.target.value)})} style={{ width:'100%', padding:8, background:'#0E1621', border:`1px solid ${DARK_BORDER}`, borderRadius:8, color:TEXT }} /></div>
        <button onClick={runBacktest} disabled={loading} style={{ width:'100%', marginTop:12, padding:10, background:TG_BLUE, color:'#fff', border:'none', borderRadius:8, fontWeight:700, cursor:'pointer', opacity:loading?0.6:1 }}>{loading ? 'Running...' : 'Run Backtest'}</button>
        {error && <p style={{ color:RED, marginTop:8 }}>{error}</p>}
      </div>
      {results && (
        <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 16, border: `1px solid ${DARK_BORDER}` }}>
          <h3 style={{ fontSize:16, fontWeight:600, marginBottom:12, color:TEXT }}>Results</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
            <MetricCard label="Total Return" value={`${results.totalReturn?.toFixed(2) || 0}%`} color={results.totalReturn >= 0 ? GREEN : RED} />
            <MetricCard label="Win Rate" value={`${results.winRate?.toFixed(1) || 0}%`} color={results.winRate >= 60 ? GREEN : GOLD} />
            <MetricCard label="Max Drawdown" value={`${results.maxDrawdown?.toFixed(2) || 0}%`} color={RED} />
          </div>
          <MetricCard label="Final Balance" value={`$${results.finalBalance?.toFixed(2) || 0}`} color={GREEN} />
          <div style={{ marginTop:8, display:'flex', gap:16, color:MUTED }}>
            <span>Trades: {results.totalTrades || 0}</span>
            <span>Win/Loss: {results.winningTrades || 0}/{results.losingTrades || 0}</span>
          </div>
        </div>
      )}
    </div>
  );
}
