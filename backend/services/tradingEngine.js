const WebSocket = require('ws');
const technical = require('technicalindicators');
const { OpenAI } = require('openai');
const supabase = require('../db');
const { v4: uuidv4 } = require('uuid');

// ─── NVIDIA AI client ──────────────────────────────────────────
const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODELS = ['deepseek-ai/deepseek-v4-pro', 'z-ai/glm-5.2'];

// ─── Engine state ──────────────────────────────────────────────
class TradingEngine {
  constructor(email, symbol = 'BTCUSDT') {
    this.email = email;
    this.symbol = symbol;
    this.closes = [];
    this.highs = [];
    this.lows = [];
    this.volumes = [];
    this.lastSignal = { signal: 'HOLD', confidence: 0, reason: 'Initializing' };
    this.lastPrice = null;
    this.isRunning = false;
    this.ws = null;
    this.reconnectTimer = null;
    this.activeTradeId = null;
    this.paperBalance = 1000;
    this.lastAnalysisTime = 0;
  }

  // ─── Connect to Binance WebSocket ────────────────────────────
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connectWebSocket();
    console.log(`[Engine] Started for ${this.email} on ${this.symbol}`);
  }

  connectWebSocket() {
    const stream = this.symbol.toLowerCase().replace('usdt', 'usdt@kline_1m');
    const wsUrl = `wss://stream.binance.com:9443/ws/${stream}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log(`[Engine] WebSocket connected for ${this.symbol}`);
    });

    this.ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.k) {
          const candle = msg.k;
          const close = parseFloat(candle.c);
          const high = parseFloat(candle.h);
          const low = parseFloat(candle.l);
          const volume = parseFloat(candle.v);

          // Only process closed candles
          if (!candle.x) return;

          this.closes.push(close);
          this.highs.push(high);
          this.lows.push(low);
          this.volumes.push(volume);

          if (this.closes.length > 100) {
            this.closes.shift();
            this.highs.shift();
            this.lows.shift();
            this.volumes.shift();
          }

          this.lastPrice = close;
          await this.analyzeAndTrade();
        }
      } catch (e) {
        console.error('[Engine] Error parsing message:', e);
      }
    });

    this.ws.on('close', () => {
      console.log('[Engine] WebSocket closed, reconnecting in 5s...');
      setTimeout(() => this.connectWebSocket(), 5000);
    });

    this.ws.on('error', (err) => {
      console.error('[Engine] WebSocket error:', err);
    });
  }

  // ─── Analyze and trade ────────────────────────────────────────
  async analyzeAndTrade() {
    if (this.closes.length < 30) return;

    const closes = this.closes;
    const highs = this.highs;
    const lows = this.lows;
    const volumes = this.volumes;

    // ─── Calculate indicators ──────────────────────────────────
    const rsi = technical.RSI.calculate({ values: closes, period: 14 });
    const macd = technical.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
    });
    const ema20 = technical.EMA.calculate({ values: closes, period: 20 });
    const ema50 = technical.EMA.calculate({ values: closes, period: 50 });
    const bb = technical.BollingerBands.calculate({
      values: closes,
      period: 20,
      stdDev: 2,
    });
    const atr = technical.ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });

    const lastRsi = rsi[rsi.length-1] || 50;
    const lastMacd = macd[macd.length-1] || { MACD: 0, signal: 0 };
    const lastEma20 = ema20[ema20.length-1] || closes[closes.length-1];
    const lastEma50 = ema50[ema50.length-1] || closes[closes.length-1];
    const lastBb = bb[bb.length-1] || { upper: closes[closes.length-1] * 1.02, lower: closes[closes.length-1] * 0.98 };
    const lastAtr = atr[atr.length-1] || (closes[closes.length-1] * 0.02);
    const lastVolume = volumes[volumes.length-1] || 0;
    const avgVolume = volumes.slice(-20).reduce((a,b) => a+b, 0) / (volumes.length || 1);

    // ─── Build AI prompt ──────────────────────────────────────────
    const prompt = `You are a professional cryptocurrency trader.

Analyze the following market data for BTC/USDT:

Price: $${closes[closes.length-1]}
RSI: ${lastRsi.toFixed(1)}
MACD: ${lastMacd.MACD.toFixed(4)}
EMA20: ${lastEma20.toFixed(2)}
EMA50: ${lastEma50.toFixed(2)}
ATR: ${lastAtr.toFixed(2)}
Bollinger Upper: ${lastBb.upper.toFixed(2)}
Bollinger Lower: ${lastBb.lower.toFixed(2)}
Volume: ${lastVolume.toFixed(0)} (avg: ${avgVolume.toFixed(0)})

Respond ONLY as JSON:
{
  "signal": "BUY",
  "confidence": 84,
  "reason": "..."
}

Never return HOLD unless there is genuinely no trading edge.`;

    // ─── Get NVIDIA AI signal ──────────────────────────────────
    let aiSignal = { signal: 'HOLD', confidence: 0, reason: 'AI unavailable' };
    try {
      const results = await Promise.allSettled(
        MODELS.map(async (model) => {
          const completion = await nvidiaClient.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 200,
            stream: false,
          });
          const content = completion.choices[0].message.content;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.signal && parsed.confidence !== undefined) {
              return { model, success: true, data: parsed };
            }
          }
          return { model, success: false };
        })
      );
      const successful = results
        .filter(r => r.status === 'fulfilled' && r.value.success)
        .map(r => r.value.data);
      if (successful.length > 0) {
        const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
        successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
        const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
        const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);
        aiSignal = {
          signal: finalSignal,
          confidence: avgConfidence,
          reason: successful.map(d => d.reason).join(' '),
        };
      }
    } catch (e) {
      console.error('[Engine] AI error:', e);
    }

    // ─── Store signal ───────────────────────────────────────────
    this.lastSignal = {
      signal: aiSignal.signal,
      confidence: aiSignal.confidence,
      reason: aiSignal.reason || 'No reason',
      price: this.lastPrice,
      timestamp: new Date().toISOString(),
    };

    // ─── Auto-trade ─────────────────────────────────────────────
    if (aiSignal.signal !== 'HOLD' && aiSignal.confidence >= 55) {
      await this.executeTrade(aiSignal.signal, aiSignal.confidence, aiSignal.reason);
    }

    console.log(`[Engine] Signal: ${aiSignal.signal} (${aiSignal.confidence}%) - ${aiSignal.reason?.slice(0, 50)}...`);
  }

  // ─── Execute trade ─────────────────────────────────────────────
  async executeTrade(signal, confidence, reason) {
    try {
      // Check existing open trade
      const existing = await supabase
        .from('trades')
        .select('*')
        .eq('user_email', this.email)
        .eq('status', 'open')
        .single();

      if (existing.data) {
        const trade = existing.data;
        const price = this.lastPrice;
        const entry = trade.entry_price;
        const sl = trade.stop_loss;
        const tp = trade.take_profit;
        let pnl = 0;
        let closed = false;

        if (trade.type === 'BUY') {
          if (price <= sl) { pnl = (price - entry) * trade.quantity; closed = true; }
          else if (price >= tp) { pnl = (price - entry) * trade.quantity; closed = true; }
        } else {
          if (price >= sl) { pnl = (entry - price) * trade.quantity; closed = true; }
          else if (price <= tp) { pnl = (entry - price) * trade.quantity; closed = true; }
        }

        if (!closed && ((signal === 'SELL' && trade.type === 'BUY') || (signal === 'BUY' && trade.type === 'SELL')) && confidence > 70) {
          const exitPrice = this.lastPrice;
          pnl = (trade.type === 'BUY') ? (exitPrice - entry) * trade.quantity : (entry - exitPrice) * trade.quantity;
          closed = true;
        }

        if (closed) {
          const user = await supabase.from('users').select('paper_balance').eq('email', this.email).single();
          const balance = user.data?.paper_balance || 1000;
          const newBalance = balance + pnl;
          await supabase.from('users').update({ paper_balance: newBalance }).eq('email', this.email);

          await supabase.from('trades').update({
            exit_price: this.lastPrice,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_reason: pnl > 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
          }).eq('id', trade.id);

          this.activeTradeId = null;
          console.log(`[Engine] Trade closed: ${pnl > 0 ? 'Profit' : 'Loss'} $${pnl.toFixed(2)}`);
          return;
        }
        return;
      }

      // ─── Enter new trade ─────────────────────────────────────
      const user = await supabase.from('users').select('paper_balance').eq('email', this.email).single();
      const balance = user.data?.paper_balance || 1000;
      if (balance < 1) return;

      const tradeAmount = Math.min(balance * 0.01, 0.50);
      const quantity = tradeAmount / this.lastPrice;

      const slPercent = 2;
      const tpPercent = 5;
      let stopLoss, takeProfit;
      if (signal === 'BUY') {
        stopLoss = this.lastPrice * (1 - slPercent / 100);
        takeProfit = this.lastPrice * (1 + tpPercent / 100);
      } else {
        stopLoss = this.lastPrice * (1 + slPercent / 100);
        takeProfit = this.lastPrice * (1 - tpPercent / 100);
      }

      const tradeId = uuidv4();
      await supabase.from('trades').insert([{
        id: tradeId,
        user_email: this.email,
        symbol: this.symbol,
        type: signal,
        entry_price: this.lastPrice,
        quantity: quantity,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        status: 'open',
        opened_at: new Date().toISOString(),
        signal_confidence: confidence,
        signal_reason: reason,
        is_paper: true,
      }]);

      this.activeTradeId = tradeId;
      console.log(`[Engine] ENTERED ${signal} at $${this.lastPrice} (amount: $${tradeAmount.toFixed(2)})`);

    } catch (err) {
      console.error('[Engine] Trade error:', err);
    }
  }

  getLatestSignal() { return this.lastSignal; }

  stop() {
    this.isRunning = false;
    if (this.ws) { this.ws.close(); this.ws = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    console.log('[Engine] Stopped');
  }
}

let engineInstance = null;

function startEngine(email, symbol = 'BTCUSDT') {
  if (engineInstance) { engineInstance.stop(); }
  engineInstance = new TradingEngine(email, symbol);
  engineInstance.start();
  return engineInstance;
}

function getEngine() { return engineInstance; }

module.exports = { startEngine, getEngine };
