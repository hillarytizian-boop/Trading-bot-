import { useState, useEffect, useRef } from "react";

/* ───────────────────────── Telegram Mini App design tokens ───────────────────────── */
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

/* Demo user — flip role to "admin" to see the admin tab appear */
const CURRENT_USER = { name: "Demo Trader", role: "user" }; // "user" | "admin"

/* ───────────────────────── Small shared bits ───────────────────────── */
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

/* ───────────────────────── Header (full width, gear on right) ───────────────────────── */
function AppHeader({ onOpenSettings, derivConnected }) {
  return (
    <div
      style={{
        height: 56,
        background: DARK_PANEL,
        borderBottom: `1px solid ${DARK_BORDER}`,
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {/* Left: logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: 90 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},${TG_BLUE_DEEP})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#fff", fontSize: 14 }}>H</div>
        {derivConnected && <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />}
      </div>

      {/* Center: title, absolutely centered regardless of side widths */}
      <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Hila Bot</span>
      </div>

      {/* Right: settings gear */}
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={onOpenSettings}
          aria-label="Settings"
          style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 17, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          ⚙️
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Settings Drawer (slides up, modal) ───────────────────────── */
function SettingsDrawer({ open, onClose, deriv, onDerivConnect }) {
  const [riskLevel, setRiskLevel] = useState("MEDIUM");
  const [maxDailyLoss, setMaxDailyLoss] = useState(100);
  const [maxTrades, setMaxTrades] = useState(50);
  const [autoCompound, setAutoCompound] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [autoStop, setAutoStop] = useState(true);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s",
          zIndex: 200,
        }}
      />
      {/* Drawer sheet */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "88vh",
          background: DARK_BG,
          borderRadius: "20px 20px 0 0",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.3s cubic-bezier(.2,.8,.2,1)",
          zIndex: 201,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* Grab handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
        </div>

        {/* Sheet header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px 12px", borderBottom: `1px solid ${DARK_BORDER}` }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Settings</span>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: TEXT, width: 30, height: 30, borderRadius: "50%", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, paddingBottom: 24 }}>
          {/* Deriv account */}
          <p style={{ padding: "14px 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>DERIV ACCOUNT</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 18px", borderRadius: 14, overflow: "hidden" }}>
            {deriv.connected ? (
              <>
                <TgListRow icon="✅" label="Connected" sub={deriv.loginid} right={<span style={{ fontSize: 11, color: GREEN, fontWeight: 700 }}>● LIVE</span>} />
                <TgListRow icon="💰" label="Balance" sub={deriv.currency} right={<span style={{ fontFamily: "monospace", fontWeight: 700 }}>{deriv.balance}</span>} />
                <TgListRow icon="🏷️" label="Account type" sub="Trading account" right={<span style={{ fontSize: 12, color: MUTED }}>{deriv.accountType}</span>} last />
              </>
            ) : (
              <div style={{ padding: 16, textAlign: "center" }}>
                <p style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>Connect your Deriv account to enable live trading.</p>
                <button onClick={onDerivConnect} style={{ ...pill(TG_BLUE), width: "100%", padding: "11px 0" }}>🔗 Connect with Deriv</button>
              </div>
            )}
          </div>

          {/* Risk level */}
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>RISK LEVEL</p>
          <div style={{ display: "flex", gap: 8, padding: "0 14px", marginBottom: 18 }}>
            {["LOW", "MEDIUM", "HIGH"].map((r) => (
              <div
                key={r}
                onClick={() => setRiskLevel(r)}
                style={{
                  flex: 1,
                  textAlign: "center",
                  padding: "10px 0",
                  borderRadius: 14,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: riskLevel === r ? `${TG_BLUE}22` : DARK_PANEL,
                  border: riskLevel === r ? `1px solid ${TG_BLUE}` : `1px solid ${DARK_BORDER}`,
                  color: riskLevel === r ? TG_BLUE : MUTED,
                }}
              >
                {r === "LOW" ? "🟢" : r === "MEDIUM" ? "🟡" : "🔴"} {r}
              </div>
            ))}
          </div>

          {/* Trade limits */}
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>TRADE LIMITS</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 18px", borderRadius: 14, padding: "4px 0" }}>
            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13.5 }}>Max daily loss</span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: RED }}>${maxDailyLoss}</span>
              </div>
              <input type="range" min={20} max={500} step={10} value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(+e.target.value)} style={{ width: "100%", accentColor: RED }} />
            </div>
            <div style={{ height: 1, background: DARK_BORDER }} />
            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13.5 }}>Max trades per day</span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: TG_BLUE }}>{maxTrades}</span>
              </div>
              <input type="range" min={5} max={200} step={5} value={maxTrades} onChange={(e) => setMaxTrades(+e.target.value)} style={{ width: "100%", accentColor: TG_BLUE }} />
            </div>
          </div>

          {/* Automation toggles */}
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>AUTOMATION</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 18px", borderRadius: 14, overflow: "hidden" }}>
            <TgListRow icon="🔄" label="Auto-compounding" sub="Reinvest profits automatically" right={<TgSwitch checked={autoCompound} onChange={setAutoCompound} />} />
            <TgListRow icon="🔔" label="Trade notifications" sub="Alert on every trade" right={<TgSwitch checked={notifications} onChange={setNotifications} />} />
            <TgListRow icon="🛑" label="Auto stop loss" sub="Halt bot at daily loss limit" right={<TgSwitch checked={autoStop} onChange={setAutoStop} />} last />
          </div>

          {/* Markets */}
          <p style={{ padding: "0 16px 6px", fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>MARKET SELECTION</p>
          <div style={{ background: DARK_PANEL, margin: "0 14px 8px", borderRadius: 14, padding: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["EUR/USD", "GBP/USD", "BTC/USD", "GOLD", "USD/JPY", "Volatility 75"].map((m, i) => (
              <MarketTag key={m} label={m} defaultSelected={i < 3} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── SIGNALS (main / chat-thread screen) ───────────────────────── */
function SignalsScreen({ deriv, onOpenSettings }) {
  const [messages, setMessages] = useState([
    { type: "bot", time: "14:48", text: "Good morning! Bot started and scanning 3 markets." },
    { type: "bot", time: "14:49", text: "Analysis complete on EUR/USD.", signal: { signal: "BUY", confidence: 92, risk: "LOW" }, reason: "Bullish divergence on RSI with EMA9/21 crossover. MACD turning positive." },
    { type: "user", time: "14:50", text: "Go ahead and place the trade." },
    { type: "bot", time: "14:50", text: "✅ Trade executed — BUY EUR/USD at 1.0821, $10 stake, SL 5% / TP 10%." },
    { type: "bot", time: "15:03", text: "🎯 Trade closed — EUR/USD WIN +$42.50 (exit 1.0843)." },
  ]);
  const [analyzing, setAnalyzing] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, analyzing]);

  const runAnalysis = () => {
    setAnalyzing(true);
    setTimeout(() => {
      const sigs = ["BUY", "SELL", "HOLD"];
      const risks = ["LOW", "MEDIUM", "HIGH"];
      const reasons = [
        "RSI recovering from oversold. EMA9 crossing above EMA21. Momentum building.",
        "RSI overbought at 74. Bearish MACD crossover detected. Reversal likely.",
        "Tight consolidation range. Volume declining. No clear directional edge.",
        "Golden cross confirmed on EMA50. Strong volume backing the breakout.",
      ];
      const signal = sigs[Math.floor(Math.random() * 3)];
      const confidence = Math.floor(74 + Math.random() * 22);
      const risk = risks[Math.floor(Math.random() * 3)];
      const reason = reasons[Math.floor(Math.random() * reasons.length)];
      setMessages((m) => [...m, { type: "bot", time: "now", text: "Fresh analysis on EUR/USD.", signal: { signal, confidence, risk }, reason }]);
      setAnalyzing(false);
    }, 1300);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: DARK_BG, backgroundImage: "radial-gradient(circle at 30% 0%, rgba(42,171,238,0.06), transparent 45%)" }}>
      {/* Status strip: bot + deriv connection at a glance */}
      <div style={{ display: "flex", gap: 8, padding: "10px 14px", overflowX: "auto" }}>
        <StatChip label="Bot" value="Active" color={GREEN} dot />
        <StatChip label="Balance" value={deriv.connected ? `$${deriv.balance}` : "Not linked"} color={deriv.connected ? TEXT : MUTED} />
        <StatChip label="Win rate" value="78.4%" color={TEXT} />
        <StatChip label="Today" value="+$124.00" color={GOLD} />
      </div>

      {!deriv.connected && (
        <div onClick={onOpenSettings} style={{ margin: "0 14px 10px", background: "rgba(240,180,41,0.1)", border: "1px solid rgba(240,180,41,0.3)", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: GOLD, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>⚠️ Connect your Deriv account to start live trading</span>
          <span>›</span>
        </div>
      )}

      {/* Message thread */}
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
                  <SignalChip {...m.signal} />
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

      {/* Action bar */}
      <div style={{ padding: "10px 12px", borderTop: `1px solid ${DARK_BORDER}`, background: DARK_PANEL, display: "flex", gap: 8, overflowX: "auto" }}>
        <button onClick={runAnalysis} style={pill(TG_BLUE)}>🧠 Analyze</button>
        <button style={pill(GREEN)}>▶ Start</button>
        <button style={pill(GOLD)}>⏸ Pause</button>
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

/* ───────────────────────── TRADES (active positions) ───────────────────────── */
function TradesScreen() {
  const active = [
    { pair: "EUR/USD", type: "BUY", entry: "1.0818", current: "1.0831", pnl: 13.2, conf: 95 },
    { pair: "GOLD", type: "SELL", entry: "2,341.50", current: "2,338.10", pnl: 8.4, conf: 81 },
  ];
  return (
    <div style={{ flex: 1, overflowY: "auto", background: DARK_BG, padding: "14px" }}>
      <p style={{ fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 10 }}>ACTIVE TRADES ({active.length})</p>
      {active.map((t, i) => (
        <div key={i} style={{ background: DARK_PANEL, borderRadius: 16, padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{t.pair}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 14, color: t.type === "BUY" ? GREEN : RED, background: t.type === "BUY" ? "rgba(79,206,93,0.15)" : "rgba(255,94,94,0.15)" }}>{t.type}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 10 }}>
            <div>
              <p style={{ color: MUTED, fontSize: 11 }}>Entry</p>
              <p style={{ fontFamily: "monospace" }}>{t.entry}</p>
            </div>
            <div>
              <p style={{ color: MUTED, fontSize: 11 }}>Current</p>
              <p style={{ fontFamily: "monospace" }}>{t.current}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ color: MUTED, fontSize: 11 }}>P&L</p>
              <p style={{ fontFamily: "monospace", fontWeight: 700, color: GREEN }}>+${t.pnl}</p>
            </div>
          </div>
          <SignalChip signal={t.type} confidence={t.conf} risk="LOW" />
        </div>
      ))}
      <div style={{ textAlign: "center", padding: "20px 0", color: MUTED, fontSize: 12.5 }}>Bot is scanning for new opportunities…</div>
    </div>
  );
}

/* ───────────────────────── HISTORY ───────────────────────── */
function HistoryScreen() {
  const trades = Array.from({ length: 10 }, (_, i) => ({
    id: 10 - i,
    pair: ["EUR/USD", "GBP/USD", "BTC/USD", "GOLD", "US30"][i % 5],
    type: i % 3 === 0 ? "SELL" : "BUY",
    pnl: i % 4 === 2 ? -(Math.random() * 30 + 5).toFixed(2) : (Math.random() * 60 + 5).toFixed(2),
    conf: Math.floor(72 + Math.random() * 25),
    time: `${13 - i}:0${i}`,
    result: i % 4 === 2 ? "LOSS" : "WIN",
  }));

  return (
    <div style={{ flex: 1, overflowY: "auto", background: DARK_BG }}>
      <div style={{ display: "flex", gap: 10, padding: "14px", overflowX: "auto" }}>
        <StatChip label="Total" value="247" color={TEXT} />
        <StatChip label="Win rate" value="78.5%" color={GREEN} />
        <StatChip label="Total P&L" value="+$842.50" color={GOLD} />
      </div>
      <div style={{ padding: "0 14px 14px" }}>
        {trades.map((t) => (
          <BotBubble key={t.id} time={t.time}>
            <strong>{t.type}</strong> {t.pair} — {t.result === "WIN" ? "🟢" : "🔴"} {t.result}
            <SignalChip signal={t.type} confidence={t.conf} risk={t.result === "WIN" ? "LOW" : "HIGH"} />
            <p style={{ marginTop: 6, fontFamily: "monospace", fontWeight: 700, color: parseFloat(t.pnl) >= 0 ? GREEN : RED }}>
              {parseFloat(t.pnl) >= 0 ? "+" : "-"}${Math.abs(t.pnl)}
            </p>
          </BotBubble>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── PROFILE ───────────────────────── */
function ProfileScreen({ user, deriv, onOpenSettings }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: DARK_BG, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: `linear-gradient(135deg,${TG_BLUE},${TG_BLUE_DEEP})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "#fff" }}>
          {user.name[0]}
        </div>
        <div>
          <p style={{ fontSize: 17, fontWeight: 700 }}>{user.name}</p>
          <p style={{ fontSize: 12.5, color: MUTED }}>{user.role === "admin" ? "Administrator" : "Trader"} · Pro Plan</p>
        </div>
      </div>

      <p style={{ fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 8 }}>ACCOUNT</p>
      <div style={{ background: DARK_PANEL, borderRadius: 14, overflow: "hidden", marginBottom: 18 }}>
        <TgListRow icon="🔗" label="Deriv account" sub={deriv.connected ? deriv.loginid : "Not connected"} right={<Chevron />} onClick={onOpenSettings} />
        <TgListRow icon="💳" label="Billing & subscription" sub="Pro · $79/mo" right={<Chevron />} />
        <TgListRow icon="🔒" label="Security" sub="Password, 2FA" right={<Chevron />} last />
      </div>

      <p style={{ fontSize: 12, color: MUTED, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 8 }}>STATS</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
        <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 14 }}>
          <p style={{ fontSize: 11, color: MUTED }}>Total trades</p>
          <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace" }}>247</p>
        </div>
        <div style={{ background: DARK_PANEL, borderRadius: 14, padding: 14 }}>
          <p style={{ fontSize: 11, color: MUTED }}>Win rate</p>
          <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: GREEN }}>78.5%</p>
        </div>
      </div>

      <button onClick={onOpenSettings} style={{ ...pill(TG_BLUE), width: "100%", padding: "12px 0", marginBottom: 10 }}>⚙️ Open Settings</button>
      <button style={{ ...pill(RED), width: "100%", padding: "12px 0" }}>🚪 Sign Out</button>
    </div>
  );
}

/* ───────────────────────── ADMIN (only rendered for admins) ───────────────────────── */
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
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{u.name}</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 9, background: "rgba(240,180,41,0.15)", color: GOLD, textTransform: "uppercase" }}>{u.plan}</span>
            </div>
            <p style={{ fontSize: 11.5, color: u.status === "active" ? GREEN : MUTED }}>{u.status === "active" ? "● online" : "○ offline"}</p>
          </div>
          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5, color: parseFloat(u.pnl) >= 0 ? GREEN : RED }}>{parseFloat(u.pnl) >= 0 ? "+" : "-"}${Math.abs(u.pnl)}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Bottom nav (Telegram Mini App tab bar) ───────────────────────── */
function BottomNav({ tab, setTab, isAdmin }) {
  const tabs = [
    { id: "signals", icon: "💬", label: "Signals" },
    { id: "trades", icon: "📈", label: "Trades" },
    { id: "history", icon: "📋", label: "History" },
    { id: "profile", icon: "👤", label: "Profile" },
  ];
  if (isAdmin) tabs.push({ id: "admin", icon: "🛡️", label: "Admin" });

  return (
    <div style={{ display: "flex", background: DARK_PANEL, borderTop: `1px solid ${DARK_BORDER}`, flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            flex: 1,
            background: "none",
            border: "none",
            padding: "8px 0 6px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            cursor: "pointer",
            color: tab === t.id ? TG_BLUE : MUTED,
          }}
        >
          <span style={{ fontSize: 19, lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: 10.5, fontWeight: tab === t.id ? 700 : 500 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── ROOT APP ───────────────────────── */
export default function HilaBotMiniApp() {
  const [tab, setTab] = useState("signals");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deriv, setDeriv] = useState({ connected: false, balance: "0.00", currency: "USD", accountType: "Demo", loginid: "" });
  const isAdmin = CURRENT_USER.role === "admin";

  // If a non-admin somehow lands on "admin" tab (e.g. stale state), bounce back to signals.
  useEffect(() => {
    if (tab === "admin" && !isAdmin) setTab("signals");
  }, [tab, isAdmin]);

  const connectDeriv = () => {
    // Simulated OAuth handshake — in production this redirects to Deriv's OAuth URL
    // and the backend exchanges the returned token, storing it encrypted server-side.
    setTimeout(() => {
      setDeriv({ connected: true, balance: "10,042.30", currency: "USD", accountType: "Real", loginid: "CR8294013" });
    }, 600);
  };

  const screens = {
    signals: <SignalsScreen deriv={deriv} onOpenSettings={() => setSettingsOpen(true)} />,
    trades: <TradesScreen />,
    history: <HistoryScreen />,
    profile: <ProfileScreen user={CURRENT_USER} deriv={deriv} onOpenSettings={() => setSettingsOpen(true)} />,
    admin: isAdmin ? <AdminScreen /> : <SignalsScreen deriv={deriv} onOpenSettings={() => setSettingsOpen(true)} />,
  };

  return (
    <div
      style={{
        fontFamily: sysFont,
        color: TEXT,
        height: "100vh",
        width: "100%",
        background: DARK_BG,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <style>{`
        @keyframes tgBounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-4px);opacity:1} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 0; height: 0; }
        html, body { margin:0; padding:0; }
      `}</style>

      <AppHeader onOpenSettings={() => setSettingsOpen(true)} derivConnected={deriv.connected} />

      {screens[tab]}

      <BottomNav tab={tab} setTab={setTab} isAdmin={isAdmin} />

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} deriv={deriv} onDerivConnect={connectDeriv} />
    </div>
  );
}
