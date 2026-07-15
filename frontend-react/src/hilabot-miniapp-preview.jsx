import { useState, useEffect, useRef } from "react";
import Chart from "./Chart";
import Dashboard from "./Dashboard";
import Backtest from "./Backtest";

// ─── Design System ──────────────────────────────────────────────
const TG_BLUE = "#2AABEE";
const DARK_BG = "#0E1621";
const GLASS_BG = "rgba(255,255,255,0.04)";
const GLASS_BORDER = "rgba(255,255,255,0.08)";
const TEXT = "#E7ECF0";
const MUTED = "#6C7883";
const GREEN = "#4FCE5D";
const RED = "#FF5E5E";
const GOLD = "#F0B429";
const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const CURRENT_USER = { name: "Demo Trader", email: "demo@example.com", role: "user" };

const glass = {
  background: GLASS_BG,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${GLASS_BORDER}`,
  borderRadius: "16px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
};

// ─── Helpers ──────────────────────────────────────────────────
function pill(c) {
  return {
    background: `${c}22`,
    color: c,
    border: `1px solid ${c}55`,
    borderRadius: "30px",
    padding: "8px 18px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    backdropFilter: "blur(10px)",
    transition: "all 0.2s",
    ':hover': { transform: 'scale(1.03)' },
  };
}
function Dot({ d }) { return <span style={{ width: 6, height: 6, borderRadius: "50%", background: MUTED, display: "inline-block", animation: "tgBounce 1.2s infinite", animationDelay: `${d}s` }} />; }
function SignalChip({ signal, confidence, risk }) {
  const c = signal === "BUY" ? GREEN : signal === "SELL" ? RED : MUTED;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      <span style={{ background: `${c}22`, color: c, border: `1px solid ${c}55`, borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>{signal}</span>
      <span style={{ background: "rgba(240,180,41,0.15)", color: GOLD, border: "1px solid rgba(240,180,41,0.35)", borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>{confidence}%</span>
      <span style={{ background: "rgba(255,255,255,0.05)", color: MUTED, border: `1px solid ${GLASS_BORDER}`, borderRadius: 20, padding: "3px 12px", fontSize: 12 }}>Risk: {risk}</span>
    </div>
  );
}
function BotBubble({ children, time }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "flex-end" }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},#229ED9)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 12px rgba(42,171,238,0.3)" }}>H</div>
      <div style={{ maxWidth: "82%" }}>
        <div style={{ ...glass, padding: "12px 16px", borderRadius: "12px 16px 16px 16px", background: "rgba(255,255,255,0.05)" }}>{children}</div>
        <p style={{ fontSize: 11, color: MUTED, marginTop: 4, marginLeft: 4 }}>{time}</p>
      </div>
    </div>
  );
}
function UserBubble({ children, time }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
      <div style={{ maxWidth: "78%" }}>
        <div style={{ ...glass, padding: "12px 16px", borderRadius: "16px 12px 16px 16px", background: `linear-gradient(135deg,${TG_BLUE}33,#1a3a5a)` }}>{children}</div>
        <p style={{ fontSize: 11, color: MUTED, marginTop: 4, marginRight: 4, textAlign: "right" }}>{time} <span style={{ color: TG_BLUE }}>✓✓</span></p>
      </div>
    </div>
  );
}
function TgSwitch({ checked, onChange }) {
  return (
    <div onClick={() => onChange(!checked)} style={{ width: 46, height: 26, borderRadius: 13, background: checked ? TG_BLUE : "rgba(255,255,255,0.15)", position: "relative", cursor: "pointer", transition: "background 0.25s", flexShrink: 0, boxShadow: checked ? "0 0 20px rgba(42,171,238,0.3)" : "none" }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: checked ? 22 : 2, transition: "left 0.25s", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }} />
    </div>
  );
}
function TgListRow({ icon, label, sub, right, onClick, last }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", cursor: onClick ? "pointer" : "default", borderBottom: last ? "none" : `1px solid ${GLASS_BORDER}`, transition: "background 0.2s", ':hover': onClick ? { background: "rgba(255,255,255,0.03)" } : {} }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(42,171,238,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, lineHeight: 1.2 }}>{label}</p>
        {sub && <p style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}
function Chevron() { return <span style={{ color: MUTED, fontSize: 16 }}>›</span>; }

// ─── AppHeader ────────────────────────────────────────────────
function AppHeader({ onOpenSettings, binanceConnected }) {
  return (
    <div style={{ ...glass, height: 60, display: "flex", alignItems: "center", padding: "0 20px", flexShrink: 0, position: "relative", borderRadius: 0, borderBottom: `1px solid ${GLASS_BORDER}`, background: "rgba(14,22,33,0.7)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: 100 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},#229ED9)`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#fff", fontSize: 16, boxShadow: "0 4px 16px rgba(42,171,238,0.3)" }}>H</div>
        {binanceConnected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, boxShadow: "0 0 12px rgba(79,206,93,0.5)" }} />}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
        <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.5px" }}>Hila Bot</span>
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onOpenSettings} aria-label="Settings" style={{ ...glass, width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.2s", ':hover': { transform: 'scale(1.1)' } }}>⚙️</button>
      </div>
    </div>
  );
}

// ─── SettingsDrawer ──────────────────────────────────────────
function SettingsDrawer({ open, onClose, binance, onBinanceConnect, email, selectedSymbol, onSymbolChange, paperMode, onPaperToggle }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [localEmail, setLocalEmail] = useState(email || '');
  const [status, setStatus] = useState('idle');
  const [balance, setBalance] = useState('0.00');
  const [riskLevel, setRiskLevel] = useState("MEDIUM");
  const [maxDailyLoss, setMaxDailyLoss] = useState(10);
  const [maxTrades, setMaxTrades] = useState(30);
  const [autoCompound, setAutoCompound] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [autoStop, setAutoStop] = useState(true);
  const isConnected = binance?.connected || false;
  const displayBalance = binance?.balance || '0.00';

  const saveBinanceKeys = async () => {
    if (!localEmail || !apiKey || !apiSecret) { alert('Please fill in all fields.'); return; }
    setStatus('connecting');
    try {
      const res = await fetch('/api/binance/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: localEmail, apiKey, secretKey }) });
      const data = await res.json();
      if (res.ok) {
        setStatus('connected');
        onBinanceConnect(localEmail);
        const balRes = await fetch(`/api/binance/balance?email=${encodeURIComponent(localEmail)}`);
        const balData = await balRes.json();
        if (balRes.ok) setBalance(balData.balance || '0.00');
        alert('✅ Connected successfully!');
      } else {
        setStatus('error');
        alert('❌ ' + (data.error || 'Connection failed'));
      }
    } catch (err) {
      setStatus('error');
      alert('❌ Network error: ' + err.message);
    }
  };

  useEffect(() => {
    if (open && localEmail) {
      fetch(`/api/binance/status?email=${encodeURIComponent(localEmail)}`)
        .then(r => r.json())
        .then(data => { if (data.connected) { setStatus('connected'); fetch(`/api/binance/balance?email=${encodeURIComponent(localEmail)}`).then(r=>r.json()).then(bal => { if (bal.balance !== undefined) setBalance(bal.balance); }); } })
        .catch(() => {});
    }
  }, [open, localEmail]);

  const handleSymbolSelect = async (symbol) => {
    onSymbolChange(symbol);
    try {
      await fetch("/api/user/settings", { method: "POST", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: localEmail || email, settings: { market: symbol.replace("/", "") } }) });
    } catch (err) { console.error(err); }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity 0.3s", zIndex: 200 }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "85vh", background: DARK_BG, borderRadius: "24px 24px 0 0", transform: open ? "translateY(0)" : "translateY(100%)", transition: "transform 0.4s cubic-bezier(.2,.9,.3,1)", zIndex: 201, display: "flex", flexDirection: "column", boxShadow: "0 -20px 60px rgba(0,0,0,0.6)", borderTop: `1px solid ${GLASS_BORDER}` }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 16px", borderBottom: `1px solid ${GLASS_BORDER}` }}>
          <span style={{ fontWeight: 700, fontSize: 18 }}>Settings</span>
          <button onClick={onClose} style={{ ...glass, width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 14, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px 30px" }}>
          <p style={{ padding: "0 0 8px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.06em" }}>BINANCE ACCOUNT</p>
          <div style={{ ...glass, marginBottom: 18, overflow: "hidden" }}>
            {isConnected ? (
              <>
                <TgListRow icon="✅" label="Connected" sub={localEmail} right={<span style={{ fontSize: 12, color: GREEN, fontWeight: 700 }}>● LIVE</span>} />
                <TgListRow icon="💰" label="Balance" sub="USDT" right={<span style={{ fontFamily: "monospace", fontWeight: 700 }}>${displayBalance}</span>} />
                <TgListRow icon="🔑" label="API Key" sub="••••••••" right={<span style={{ fontSize: 12, color: MUTED }}>active</span>} last />
              </>
            ) : (
              <div style={{ padding: 16 }}>
                <p style={{ fontSize: 13, color: MUTED, marginBottom: 12, textAlign: "center" }}>Enter your Binance API credentials.</p>
                <input type="email" placeholder="Email" value={localEmail} onChange={e => setLocalEmail(e.target.value)} style={{ width: "100%", marginBottom: 10, padding: 12, borderRadius: 10, background: "rgba(0,0,0,0.3)", border: `1px solid ${GLASS_BORDER}`, color: TEXT, outline: "none", ':focus': { borderColor: TG_BLUE } }} />
                <input type="text" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{ width: "100%", marginBottom: 10, padding: 12, borderRadius: 10, background: "rgba(0,0,0,0.3)", border: `1px solid ${GLASS_BORDER}`, color: TEXT, outline: "none" }} />
                <input type="password" placeholder="Secret Key" value={apiSecret} onChange={e => setApiSecret(e.target.value)} style={{ width: "100%", marginBottom: 12, padding: 12, borderRadius: 10, background: "rgba(0,0,0,0.3)", border: `1px solid ${GLASS_BORDER}`, color: TEXT, outline: "none" }} />
                <button onClick={saveBinanceKeys} disabled={status === 'connecting'} style={{ ...pill(TG_BLUE), width: "100%", padding: "12px 0", opacity: status === 'connecting' ? 0.6 : 1 }}>{status === 'connecting' ? 'Connecting...' : '🔗 Connect'}</button>
              </div>
            )}
          </div>
          <p style={{ padding: "0 0 8px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.06em" }}>RISK LEVEL</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            {["LOW","MEDIUM","HIGH"].map(r => (
              <div key={r} onClick={() => setRiskLevel(r)} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", background: riskLevel === r ? `${TG_BLUE}22` : GLASS_BG, border: riskLevel === r ? `1px solid ${TG_BLUE}` : `1px solid ${GLASS_BORDER}`, color: riskLevel === r ? TG_BLUE : MUTED }}>{r}</div>
            ))}
          </div>
          <p style={{ padding: "0 0 8px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.06em" }}>TRADE LIMITS</p>
          <div style={{ ...glass, marginBottom: 18, padding: "4px 0" }}>
            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span style={{ fontSize: 14 }}>Max daily loss</span><span style={{ fontFamily: "monospace", fontWeight: 700, color: RED }}>${maxDailyLoss}</span></div>
              <input type="range" min={20} max={500} step={10} value={maxDailyLoss} onChange={e => setMaxDailyLoss(+e.target.value)} style={{ width: "100%", accentColor: RED }} />
            </div>
            <div style={{ height: 1, background: GLASS_BORDER }} />
            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span style={{ fontSize: 14 }}>Max trades per day</span><span style={{ fontFamily: "monospace", fontWeight: 700, color: TG_BLUE }}>{maxTrades}</span></div>
              <input type="range" min={5} max={200} step={5} value={maxTrades} onChange={e => setMaxTrades(+e.target.value)} style={{ width: "100%", accentColor: TG_BLUE }} />
            </div>
          </div>
          <p style={{ padding: "0 0 8px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.06em" }}>AUTOMATION</p>
          <div style={{ ...glass, marginBottom: 18, overflow: "hidden" }}>
            <TgListRow icon="🔄" label="Auto-compounding" sub="Reinvest profits" right={<TgSwitch checked={autoCompound} onChange={setAutoCompound} />} />
            <TgListRow icon="🔔" label="Trade notifications" sub="Alert on trade" right={<TgSwitch checked={notifications} onChange={setNotifications} />} />
            <TgListRow icon="📄" label="Paper Trading" sub="Simulate trades with virtual money" right={<TgSwitch checked={paperMode} onChange={() => onPaperToggle(!paperMode)} />} />
            <TgListRow icon="🛑" label="Auto stop loss" sub="Halt at daily loss" right={<TgSwitch checked={autoStop} onChange={setAutoStop} />} last />
          </div>
          <p style={{ padding: "0 0 8px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.06em" }}>MARKET</p>
          <div style={{ ...glass, marginBottom: 8, padding: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["BTC/USDT","ETH/USDT","BNB/USDT","SOL/USDT","XRP/USDT","ADA/USDT"].map(m => (
              <div key={m} onClick={() => handleSymbolSelect(m)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: selectedSymbol === m ? `1px solid ${TG_BLUE}` : `1px solid ${GLASS_BORDER}`, background: selectedSymbol === m ? `${TG_BLUE}22` : "rgba(255,255,255,0.02)", color: selectedSymbol === m ? TG_BLUE : MUTED, fontWeight: 600 }}>{m}</div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── SignalsScreen ──────────────────────────────────────────
function SignalsScreen({ binance, onOpenSettings, selectedSymbol = "BTC/USDT", paperMode }) {
  const [messages, setMessages] = useState(() => { try { return JSON.parse(localStorage.getItem('hila_messages')) || []; } catch { return []; } });
  const [price, setPrice] = useState(() => { try { return parseFloat(localStorage.getItem('hila_price')) || null; } catch { return null; } });
  const [priceHistory, setPriceHistory] = useState(() => { try { return JSON.parse(localStorage.getItem('hila_priceHistory')) || []; } catch { return []; } });
  const [signalHistory, setSignalHistory] = useState(() => { try { return JSON.parse(localStorage.getItem('hila_signalHistory')) || []; } catch { return []; } });
  const [tickCount, setTickCount] = useState(() => { try { return parseInt(localStorage.getItem('hila_tickCount')) || 0; } catch { return 0; } });
  const [paperBalance, setPaperBalance] = useState(() => { try { return parseFloat(localStorage.getItem('hila_paperBalance')) || null; } catch { return null; } });
  const [currentSignal, setCurrentSignal] = useState(() => { try { return JSON.parse(localStorage.getItem('hila_currentSignal')) || { signal: 'HOLD', confidence: 0, reason: 'Waiting...' }; } catch { return { signal: 'HOLD', confidence: 0, reason: 'Waiting...' }; } });
  const [analyzing, setAnalyzing] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const scrollRef = useRef(null);
  const wsRef = useRef(null);
  const lastPriceRef = useRef(null);

  useEffect(() => localStorage.setItem('hila_messages', JSON.stringify(messages)), [messages]);
  useEffect(() => localStorage.setItem('hila_price', price !== null ? String(price) : ''), [price]);
  useEffect(() => localStorage.setItem('hila_priceHistory', JSON.stringify(priceHistory)), [priceHistory]);
  useEffect(() => localStorage.setItem('hila_signalHistory', JSON.stringify(signalHistory)), [signalHistory]);
  useEffect(() => localStorage.setItem('hila_tickCount', String(tickCount)), [tickCount]);
  useEffect(() => { if (paperBalance !== null) localStorage.setItem('hila_paperBalance', String(paperBalance)); }, [paperBalance]);
  useEffect(() => localStorage.setItem('hila_currentSignal', JSON.stringify(currentSignal)), [currentSignal]);

  useEffect(() => {
    const sym = selectedSymbol.toLowerCase().replace('/', '').replace('usdt', 'usdt@trade');
    const wsUrl = `wss://stream.binance.com:9443/ws/${sym}`;
    wsRef.current = new WebSocket(wsUrl);
    wsRef.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.p) {
        const newPrice = parseFloat(data.p);
        setPrice(newPrice);
        setTickCount(prev => prev + 1);
        setPriceHistory(prev => { const u = [...prev, newPrice]; return u.slice(-50); });
        if (priceHistory.length > 10 && lastPriceRef.current !== newPrice) {
          lastPriceRef.current = newPrice;
          runAnalysis(newPrice);
        }
      }
    };
    return () => wsRef.current?.close();
  }, [selectedSymbol]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/agent/status')
        .then(r => r.json())
        .then(data => {
          setAgentRunning(data.running || false);
          if (data.paperBalance !== undefined) setPaperBalance(data.paperBalance);
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  function calcIndicators(prices) {
    if (prices.length < 10) return { rsi: 50, ema: prices[prices.length-1] || 0, macd: 0 };
    const gains = [], losses = [];
    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i-1];
      if (diff >= 0) gains.push(diff);
      else losses.push(-diff);
    }
    const avgGain = gains.reduce((a,b) => a+b, 0) / gains.length;
    const avgLoss = losses.reduce((a,b) => a+b, 0) / losses.length;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    const ema = prices.slice(-5).reduce((a,b) => a+b, 0) / 5;
    const ma5 = prices.slice(-5).reduce((a,b) => a+b, 0) / 5;
    const ma10 = prices.slice(-10).reduce((a,b) => a+b, 0) / 10;
    const macd = ma5 - ma10;
    return { rsi: Math.round(rsi), ema: Math.round(ema), macd: parseFloat(macd.toFixed(4)) };
  }

  const runAnalysis = async (currentPrice) => {
    if (analyzing || !currentPrice || priceHistory.length < 10) return;
    setAnalyzing(true);
    try {
      const ind = calcIndicators(priceHistory);
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: selectedSymbol,
          price: currentPrice,
          indicators: ind,
          email: CURRENT_USER.email,
        }),
      });
      const data = await res.json();
      setCurrentSignal(data);
      const emoji = data.signal === 'BUY' ? '🚀' : data.signal === 'SELL' ? '🔻' : '⏳';
      setMessages(prev => [...prev, {
        type: 'bot',
        time: new Date().toLocaleTimeString(),
        text: `${emoji} ${data.signal} (${data.confidence}%) · $${currentPrice.toFixed(2)}`,
        signal: data,
        reason: data.reason,
      }]);
      setSignalHistory(prev => { const u = [...prev, { signal: data.signal, confidence: data.confidence, price: currentPrice, time: new Date().toISOString() }]; return u.slice(-30); });
    } catch (e) { console.error('Analysis error:', e); }
    setAnalyzing(false);
  };

  const runManual = async () => {
    if (!price) { setMessages(prev => [...prev, { type: 'bot', time: 'now', text: '⏳ Waiting for price...' }]); return; }
    setAnalyzing(true);
    try {
      const ind = calcIndicators(priceHistory);
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: selectedSymbol,
          price,
          indicators: ind,
          email: CURRENT_USER.email,
        }),
      });
      const data = await res.json();
      setCurrentSignal(data);
      setMessages(prev => [...prev, {
        type: 'bot',
        time: new Date().toLocaleTimeString(),
        text: '📊 Manual:',
        signal: data,
        reason: data.reason,
      }]);
    } catch (e) { setMessages(prev => [...prev, { type: 'bot', time: 'now', text: '❌ Analysis failed.' }]); }
    setAnalyzing(false);
  };

  const startAgent = async () => {
    try {
      const res = await fetch('/api/agent/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CURRENT_USER.email }) });
      const data = await res.json();
      setMessages(prev => [...prev, { type: 'bot', time: 'now', text: `🤖 Agent ${data.status}` }]);
    } catch (e) { setMessages(prev => [...prev, { type: 'bot', time: 'now', text: '❌ Failed to start agent.' }]); }
  };
  const stopAgent = async () => {
    try {
      const res = await fetch('/api/agent/stop', { method: 'POST' });
      const data = await res.json();
      setMessages(prev => [...prev, { type: 'bot', time: 'now', text: `⏹ Agent ${data.status}` }]);
    } catch (e) { setMessages(prev => [...prev, { type: 'bot', time: 'now', text: '❌ Failed to stop agent.' }]); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: DARK_BG, backgroundImage: "radial-gradient(circle at 30% 0%, rgba(42,171,238,0.08), transparent 60%)" }}>
      <div style={{ flexShrink: 0, padding: "12px 16px", display: "flex", gap: 10, overflowX: "auto" }}>
        <StatChip label="Bot" value={agentRunning ? "Running" : "Stopped"} color={agentRunning ? GREEN : MUTED} dot={agentRunning} />
        <StatChip label="Balance" value={binance.connected ? `$${binance.balance}` : "Not linked"} color={binance.connected ? TEXT : MUTED} />
        {paperMode && paperBalance !== null && <StatChip label="Paper Balance" value={`$${paperBalance.toFixed(2)}`} color={GOLD} />}
        <StatChip label="Ticks" value={tickCount} color={TG_BLUE} />
      </div>
      <div style={{ flexShrink: 0, margin: "0 16px 12px", ...glass, padding: "12px", height: 220 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: MUTED, letterSpacing: "0.04em" }}>AI Market Chart</span>
          <span style={{ fontSize: 11, color: MUTED }}>{price ? `$${price.toFixed(2)}` : "Loading..."}</span>
        </div>
        <Chart priceHistory={priceHistory} signals={signalHistory} />
      </div>
      {!binance.connected && (
        <div onClick={onOpenSettings} style={{ flexShrink: 0, margin: "0 16px 12px", ...glass, padding: "10px 16px", fontSize: 13, color: GOLD, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>⚠️ Connect your Binance account to start live trading</span>
          <span style={{ fontSize: 18 }}>›</span>
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "6px 16px 16px" }}>
        <div style={{ textAlign: "center", margin: "8px 0 16px" }}>
          <span style={{ ...glass, padding: "4px 16px", borderRadius: 20, fontSize: 11, color: MUTED, background: "rgba(255,255,255,0.05)" }}>
            📊 {currentSignal.signal} · {currentSignal.confidence}% · {tickCount} ticks
          </span>
        </div>
        {messages.map((m, i) =>
          m.type === "bot" ? (
            <BotBubble key={i} time={m.time}>
              {m.text}
              {m.signal && (
                <>
                  <SignalChip signal={m.signal.signal} confidence={m.signal.confidence || 0} risk={m.signal.risk || "LOW"} />
                  <p style={{ fontSize: 13, color: "#9fb3c0", marginTop: 8, fontStyle: "italic" }}>"{m.reason}"</p>
                </>
              )}
            </BotBubble>
          ) : (
            <UserBubble key={i} time={m.time}>{m.text}</UserBubble>
          )
        )}
        {analyzing && (
          <BotBubble time="now">
            <span style={{ display: "inline-flex", gap: 4 }}><Dot d={0} /><Dot d={0.15} /><Dot d={0.3} /></span>
          </BotBubble>
        )}
      </div>
      <div style={{ flexShrink: 0, padding: "12px 16px", borderTop: `1px solid ${GLASS_BORDER}`, background: "rgba(0,0,0,0.3)", display: "flex", gap: 8 }}>
        <button onClick={runManual} style={{ ...pill(TG_BLUE), flex: 1 }}>🧠 Analyze</button>
        <button onClick={startAgent} style={{ ...pill(GREEN), flex: 1 }}>▶ Start</button>
        <button onClick={stopAgent} style={{ ...pill(GOLD), flex: 1 }}>⏸ Pause</button>
        <button style={{ ...pill(RED), flex: 1 }}>⏹ Stop</button>
      </div>
    </div>
  );
}

function StatChip({ label, value, color, dot }) {
  return (
    <div style={{ ...glass, padding: "8px 14px", minWidth: 80, flexShrink: 0, borderRadius: "30px", background: "rgba(255,255,255,0.04)" }}>
      <p style={{ fontSize: 10, color: MUTED, display: "flex", alignItems: "center", gap: 5, letterSpacing: "0.04em" }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN }} />}
        {label}
      </p>
      <p style={{ fontSize: 15, fontWeight: 700, color: color || TEXT, fontFamily: "monospace", marginTop: 2 }}>{value}</p>
    </div>
  );
}

function TradesScreen() { return <div style={{ padding: 16, color: MUTED, textAlign: "center" }}>📈 Real trades (Supabase)</div>; }
function HistoryScreen() { return <div style={{ padding: 16, color: MUTED, textAlign: "center" }}>📋 Trade history</div>; }
function ProfileScreen() { return <div style={{ padding: 16, color: MUTED, textAlign: "center" }}>👤 Profile</div>; }
function AdminScreen() { return <div style={{ padding: 16, color: MUTED, textAlign: "center" }}>🛡️ Admin</div>; }

// ─── BottomNav ────────────────────────────────────────────────
function BottomNav({ tab, setTab, isAdmin }) {
  const tabs = [
    { id: "signals", icon: "💬", label: "Signals" },
    { id: "dashboard", icon: "📊", label: "Dashboard" },
    { id: "trades", icon: "📈", label: "Trades" },
    { id: "history", icon: "📋", label: "History" },
    { id: "profile", icon: "👤", label: "Profile" },
    { id: "backtest", icon: "🔬", label: "Backtest" },
  ];
  if (isAdmin) tabs.push({ id: "admin", icon: "🛡️", label: "Admin" });
  return (
    <div style={{ display: "flex", background: "rgba(20,28,36,0.8)", backdropFilter: "blur(20px)", borderTop: `1px solid ${GLASS_BORDER}`, flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, background: "none", border: "none", padding: "8px 0 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, cursor: "pointer", color: tab === t.id ? TG_BLUE : MUTED, transition: "color 0.2s" }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          <span style={{ fontSize: 10, fontWeight: tab === t.id ? 700 : 500 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────
export default function HilaBotMiniApp() {
  const [tab, setTab] = useState("signals");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [binance, setBinance] = useState({ connected: false, balance: "0.00" });
  const [selectedSymbol, setSelectedSymbol] = useState("BTC/USDT");
  const [paperMode, setPaperMode] = useState(false);
  const isAdmin = CURRENT_USER.role === "admin";

  useEffect(() => {
    const email = CURRENT_USER.email;
    if (email) {
      fetch(`/api/user/settings?email=${encodeURIComponent(email)}`)
        .then(r => r.json())
        .then(data => {
          if (data.settings) {
            if (data.settings.market) setSelectedSymbol(data.settings.market.replace(/USDT$/, "/USDT"));
            if (data.settings.paperMode !== undefined) setPaperMode(data.settings.paperMode);
          }
        })
        .catch(() => {});
      fetch(`/api/binance/status?email=${encodeURIComponent(email)}`)
        .then(r => r.json())
        .then(data => {
          if (data.connected) {
            setBinance(prev => ({ ...prev, connected: true }));
            fetch(`/api/binance/balance?email=${encodeURIComponent(email)}`)
              .then(r => r.json())
              .then(bal => { if (bal.balance !== undefined) setBinance(prev => ({ ...prev, balance: bal.balance })); });
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleBinanceConnect = async (email) => {
    const statusRes = await fetch(`/api/binance/status?email=${encodeURIComponent(email)}`);
    const statusData = await statusRes.json();
    if (statusData.connected) {
      setBinance(prev => ({ ...prev, connected: true }));
      const balRes = await fetch(`/api/binance/balance?email=${encodeURIComponent(email)}`);
      const balData = await balRes.json();
      if (balData.balance !== undefined) setBinance(prev => ({ ...prev, balance: balData.balance }));
    }
  };

  const handlePaperToggle = async (value) => {
    setPaperMode(value);
    try {
      await fetch("/api/user/settings", { method: "POST", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CURRENT_USER.email, settings: { paperMode: value } }) });
    } catch (err) { console.error(err); }
  };

  const screens = {
    signals: <SignalsScreen binance={binance} onOpenSettings={() => setSettingsOpen(true)} selectedSymbol={selectedSymbol} paperMode={paperMode} />,
    dashboard: <Dashboard binance={binance} email={CURRENT_USER.email} />,
    trades: <TradesScreen />,
    history: <HistoryScreen />,
    profile: <ProfileScreen />,
    backtest: <Backtest />,
    admin: isAdmin ? <AdminScreen /> : <SignalsScreen binance={binance} onOpenSettings={() => setSettingsOpen(true)} selectedSymbol={selectedSymbol} paperMode={paperMode} />,
  };

  return (
    <div style={{ fontFamily: font, color: TEXT, height: "100vh", width: "100%", background: DARK_BG, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes tgBounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-4px);opacity:1} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 0; height: 0; }
        html, body { margin:0; padding:0; }
        button { font-family: inherit; }
      `}</style>
      <AppHeader onOpenSettings={() => setSettingsOpen(true)} binanceConnected={binance.connected} />
      <div style={{ flex: 1, overflow: "hidden" }}>{screens[tab]}</div>
      <BottomNav tab={tab} setTab={setTab} isAdmin={isAdmin} />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} binance={binance} onBinanceConnect={handleBinanceConnect} email={CURRENT_USER.email} selectedSymbol={selectedSymbol} onSymbolChange={setSelectedSymbol} paperMode={paperMode} onPaperToggle={handlePaperToggle} />
    </div>
  );
}
