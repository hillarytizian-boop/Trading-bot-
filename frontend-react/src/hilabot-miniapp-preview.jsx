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
      const res = await fetch('/api/binance/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: localEmail, apiKey, secretKey: apiSecret }) });
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
    if (open && localEmail) {
      fetch(`/api/binance/status?email=${encodeURIComponent(localEmail)}`)
        .then(r => r.json())
        .then(data => {
          if (data.connected) {
            setStatus('connected');
            fetch(`/api/binance/balance?email=${encodeURIComponent(localEmail)}`)
              .then(r => r.json())
              .then(bal => { if (bal.balance !== undefined) setBalance(bal.balance); });
          }
        })
        .catch(() => {});
    }
  }, [open, localEmail]);

  const handleSymbolSelect = async (symbol) => {
    onSymbolChange(symbol);
    try {
      await fetch("/api/user/settings", { method: "POST", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: localEmail || email, settings: { market: symbol.replace("/", "") } }) });
    } catch (err) { console.error("Failed to save symbol", err); }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity 0.25s", zIndex: 200 }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "88vh", background: DARK_BG, borderRadius: "20px 20px 0 0", transform: open ? "translateY(0)" : "translateY(100%)", transition: "transform 0.3s cubic-bezier(.2,.8,.2,1)", zIndex: 201, display: "flex", flexDirection: "column", boxShadow: "0 -10px 40px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}><div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} /></div>
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
            <TgListRow icon="📄" label="Paper Trading" sub="Simulate trades with virtual money" right={<TgSwitch checked={paperMode} onChange={() => onPaperToggle(!paperMode)} />} />
            <TgListRow icon="🛑" label="Auto stop loss" sub="Halt at daily loss" right={<TgSwitch checked={autoStop} onChange={setAutoStop} />} last />
          </div>
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>MARKET SELECTION</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 8px", borderRadius: 14, padding: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT", "ADA/USDT"].map((m) => (
              <div key={m} onClick={() => handleSymbolSelect(m)} style={{ padding: "6px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: selectedSymbol === m ? `1px solid ${TG_BLUE}` : `1px solid ${DARK_BORDER}`, background: selectedSymbol === m ? `${TG_BLUE}1f` : "rgba(255,255,255,0.02)", color: selectedSymbol === m ? TG_BLUE : MUTED, fontWeight: 600 }}>
                {m}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── SignalsScreen ──────────────────────────────────────────────
function SignalsScreen({ binance, onOpenSettings, selectedSymbol = "BTC/USDT", paperMode }) {
  // ─── State ──────────────────────────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [price, setPrice] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [signalHistory, setSignalHistory] = useState([]);
  const [tickCount, setTickCount] = useState(0);
  const [paperBalance, setPaperBalance] = useState(null);
  const [currentSignal, setCurrentSignal] = useState({ signal: 'HOLD', confidence: 0, reason: 'Waiting...' });
  const [analyzing, setAnalyzing] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const scrollRef = useRef(null);
  const engineSignalInterval = useRef(null);
  const autoAnalyzeInterval = useRef(null);
  const wsRef = useRef(null);
  const lastUpdate = useRef(0);

  // ─── WebSocket ──────────────────────────────────────────────────
  useEffect(() => {
    const sym = selectedSymbol.toLowerCase().replace('/', '').replace('usdt', 'usdt@trade');
    const wsUrl = `wss://stream.binance.com:9443/ws/${sym}`;
    wsRef.current = new WebSocket(wsUrl);
    wsRef.current.onmessage = (e) => {
    // Poll engine signal every 5 seconds
    if (!engineSignalInterval.current) {
      engineSignalInterval.current = setInterval(() => {
        fetch("/api/signal/latest")
          .then(r => r.json())
          .then(data => {
            if (data.signal && data.signal !== "HOLD") {
              setCurrentSignal(data);
              setMessages(prev => {
                const newMsg = {
                  type: "bot",
                  time: new Date().toLocaleTimeString(),
                  text: `🤖 ${data.signal} (${data.confidence}%) - $${price?.toFixed(2)}`,
                  signal: { signal: data.signal, confidence: data.confidence, risk: "LOW" },
                  reason: data.reason,
                };
                const updated = [...prev, newMsg];
                return updated.slice(-20);
              });
            }
          })
          .catch(() => {});
      }, 5000);
    }
    // Start auto-analysis every 5 seconds
    if (!autoAnalyzeInterval.current) {
      autoAnalyzeInterval.current = setInterval(() => {
        if (price && priceHistory.length > 10) {
          runAnalysis(price);
        }
      }, 5000);
    }
      const data = JSON.parse(e.data);
      if (data.p) {
        const now = Date.now();
        if (now - lastUpdate.current < 200) return; // throttle
        lastUpdate.current = now;
        const newPrice = parseFloat(data.p);
        setPrice(newPrice);
        setTickCount(prev => prev + 1);
        setPriceHistory(prev => {
          const u = [...prev, newPrice];
          return u.slice(-50);
        });
        // Auto-analyse if agent is running or always? We'll do it always but cap frequency.
        if (priceHistory.length > 10) {
          runAnalysis(newPrice);
        }
      }
    };
    return () => wsRef.current?.close();
  }, [selectedSymbol]);

  // ─── Agent status ──────────────────────────────────────────────
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

  // ─── Scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // ─── Indicators ─────────────────────────────────────────────────
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

  // ─── Analysis (always returns a signal) ──────────────────────
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
      // Ensure we always have signal and confidence
      const signal = data.signal || 'HOLD';
      const confidence = data.confidence || 0;
      const reason = data.reason || 'No reason';
      setCurrentSignal({ signal, confidence, reason });
      const emoji = signal === 'BUY' ? '🚀' : signal === 'SELL' ? '🔻' : '⏳';
      const confEmoji = confidence >= 80 ? '🔥' : confidence >= 60 ? '💡' : '📊';
      setMessages(prev => {
        const newMsg = {
          type: 'bot',
          time: new Date().toLocaleTimeString(),
          text: `${emoji} ${signal} ${confEmoji} ${confidence}% · $${currentPrice.toFixed(2)}`,
          signal: { signal, confidence, risk: 'LOW' },
          reason: reason,
        };
        const updated = [...prev, newMsg];
        return updated.slice(-20); // keep only last 20 messages
      });
      setSignalHistory(prev => {
        const u = [...prev, { signal, confidence, price: currentPrice, time: new Date().toISOString() }];
        return u.slice(-30);
      });
    } catch (e) {
      console.error('Analysis error:', e);
      // Show a fallback signal
      setMessages(prev => {
        const newMsg = {
          type: 'bot',
          time: new Date().toLocaleTimeString(),
          text: `⏳ HOLD 📊 0% · $${currentPrice.toFixed(2)}`,
          signal: { signal: 'HOLD', confidence: 0, risk: 'LOW' },
          reason: 'AI unavailable',
        };
        const updated = [...prev, newMsg];
        return updated.slice(-20);
      });
    }
    setAnalyzing(false);
  };

  // ─── Manual analysis ────────────────────────────────────────────
  const runManual = async () => {
    if (!price) {
      setMessages(prev => {
        const newMsg = { type: 'bot', time: 'now', text: '⏳ Waiting for price...', signal: { signal: 'HOLD', confidence: 0, risk: 'LOW' }, reason: 'No price' };
        const updated = [...prev, newMsg];
        return updated.slice(-20);
      });
      return;
    }
    await runAnalysis(price);
  };

  const startAgent = async () => {
    try {
      const res = await fetch('/api/agent/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CURRENT_USER.email }) });
      const data = await res.json();
      setMessages(prev => {
        const newMsg = { type: 'bot', time: 'now', text: `🤖 Agent ${data.status}`, signal: { signal: 'HOLD', confidence: 0, risk: 'LOW' }, reason: '' };
        const updated = [...prev, newMsg];
        return updated.slice(-20);
      });
    } catch (e) {
      setMessages(prev => {
        const newMsg = { type: 'bot', time: 'now', text: '❌ Failed to start agent.', signal: { signal: 'HOLD', confidence: 0, risk: 'LOW' }, reason: '' };
        const updated = [...prev, newMsg];
        return updated.slice(-20);
      });
    }
  };
  const stopAgent = async () => {
    try {
      const res = await fetch('/api/agent/stop', { method: 'POST' });
      const data = await res.json();
      setMessages(prev => {
        const newMsg = { type: 'bot', time: 'now', text: `⏹ Agent ${data.status}`, signal: { signal: 'HOLD', confidence: 0, risk: 'LOW' }, reason: '' };
        const updated = [...prev, newMsg];
        return updated.slice(-20);
      });
    } catch (e) {
      setMessages(prev => {
        const newMsg = { type: 'bot', time: 'now', text: '❌ Failed to stop agent.', signal: { signal: 'HOLD', confidence: 0, risk: 'LOW' }, reason: '' };
        const updated = [...prev, newMsg];
        return updated.slice(-20);
      });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: DARK_BG }}>
      <div style={{ flexShrink: 0, padding: "10px 14px", display: "flex", gap: 8, overflowX: "auto" }}>
        <StatChip label="Bot" value={agentRunning ? "Running" : "Stopped"} color={agentRunning ? GREEN : MUTED} dot={agentRunning} />
        <StatChip label="Balance" value={binance.connected ? `$${binance.balance}` : "Not linked"} color={binance.connected ? TEXT : MUTED} />
        {paperMode && paperBalance !== null && <StatChip label="Paper Balance" value={`$${paperBalance.toFixed(2)}`} color={GOLD} />}
        <StatChip label="Ticks" value={tickCount} color={TG_BLUE} />
      </div>
      <div style={{ flexShrink: 0, margin: "0 14px 10px", background: DARK_PANEL, borderRadius: 14, padding: 12, height: 200 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: MUTED }}>AI Market Chart</span>
          <span style={{ fontSize: 11, color: MUTED }}>{price ? `$${price.toFixed(2)}` : "Loading..."}</span>
        </div>
        <Suspense fallback={<div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: MUTED }}>Loading chart...</div>}>
          <Chart priceHistory={priceHistory} signals={signalHistory} />
        </Suspense>
      </div>
      {!binance.connected && (
        <div onClick={onOpenSettings} style={{ flexShrink: 0, margin: "0 14px 10px", background: "rgba(240,180,41,0.1)", border: "1px solid rgba(240,180,41,0.3)", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: GOLD, cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
          <span>⚠️ Connect your Binance account to start live trading</span>
          <span>›</span>
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "6px 14px 14px" }}>
        <div style={{ textAlign: "center", margin: "8px 0 16px" }}>
          <span style={{ background: "rgba(255,255,255,0.06)", color: MUTED, fontSize: 11, padding: "4px 12px", borderRadius: 12 }}>
            📊 {currentSignal.signal} · {currentSignal.confidence}% · {tickCount} ticks
          </span>
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
            <span style={{ display: "inline-flex", gap: 4 }}><Dot d={0} /><Dot d={0.15} /><Dot d={0.3} /></span>
          </BotBubble>
        )}
      </div>
      <div style={{ flexShrink: 0, padding: "10px 12px", borderTop: `1px solid ${DARK_BORDER}`, background: DARK_PANEL, display: "flex", gap: 8 }}>
        <button onClick={runManual} style={pill(TG_BLUE)}>🧠 Analyze</button>
        <button onClick={startAgent} style={pill(GREEN)}>▶ Start</button>
        <button onClick={stopAgent} style={pill(GOLD)}>⏸ Pause</button>
        <button style={pill(RED)}>⏹ Stop</button>
      </div>
    </div>
  );
}

function StatChip({ label, value, color, dot }) {
  return (
    <div style={{ background: DARK_PANEL, borderRadius: 14, padding: "8px 14px", minWidth: 80, flexShrink: 0 }}>
      <p style={{ fontSize: 10.5, color: MUTED, display: "flex", alignItems: "center", gap: 5 }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN }} />}
        {label}
      </p>
      <p style={{ fontSize: 14.5, fontWeight: 700, color: color || TEXT, fontFamily: "monospace", marginTop: 2 }}>{value}</p>
    </div>
  );
}

// ─── Trades, History, Profile, Admin ──────────────────────────
function TradesScreen() { return <div style={{ padding: 16, color: MUTED }}>Trades (real data from Supabase)</div>; }
function HistoryScreen() { return <div style={{ padding: 16, color: MUTED }}>History (real data from Supabase)</div>; }
function ProfileScreen({ user, binance, onOpenSettings }) { return <div style={{ padding: 16, color: MUTED }}>Profile</div>; }
function AdminScreen() { return <div style={{ padding: 16, color: MUTED }}>Admin</div>; }

// ─── BottomNav ──────────────────────────────────────────────────
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

// ─── Root App ──────────────────────────────────────────────────
export default function HilaBotMiniApp() {
  const [tab, setTab] = useState("signals");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [binance, setBinance] = useState({ connected: false, balance: "0.00" });
  const [selectedSymbol, setSelectedSymbol] = useState("BTC/USDT");
  const [paperMode, setPaperMode] = useState(false);
  const isAdmin = CURRENT_USER.role === "admin";

  useEffect(() => {
    // Clear localStorage on load to prevent old data hanging
    try {
      localStorage.removeItem('hila_messages');
      localStorage.removeItem('hila_priceHistory');
      localStorage.removeItem('hila_signalHistory');
      localStorage.removeItem('hila_tickCount');
      localStorage.removeItem('hila_paperBalance');
    } catch (e) {}
    // Fetch settings
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
