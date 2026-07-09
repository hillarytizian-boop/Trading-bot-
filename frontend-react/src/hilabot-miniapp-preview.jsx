import { useState, useEffect, useRef } from "react";
import Chart from "./Chart";
import Dashboard from "./Dashboard";
import Backtest from "./Backtest";

const TG_BLUE = "#2AABEE";
const TG_BLUE_DEEP = "#229ED9";
const DARK_BG = "#0E1621";
const DARK_PANEL = "#17212B";
const DARK_BUBBLE_IN = "#182533";
const DARK_BUBBLE_OUT = "#2B5278";
const DARK_BORDER = "rgba(255,255,255,0.07)";
const TEXT = "#E7ECF0";
const MUTED = "#6C7883";
const GREEN = "#4FCE5D";
const RED = "#FF5E5E";
const GOLD = "#F0B429";
const sysFont = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const CURRENT_USER = { name: "Demo Trader", email: "demo@example.com", role: "user" };

function pill(color) {
  return {
    background: `${color}1f`,
    color,
    border: `1px solid ${color}55`,
    borderRadius: 20,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function Dot({ delay }) {
  return (
    <span
      style={{ width: 6, height: 6, borderRadius: "50%", background: MUTED, display: "inline-block", animation: "tgBounce 1.2s infinite", animationDelay: `${delay}s` }}
    />
  );
}

function SignalChip({ signal, confidence, risk }) {
  const c = signal === "BUY" ? GREEN : signal === "SELL" ? RED : MUTED;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      <span style={{ background: `${c}22`, color: c, border: `1px solid ${c}55`, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{signal}</span>
      <span style={{ background: "rgba(240,180,41,0.15)", color: GOLD, border: "1px solid rgba(240,180,41,0.35)", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{confidence}% conf</span>
      <span style={{ background: "rgba(255,255,255,0.06)", color: MUTED, border: `1px solid ${DARK_BORDER}`, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>Risk: {risk}</span>
    </div>
  );
}

function BotBubble({ children, time }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "flex-end" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},${TG_BLUE_DEEP})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, color: "#fff", fontWeight: 700 }}>H</div>
      <div style={{ maxWidth: "82%" }}>
        <div style={{ background: DARK_BUBBLE_IN, borderRadius: "4px 16px 16px 16px", padding: "10px 14px", fontSize: 14, lineHeight: 1.5 }}>{children}</div>
        <p style={{ fontSize: 11, color: MUTED, marginTop: 4, marginLeft: 4 }}>{time}</p>
      </div>
    </div>
  );
}

function UserBubble({ children, time }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
      <div style={{ maxWidth: "78%" }}>
        <div style={{ background: `linear-gradient(135deg,${DARK_BUBBLE_OUT},#1f3a52)`, borderRadius: "16px 4px 16px 16px", padding: "10px 14px", fontSize: 14, lineHeight: 1.5, color: "#fff" }}>{children}</div>
        <p style={{ fontSize: 11, color: MUTED, marginTop: 4, marginRight: 4, textAlign: "right" }}>{time} <span style={{ color: TG_BLUE }}>✓✓</span></p>
      </div>
    </div>
  );
}

function TgSwitch({ checked, onChange }) {
  return (
    <div onClick={() => onChange(!checked)} style={{ width: 46, height: 26, borderRadius: 13, background: checked ? TG_BLUE : "rgba(255,255,255,0.14)", position: "relative", cursor: "pointer", transition: "background 0.25s", flexShrink: 0 }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: checked ? 22 : 2, transition: "left 0.25s", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
    </div>
  );
}

function TgListRow({ icon, label, sub, right, onClick, last }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 16px", cursor: onClick ? "pointer" : "default", borderBottom: last ? "none" : `1px solid ${DARK_BORDER}` }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(42,171,238,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, lineHeight: 1.2 }}>{label}</p>
        {sub && <p style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function Chevron() {
  return <span style={{ color: MUTED, fontSize: 16 }}>›</span>;
}

function MarketTag({ label, defaultSelected }) {
  const [sel, setSel] = useState(defaultSelected);
  return (
    <div onClick={() => setSel(!sel)} style={{ padding: "6px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: sel ? `1px solid ${TG_BLUE}` : `1px solid ${DARK_BORDER}`, background: sel ? `${TG_BLUE}1f` : "rgba(255,255,255,0.02)", color: sel ? TG_BLUE : MUTED, fontWeight: 600 }}>
      {label}
    </div>
  );
}

function AppHeader({ onOpenSettings, binanceConnected }) {
  return (
    <div style={{ height: 56, background: DARK_PANEL, borderBottom: `1px solid ${DARK_BORDER}`, display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: 90 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},${TG_BLUE_DEEP})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#fff", fontSize: 14 }}>H</div>
        {binanceConnected && <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Hila Bot</span>
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onOpenSettings} aria-label="Settings" style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 17, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>⚙️</button>
      </div>
    </div>
  );
}

function SettingsDrawer({ open, onClose, binance, onBinanceConnect, email }) {
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
    if (!localEmail || !apiKey || !apiSecret) {
      alert('Please fill in email, API Key, and Secret.');
      return;
    }
    setStatus('connecting');
    try {
      const res = await fetch('/api/binance/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: localEmail, apiKey, secretKey: apiSecret }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('connected');
        onBinanceConnect(localEmail);
        const balRes = await fetch(`/api/binance/balance?email=${encodeURIComponent(localEmail)}`);
        const balData = await balRes.json();
        if (balRes.ok) setBalance(balData.balance || '0.00');
      } else {
        setStatus('error');
        alert('Failed to connect: ' + data.error);
      }
    } catch (err) {
      setStatus('error');
      alert('Network error: ' + err.message);
    }
  };

  useEffect(() => {
    if (open && localEmail) {
      fetch(`/api/binance/status?email=${encodeURIComponent(localEmail)}`)
        .then(r => r.json())
        .then(data => {
          if (data.connected) {
            setStatus('connected');
            fetch(`/api/binance/balance?email=${encodeURIComponent(localEmail)}`)
              .then(r => r.json())
              .then(bal => {
                if (bal.balance !== undefined) setBalance(bal.balance);
              });
          }
        })
        .catch(() => {});
    }
  }, [open, localEmail]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity 0.25s", zIndex: 200 }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "88vh", background: DARK_BG, borderRadius: "20px 20px 0 0", transform: open ? "translateY(0)" : "translateY(100%)", transition: "transform 0.3s cubic-bezier(.2,.8,.2,1)", zIndex: 201, display: "flex", flexDirection: "column", boxShadow: "0 -10px 40px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px 12px", borderBottom: `1px solid ${DARK_BORDER}` }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Settings</span>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: TEXT, width: 30, height: 30, borderRadius: "50%", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, paddingBottom: 24 }}>
          <p style={{ padding: "14px 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>BINANCE ACCOUNT</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 18px", borderRadius: 14, overflow: "hidden" }}>
            {isConnected ? (
              <>
                <TgListRow icon="✅" label="Connected" sub="Binance API" right={<span style={{ fontSize: 11, color: GREEN, fontWeight: 700 }}>● LIVE</span>} />
                <TgListRow icon="💰" label="Balance" sub="USDT" right={<span style={{ fontFamily: "monospace" }}>{displayBalance}</span>} />
                <TgListRow icon="🔑" label="API Key" sub="••••••••" right={<span style={{ fontSize: 11, color: MUTED }}>active</span>} last />
              </>
            ) : (
              <div style={{ padding: 16, textAlign: "center" }}>
                <p style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>Enter your Binance API credentials.</p>
                <input type="email" placeholder="Email" value={localEmail} onChange={e => setLocalEmail(e.target.value)} style={{ width: "100%", marginBottom: 8, padding: 10, borderRadius: 8, background: "#0E1621", border: `1px solid ${DARK_BORDER}`, color: TEXT }} />
                <input type="text" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{ width: "100%", marginBottom: 8, padding: 10, borderRadius: 8, background: "#0E1621", border: `1px solid ${DARK_BORDER}`, color: TEXT }} />
                <input type="password" placeholder="Secret Key" value={apiSecret} onChange={e => setApiSecret(e.target.value)} style={{ width: "100%", marginBottom: 12, padding: 10, borderRadius: 8, background: "#0E1621", border: `1px solid ${DARK_BORDER}`, color: TEXT }} />
                <button onClick={saveBinanceKeys} disabled={status === 'connecting'} style={{ ...pill(TG_BLUE), width: "100%", padding: "11px 0", opacity: status === 'connecting' ? 0.6 : 1 }}>{status === 'connecting' ? 'Connecting...' : '🔗 Connect to Binance'}</button>
              </div>
            )}
          </div>
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>RISK LEVEL</p>
          <div style={{ display: "flex", gap: 8, padding: "0 14px", marginBottom: 18 }}>
            {["LOW", "MEDIUM", "HIGH"].map((r) => (
              <div key={r} onClick={() => setRiskLevel(r)} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 14, fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: riskLevel === r ? `${TG_BLUE}22` : DARK_PANEL, border: riskLevel === r ? `1px solid ${TG_BLUE}` : `1px solid ${DARK_BORDER}`, color: riskLevel === r ? TG_BLUE : MUTED }}>{r === "LOW" ? "🟢" : r === "MEDIUM" ? "🟡" : "🔴"} {r}</div>
            ))}
          </div>
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>TRADE LIMITS</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 18px", borderRadius: 14, padding: "4px 0" }}>
            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 13.5 }}>Max daily loss</span><span style={{ fontFamily: "monospace", fontWeight: 700, color: RED }}>${maxDailyLoss}</span></div>
              <input type="range" min={20} max={500} step={10} value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(+e.target.value)} style={{ width: "100%", accentColor: RED }} />
            </div>
            <div style={{ height: 1, background: DARK_BORDER }} />
            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 13.5 }}>Max trades per day</span><span style={{ fontFamily: "monospace", fontWeight: 700, color: TG_BLUE }}>{maxTrades}</span></div>
              <input type="range" min={5} max={200} step={5} value={maxTrades} onChange={(e) => setMaxTrades(+e.target.value)} style={{ width: "100%", accentColor: TG_BLUE }} />
            </div>
          </div>
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>AUTOMATION</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 18px", borderRadius: 14, overflow: "hidden" }}>
            <TgListRow icon="🔄" label="Auto-compounding" sub="Reinvest profits" right={<TgSwitch checked={autoCompound} onChange={setAutoCompound} />} />
            <TgListRow icon="🔔" label="Trade notifications" sub="Alert on trade" right={<TgSwitch checked={notifications} onChange={setNotifications} />} />
            <TgListRow icon="🛑" label="Auto stop loss" sub="Halt at daily loss" right={<TgSwitch checked={autoStop} onChange={setAutoStop} />} last />
          </div>
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>MARKET SELECTION</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 8px", borderRadius: 14, padding: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT", "ADA/USDT"].map((m, i) => (<MarketTag key={m} label={m} defaultSelected={i < 3} />))}
          </div>
        </div>
      </div>
    </>
  );
}

function SignalsScreen({ binance, onOpenSettings }) {
  const [messages, setMessages] = useState([]);
  const [price, setPrice] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [signalHistory, setSignalHistory] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const scrollRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    wsRef.current = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    wsRef.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.p) {
        const newPrice = parseFloat(data.p);
        setPrice(newPrice);
        setPriceHistory(prev => {
          const updated = [...prev, newPrice];
          return updated.slice(-50);
        });
      }
    };
    return () => wsRef.current?.close();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/agent/status')
        .then(r => r.json())
        .then(data => {
          if (data.signalHistory) {
            setSignalHistory(data.signalHistory.slice(-30));
          }
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const runAnalysis = async () => {
    if (!price) {
      setMessages(prev => [...prev, { type: 'bot', time: 'now', text: '⏳ Waiting for price data...' }]);
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: 'BTC/USDT', price, indicators: { rsi: 50, ema: 0, macd: 0 } }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, {
        type: 'bot',
        time: new Date().toLocaleTimeString(),
        text: 'Analysis result:',
        signal: data,
        reason: data.reason,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, { type: 'bot', time: 'now', text: '❌ Analysis failed.' }]);
    }
    setAnalyzing(false);
  };

  const startAgent = async () => {
    try {
      const res = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: CURRENT_USER.email }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { type: 'bot', time: 'now', text: `🤖 Agent ${data.status}` }]);
    } catch (err) {
      setMessages(prev => [...prev, { type: 'bot', time: 'now', text: '❌ Failed to start agent.' }]);
    }
  };

  const stopAgent = async () => {
    try {
      const res = await fetch('/api/agent/stop', { method: 'POST' });
      const data = await res.json();
      setMessages(prev => [...prev, { type: 'bot', time: 'now', text: `⏹ Agent ${data.status}` }]);
    } catch (err) {
      setMessages(prev => [...prev, { type: 'bot', time: 'now', text: '❌ Failed to stop agent.' }]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: DARK_BG, backgroundImage: "radial-gradient(circle at 30% 0%, rgba(42,171,238,0.06), transparent 45%)" }}>
      <div style={{ display: "flex", gap: 8, padding: "10px 14px", overflowX: "auto" }}>
        <StatChip label="Bot" value="Active" color={GREEN} dot />
        <StatChip label="Balance" value={binance.connected ? `$${binance.balance}` : "Not linked"} color={binance.connected ? TEXT : MUTED} />
        <StatChip label="Win rate" value="—" color={TEXT} />
        <StatChip label="Today" value="—" color={GOLD} />
      </div>

      <div style={{ margin: "0 14px 10px", background: DARK_PANEL, borderRadius: 14, padding: 12, border: `1px solid ${DARK_BORDER}`, height: 220 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, padding: "0 4px" }}>
          <span style={{ fontSize: 11, color: MUTED }}>AI Market Chart</span>
          <span style={{ fontSize: 11, color: MUTED }}>{price ? `$${price.toFixed(2)}` : "Loading..."}</span>
        </div>
        <Chart priceHistory={priceHistory} signals={signalHistory} />
      </div>

      {!binance.connected && (
        <div onClick={onOpenSettings} style={{ margin: "0 14px 10px", background: "rgba(240,180,41,0.1)", border: "1px solid rgba(240,180,41,0.3)", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: GOLD, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>⚠️ Connect your Binance account to start live trading</span>
          <span>›</span>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "6px 14px 14px", minHeight: 0 }}>
        <div style={{ textAlign: "center", margin: "8px 0 16px" }}>
          <span style={{ background: "rgba(255,255,255,0.06)", color: MUTED, fontSize: 11, padding: "4px 12px", borderRadius: 12 }}>Today</span>
        </div>
        {messages.map((m, i) =>
          m.type === "bot" ? (
            <BotBubble key={i} time={m.time}>
              {m.text}
              {m.signal && (
                <>
                  <SignalChip signal={m.signal.signal} confidence={m.signal.confidence} risk={m.signal.risk || "LOW"} />
                  <p style={{ fontSize: 12.5, color: "#9fb3c0", marginTop: 8, fontStyle: "italic" }}>"{m.reason}"</p>
                </>
              )}
            </BotBubble>
          ) : (
            <UserBubble key={i} time={m.time}>{m.text}</UserBubble>
          )
        )}
        {analyzing && (
          <BotBubble time="now">
            <span style={{ display: "inline-flex", gap: 4 }}>
              <Dot delay={0} /> <Dot delay={0.15} /> <Dot delay={0.3} />
            </span>
          </BotBubble>
        )}
      </div>

      <div style={{ padding: "10px 12px", borderTop: `1px solid ${DARK_BORDER}`, background: DARK_PANEL, display: "flex", gap: 8, overflowX: "auto" }}>
        <button onClick={runAnalysis} style={pill(TG_BLUE)}>🧠 Analyze</button>
        <button onClick={startAgent} style={pill(GREEN)}>▶ Start</button>
        <button onClick={stopAgent} style={pill(GOLD)}>⏸ Pause</button>
        <button style={pill(RED)}>⏹ Stop</button>
      </div>
    </div>
  );
}

function StatChip({ label, value, color, dot }) {
  return (
    <div style={{ background: DARK_PANEL, borderRadius: 14, padding: "8px 14px", minWidth: 100, flexShrink: 0 }}>
      <p style={{ fontSize: 10.5, color: MUTED, display: "flex", alignItems: "center", gap: 5 }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN }} />}
        {label}
      </p>
      <p style={{ fontSize: 14.5, fontWeight: 700, color, fontFamily: "monospace", marginTop: 2 }}>{value}</p>
    </div>
  );
}

function TradesScreen() {
  const [activeTrades, setActiveTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const email = CURRENT_USER.email;
    fetch(`/api/trades/active?email=${encodeURIComponent(email)}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch active trades');
        return r.json();
      })
      .then(data => {
        setActiveTrades(data || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: DARK_BG, padding: "14px" }}>
      <p style={{ fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 10 }}>ACTIVE TRADES ({activeTrades.length})</p>
      {loading && <div style={{ textAlign: "center", color: MUTED, padding: 20 }}>Loading...</div>}
      {error && <div style={{ textAlign: "center", color: RED, padding: 20 }}>Error: {error}</div>}
      {!loading && !error && activeTrades.length === 0 && <div style={{ textAlign: "center", color: MUTED, padding: 20 }}>No open trades.</div>}
      {activeTrades.map((t, i) => (
        <div key={i} style={{ background: DARK_PANEL, borderRadius: 16, padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{t.symbol}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 14, color: t.type === "BUY" ? GREEN : RED, background: t.type === "BUY" ? "rgba(79,206,93,0.15)" : "rgba(255,94,94,0.15)" }}>{t.type}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 10 }}>
            <div><p style={{ color: MUTED, fontSize: 11 }}>Entry</p><p style={{ fontFamily: "monospace" }}>{t.entry_price}</p></div>
            <div><p style={{ color: MUTED, fontSize: 11 }}>Current</p><p style={{ fontFamily: "monospace" }}>—</p></div>
            <div style={{ textAlign: "right" }}><p style={{ color: MUTED, fontSize: 11 }}>P&L</p><p style={{ fontFamily: "monospace", fontWeight: 700, color: GREEN }}>—</p></div>
          </div>
          <SignalChip signal={t.type} confidence={t.signal_confidence || 70} risk="LOW" />
        </div>
      ))}
    </div>
  );
}

function HistoryScreen() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const email = CURRENT_USER.email;
    fetch(`/api/trades?email=${encodeURIComponent(email)}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch history');
        return r.json();
      })
      .then(data => {
        setHistory(data || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: DARK_BG }}>
      <div style={{ display: "flex", gap: 10, padding: "14px", overflowX: "auto" }}>
        <StatChip label="Total" value={history.length} color={TEXT} />
        <StatChip label="Win rate" value="—" color={GREEN} />
        <StatChip label="Total P&L" value="—" color={GOLD} />
      </div>
      <div style={{ padding: "0 14px 14px" }}>
        {loading && <div style={{ textAlign: "center", color: MUTED, padding: 20 }}>Loading...</div>}
        {error && <div style={{ textAlign: "center", color: RED, padding: 20 }}>Error: {error}</div>}
        {!loading && !error && history.length === 0 && <div style={{ textAlign: "center", color: MUTED, padding: 20 }}>No trades yet.</div>}
        {history.map((t) => (
          <BotBubble key={t.id} time={new Date(t.opened_at).toLocaleTimeString()}>
            <strong>{t.type}</strong> {t.symbol} — {t.status === "closed" ? (t.pnl >= 0 ? "🟢 WIN" : "🔴 LOSS") : "⏳ Open"}
            <SignalChip signal={t.type} confidence={t.signal_confidence || 70} risk={t.status === "closed" && t.pnl < 0 ? "HIGH" : "LOW"} />
            <p style={{ marginTop: 6, fontFamily: "monospace", fontWeight: 700, color: t.pnl >= 0 ? GREEN : RED }}>
              {t.pnl >= 0 ? "+" : "-"}${Math.abs(t.pnl || 0).toFixed(2)}
            </p>
          </BotBubble>
        ))}
      </div>
    </div>
  );
}

function ProfileScreen({ user, binance, onOpenSettings }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: DARK_BG, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},${TG_BLUE_DEEP})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "#fff" }}>{user.name[0]}</div>
        <div><p style={{ fontSize: 17, fontWeight: 700 }}>{user.name}</p><p style={{ fontSize: 12.5, color: MUTED }}>{user.role === "admin" ? "Administrator" : "Trader"} · Pro Plan</p></div>
      </div>
      <p style={{ fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 8 }}>ACCOUNT</p>
      <div style={{ background: DARK_PANEL, borderRadius: 14, overflow: "hidden", marginBottom: 18 }}>
        <TgListRow icon="🔗" label="Binance account" sub={binance.connected ? "Connected" : "Not connected"} right={<Chevron />} onClick={onOpenSettings} />
        <TgListRow icon="💳" label="Billing & subscription" sub="Pro · $79/mo" right={<Chevron />} />
        <TgListRow icon="🔒" label="Security" sub="Password, 2FA" right={<Chevron />} last />
      </div>
      <p style={{ fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 8 }}>STATS</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
        <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 14 }}><p style={{ fontSize: 11, color: MUTED }}>Total trades</p><p style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace" }}>—</p></div>
        <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 14 }}><p style={{ fontSize: 11, color: MUTED }}>Win rate</p><p style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: GREEN }}>—</p></div>
      </div>
      <button onClick={onOpenSettings} style={{ ...pill(TG_BLUE), width: "100%", padding: "12px 0", marginBottom: 10 }}>⚙️ Open Settings</button>
      <button style={{ ...pill(RED), width: "100%", padding: "12px 0" }}>🚪 Sign Out</button>
    </div>
  );
}

function AdminScreen() {
  const users = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    name: ["Alice M.", "Bob K.", "Carol T.", "David O.", "Eve N.", "Frank A.", "Grace W.", "Hank P."][i],
    plan: ["starter", "pro", "elite", "pro", "starter", "pro", "elite", "starter"][i],
    status: i % 4 === 3 ? "stopped" : "active",
    pnl: (Math.random() * 2000 - 200).toFixed(2),
  }));
  return (
    <div style={{ flex: 1, overflowY: "auto", background: DARK_BG }}>
      <div style={{ display: "flex", gap: 10, padding: "14px", overflowX: "auto" }}>
        <StatChip label="Users" value="2,841" color={TEXT} />
        <StatChip label="Active bots" value="1,204" color={GREEN} />
        <StatChip label="MRR" value="$98.4K" color={GOLD} />
      </div>
      <p style={{ padding: "0 14px 8px", fontSize: 12, color: MUTED, fontWeight: 700 }}>MEMBERS</p>
      {users.map((u) => (
        <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${DARK_BORDER}` }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#3a4a5c,#222e3a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{u.name[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{u.name}</span><span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 9, background: "rgba(240,180,41,0.15)", color: GOLD, textTransform: "uppercase" }}>{u.plan}</span></div>
            <p style={{ fontSize: 11.5, color: u.status === "active" ? GREEN : MUTED }}>{u.status === "active" ? "● online" : "○ offline"}</p>
          </div>
          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5, color: parseFloat(u.pnl) >= 0 ? GREEN : RED }}>{parseFloat(u.pnl) >= 0 ? "+" : "-"}${Math.abs(u.pnl)}</span>
        </div>
      ))}
    </div>
  );
}

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
    <div style={{ display: "flex", background: DARK_PANEL, borderTop: `1px solid ${DARK_BORDER}`, flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, background: "none", border: "none", padding: "8px 0 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", color: tab === t.id ? TG_BLUE : MUTED }}>
          <span style={{ fontSize: 19, lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: 10.5, fontWeight: tab === t.id ? 700 : 500 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function HilaBotMiniApp() {
  const [tab, setTab] = useState("signals");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [binance, setBinance] = useState({ connected: false, balance: "0.00" });
  const isAdmin = CURRENT_USER.role === "admin";

  useEffect(() => {
    const email = CURRENT_USER.email;
    if (email) {
      fetch(`/api/binance/status?email=${encodeURIComponent(email)}`)
        .then(r => r.json())
        .then(data => {
          if (data.connected) {
            setBinance(prev => ({ ...prev, connected: true }));
            fetch(`/api/binance/balance?email=${encodeURIComponent(email)}`)
              .then(r => r.json())
              .then(bal => {
                if (bal.balance !== undefined) setBinance(prev => ({ ...prev, balance: bal.balance }));
              });
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

  const screens = {
    signals: <SignalsScreen binance={binance} onOpenSettings={() => setSettingsOpen(true)} />,
    dashboard: <Dashboard binance={binance} email={CURRENT_USER.email} />,
    trades: <TradesScreen />,
    history: <HistoryScreen />,
    profile: <ProfileScreen user={CURRENT_USER} binance={binance} onOpenSettings={() => setSettingsOpen(true)} />,
    backtest: <Backtest />,
    admin: isAdmin ? <AdminScreen /> : <SignalsScreen binance={binance} onOpenSettings={() => setSettingsOpen(true)} />,
  };

  return (
    <div style={{ fontFamily: sysFont, color: TEXT, height: "100vh", width: "100%", background: DARK_BG, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      <style>{`@keyframes tgBounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-4px);opacity:1} } * { box-sizing: border-box; } ::-webkit-scrollbar { width: 0; height: 0; } html, body { margin:0; padding:0; }`}</style>
      <AppHeader onOpenSettings={() => setSettingsOpen(true)} binanceConnected={binance.connected} />
      {screens[tab]}
      <BottomNav tab={tab} setTab={setTab} isAdmin={isAdmin} />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} binance={binance} onBinanceConnect={handleBinanceConnect} email={CURRENT_USER.email} />
    </div>
  );
}
