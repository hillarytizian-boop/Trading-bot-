import { connectWebSocket, closeWebSocket } from "./websocket-patch";
const API_BASE_URL = "https://trading-bot-lsnu.onrender.com";
import { useState, useEffect, useRef, lazy, Suspense } from "react";

// ─── Lazy load heavy components ──────────────────────────────────
const Chart = lazy(() => import("./Chart"));
const Dashboard = lazy(() => import("./Dashboard"));
const Backtest = lazy(() => import("./Backtest"));

// ─── Constants ────────────────────────────────────────────────────
const TG_BLUE = "#2AABEE", DARK_BG = "#0E1621", DARK_PANEL = "#17212B";
const DARK_BORDER = "rgba(255,255,255,0.07)", TEXT = "#E7ECF0", MUTED = "#6C7883";
const GREEN = "#4FCE5D", RED = "#FF5E5E", GOLD = "#F0B429", sysFont = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const CURRENT_USER = { name: "Demo Trader", email: "demo@example.com", role: "user" };

// ─── Helper Components ────────────────────────────────────────────
function pill(c) { return { background: `${c}1f`, color: c, border: `1px solid ${c}55`, borderRadius: 20, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }; }
function Dot({ d }) { return <span style={{ width: 6, height: 6, borderRadius: "50%", background: MUTED, display: "inline-block", animation: "tgBounce 1.2s infinite", animationDelay: `${d}s` }} />; }
function SignalChip({ signal, confidence, risk }) {
  const c = signal === "BUY" ? GREEN : signal === "SELL" ? RED : MUTED;
  return ( <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}> <span style={{ background: `${c}22`, color: c, border: `1px solid ${c}55`, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{signal}</span> <span style={{ background: "rgba(240,180,41,0.15)", color: GOLD, border: "1px solid rgba(240,180,41,0.35)", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{confidence}%</span> <span style={{ background: "rgba(255,255,255,0.06)", color: MUTED, border: `1px solid ${DARK_BORDER}`, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>Risk: {risk}</span> </div> ); }
function BotBubble({ children, time }) { return ( <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "flex-end" }}> <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},#229ED9)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, color: "#fff", fontWeight: 700 }}>H</div> <div style={{ maxWidth: "82%" }}> <div style={{ background: "#182533", borderRadius: "4px 16px 16px 16px", padding: "10px 14px", fontSize: 14, lineHeight: 1.5 }}>{children}</div> <p style={{ fontSize: 11, color: MUTED, marginTop: 4, marginLeft: 4 }}>{time}</p> </div> </div> ); }
function UserBubble({ children, time }) { return ( <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}> <div style={{ maxWidth: "78%" }}> <div style={{ background: `linear-gradient(135deg,#2B5278,#1f3a52)`, borderRadius: "16px 4px 16px 16px", padding: "10px 14px", fontSize: 14, lineHeight: 1.5, color: "#fff" }}>{children}</div> <p style={{ fontSize: 11, color: MUTED, marginTop: 4, marginRight: 4, textAlign: "right" }}>{time} <span style={{ color: TG_BLUE }}>✓✓</span></p> </div> </div> ); }
function TgSwitch({ checked, onChange }) { return ( <div onClick={() => onChange(!checked)} style={{ width: 46, height: 26, borderRadius: 13, background: checked ? TG_BLUE : "rgba(255,255,255,0.14)", position: "relative", cursor: "pointer", transition: "background 0.25s", flexShrink: 0 }}> <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: checked ? 22 : 2, transition: "left 0.25s", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} /> </div> ); }
function TgListRow({ icon, label, sub, right, onClick, last }) { return ( <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 16px", cursor: onClick ? "pointer" : "default", borderBottom: last ? "none" : `1px solid ${DARK_BORDER}` }}> <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(42,171,238,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{icon}</div> <div style={{ flex: 1, minWidth: 0 }}> <p style={{ fontSize: 14, lineHeight: 1.2 }}>{label}</p> {sub && <p style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>{sub}</p>} </div> {right} </div> ); }
function Chevron() { return <span style={{ color: MUTED, fontSize: 16 }}>›</span>; }

// ─── AppHeader ────────────────────────────────────────────────────
function AppHeader({ onOpenSettings, binanceConnected }) {
  return (
    <div style={{ height: 56, background: DARK_PANEL, borderBottom: `1px solid ${DARK_BORDER}`, display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: 90 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},#229ED9)`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#fff", fontSize: 14 }}>H</div>
        {binanceConnected && <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}><span style={{ fontWeight: 700, fontSize: 16 }}>Hila Bot</span></div>
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onOpenSettings} aria-label="Settings" style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 17, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>⚙️</button>
      </div>
    </div>
  );
}

// ─── SettingsDrawer ──────────────────────────────────────────────
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
    if (!localEmail || !apiKey || !apiSecret) { alert('Please fill in email, API Key, and Secret.'); return; }
    setStatus('connecting');
    try {
      const res = await fetch(`${API_BASE_URL}/api/binance/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: localEmail, apiKey, secretKey: apiSecret }) });
      const data = await res.json();
      if (res.ok) {
        setStatus('connected');
        onBinanceConnect(localEmail);
        const balRes = await fetch(`/api/binance/balance?email=${encodeURIComponent(localEmail)}`);
        const balData = await balRes.json();
        if (balRes.ok) setBalance(balData.balance || '0.00');
      } else { setStatus('error'); alert('Failed to connect: ' + data.error); }
    } catch (err) { setStatus('error'); alert('Network error: ' + err.message); }
  };

  useEffect(() => {
    const WS_URL = "wss://trading-bot-lsnu.onrender.com/ws";
    console.log("[WS] Attempting to connect to", WS_URL);
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log("[WS] Connected to backend");
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[WS] Received:", data);
        if (data.price) {
          setPrice(data.price);
          setPriceHistory(prev => {
            const h = [...prev, data.price];
            return h.slice(-50);
          });
          setTickCount(prev => prev + 1);
        }
      } catch (e) {
        console.error("[WS] Parse error:", e);
      }
    };
    ws.onclose = () => {
      console.log("[WS] Disconnected");
    };
    ws.onerror = (e) => {
      console.error("[WS] Error:", e);
    };
    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, []);

  // ─── Scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    const WS_URL = "wss://trading-bot-lsnu.onrender.com/ws";
    console.log("[WS] Attempting to connect to", WS_URL);
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log("[WS] Connected to backend");
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[WS] Received:", data);
        if (data.price) {
          setPrice(data.price);
          setPriceHistory(prev => {
            const h = [...prev, data.price];
            return h.slice(-50);
          });
          setTickCount(prev => prev + 1);
        }
      } catch (e) {
        console.error("[WS] Parse error:", e);
      }
    };
    ws.onclose = () => {
      console.log("[WS] Disconnected");
    };
    ws.onerror = (e) => {
      console.error("[WS] Error:", e);
    };
    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
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
      await fetch(`${API_BASE_URL}/api/user/settings", { method: "POST", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CURRENT_USER.email, settings: { paperMode: value } }) });
    } catch (err) { console.error("Failed to save paper mode", err); }
  };

  const screens = {
    signals: <SignalsScreen binance={binance} onOpenSettings={() => setSettingsOpen(true)} selectedSymbol={selectedSymbol} paperMode={paperMode} />,
    dashboard: <Suspense fallback={<div style={{ padding: 16, color: MUTED }}>Loading Dashboard...</div>}><Dashboard binance={binance} email={CURRENT_USER.email} /></Suspense>,
    trades: <TradesScreen />,
    history: <HistoryScreen />,
    profile: <ProfileScreen user={CURRENT_USER} binance={binance} onOpenSettings={() => setSettingsOpen(true)} />,
    backtest: <Suspense fallback={<div style={{ padding: 16, color: MUTED }}>Loading Backtest...</div>}><Backtest /></Suspense>,
    admin: isAdmin ? <AdminScreen /> : <SignalsScreen binance={binance} onOpenSettings={() => setSettingsOpen(true)} selectedSymbol={selectedSymbol} paperMode={paperMode} />,
  };

  return (
    <div style={{ fontFamily: sysFont, color: TEXT, height: "100vh", width: "100%", background: DARK_BG, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`@keyframes tgBounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-4px);opacity:1} } * { box-sizing: border-box; } ::-webkit-scrollbar { width: 0; height: 0; } html, body { margin:0; padding:0; }`}</style>
      <AppHeader onOpenSettings={() => setSettingsOpen(true)} binanceConnected={binance.connected} />
      <div style={{ flex: 1, overflow: "hidden" }}>{screens[tab]}</div>
      <BottomNav tab={tab} setTab={setTab} isAdmin={isAdmin} />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} binance={binance} onBinanceConnect={handleBinanceConnect} email={CURRENT_USER.email} selectedSymbol={selectedSymbol} onSymbolChange={setSelectedSymbol} paperMode={paperMode} onPaperToggle={handlePaperToggle} />
    </div>
  );
}
