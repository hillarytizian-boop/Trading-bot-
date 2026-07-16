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
      this.reconnectTimer = null;
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.k) {
          const candle = msg.k;
          const close = parseFloat(candle.c);
          const high = parseFloat(candle.h);
          const low = parseFloat(candle.l);
          const volume = parseFloat(candle.v);

          // Only process if candle is closed
          if (!candle.x) return;

          this.closes.push(close);
          this.highs.push(high);
          this.lows.push(low);
          this.volumes.push(volume);

          // Keep last 100 candles
          if (this.closes.length > 100) {
            this.closes.shift();
            this.highs.shift();
            this.lows.shift();
            this.volumes.shift();
          }

          this.lastPrice = close;
          this.analyzeAndTrade();
        }
      } catch (e) {
        console.error('[Engine] Error parsing message:', e);
      }
    });

    this.ws.on('close', () => {
      console.log('[Engine] WebSocket closed, reconnecting in 5s...');
      this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 5000);
    });

    this.ws.on('error', (err) => {
      console.error('[Engine] WebSocket error:', err);
    });
  }

  // ─── Analyze and trade ────────────────────────────────────────
  async analyzeAndTrade() {
    if (this.closes.length < 30) return;

    // ─── Calculate indicators ──────────────────────────────────
    const closes = this.closes;
    const highs = this.highs;
    const lows = this.lows;
    const volumes = this.volumes;

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

    // ─── Compute score (less conservative) ─────────────────────
    let score = 0;
    if (lastRsi < 30) score += 2;
    else if (lastRsi > 70) score -= 2;
    else if (lastRsi < 45) score += 1;
    else if (lastRsi > 55) score -= 1;

    if (lastMacd.MACD > lastMacd.signal) score += 1.5;
    else if (lastMacd.MACD < lastMacd.signal) score -= 1.5;

    if (closes[closes.length-1] < lastBb.lower) score += 1.5;
    else if (closes[closes.length-1] > lastBb.upper) score -= 1.5;

    if (lastEma20 > lastEma50) score += 1;
    else score -= 1;

    // Volume confirmation
    if (lastVolume > avgVolume * 1.5) {
      if (score > 0) score += 0.5;
      else score -= 0.5;
    }

    // ─── Determine preliminary signal ──────────────────────────
    let preliminarySignal = 'HOLD';
    if (score >= 2) preliminarySignal = 'BUY';
    else if (score <= -2) preliminarySignal = 'SELL';

    // ─── NVIDIA AI confirmation ─────────────────────────────────
    let aiSignal = { signal: preliminarySignal, confidence: 50, reason: 'No AI' };
    if (preliminarySignal !== 'HOLD') {
      const prompt = `You are a professional crypto trader.
Price: $${closes[closes.length-1]}
RSI: ${lastRsi}
MACD: ${lastMacd.MACD.toFixed(4)}
EMA20: ${lastEma20}
EMA50: ${lastEma50}
ATR: ${lastAtr}
Bollinger: upper=${lastBb.upper}, lower=${lastBb.lower}

Provide a trading signal (BUY/SELL/HOLD) with confidence (0-100) and a brief reason.
Respond ONLY as JSON: {"signal":"BUY","confidence":85,"reason":"..."}`;

      try {
        const results = await Promise.allSettled(
          MODELS.map(async (model) => {
            const completion = await nvidiaClient.chat.completions.create({
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.7,
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
    }

    // ─── Final decision ─────────────────────────────────────────
    let finalSignal = 'HOLD';
    let confidence = 0;
    let reason = 'No clear signal';

    if (aiSignal.signal === 'BUY' && aiSignal.confidence >= 55) {
      finalSignal = 'BUY';
      confidence = aiSignal.confidence;
      reason = aiSignal.reason || 'AI BUY';
    } else if (aiSignal.signal === 'SELL' && aiSignal.confidence >= 55) {
      finalSignal = 'SELL';
      confidence = aiSignal.confidence;
      reason = aiSignal.reason || 'AI SELL';
    } else if (preliminarySignal !== 'HOLD' && Math.abs(score) >= 2.5) {
      finalSignal = preliminarySignal;
      confidence = 60 + Math.abs(score) * 5;
      reason = `Technical score ${score.toFixed(1)}`;
    }

    // ─── Store signal ───────────────────────────────────────────
    this.lastSignal = {
      signal: finalSignal,
      confidence: Math.min(Math.round(confidence), 100),
      reason: reason || 'No reason',
      price: this.lastPrice,
      timestamp: new Date().toISOString(),
    };

    // ─── Auto-trade ─────────────────────────────────────────────
    if (finalSignal !== 'HOLD' && confidence >= 55) {
      await this.executeTrade(finalSignal, confidence, reason);
    }

    console.log(`[Engine] Signal: ${finalSignal} (${confidence}%) - ${reason}`);
  }

  // ─── Execute trade ─────────────────────────────────────────────
  async executeTrade(signal, confidence, reason) {
    try {
      // Check for existing open trade
      const existing = await supabase
        .from('trades')
        .select('*')
        .eq('user_email', this.email)
        .eq('status', 'open')
        .single();

      if (existing.data) {
        // If we already have a trade, exit if opposite signal or SL/TP hit
        const trade = existing.data;
        const price = this.lastPrice;
        const entry = trade.entry_price;
        const sl = trade.stop_loss;
        const tp = trade.take_profit;
        let pnl = 0;
        let closed = false;

        // Check stop-loss / take-profit
        if (trade.type === 'BUY') {
          if (price <= sl) { pnl = (price - entry) * trade.quantity; closed = true; }
          else if (price >= tp) { pnl = (price - entry) * trade.quantity; closed = true; }
        } else {
          if (price >= sl) { pnl = (entry - price) * trade.quantity; closed = true; }
          else if (price <= tp) { pnl = (entry - price) * trade.quantity; closed = true; }
        }

        // Or if signal is opposite with high confidence
        if (!closed && ((signal === 'SELL' && trade.type === 'BUY') || (signal === 'BUY' && trade.type === 'SELL')) && confidence > 70) {
          const exitPrice = this.lastPrice;
          pnl = (trade.type === 'BUY') ? (exitPrice - entry) * trade.quantity : (entry - exitPrice) * trade.quantity;
          closed = true;
        }

        if (closed) {
          // Update balance (paper)
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
        return; // Trade still active
      }

      // ─── No open trade – enter ───────────────────────────────
      const user = await supabase.from('users').select('paper_balance').eq('email', this.email).single();
      const balance = user.data?.paper_balance || 1000;
      if (balance < 1) return;

      // Position sizing: 1% of balance, max $0.50
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

  // ─── Get latest signal ────────────────────────────────────────
  getLatestSignal() {
    return this.lastSignal;
  }

  stop() {
    this.isRunning = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    console.log('[Engine] Stopped');
  }
}

// ─── Singleton engine instance ──────────────────────────────────
let engineInstance = null;

function startEngine(email, symbol = 'BTCUSDT') {
  if (engineInstance) {
    engineInstance.stop();
  }
  engineInstance = new TradingEngine(email, symbol);
  engineInstance.start();
  return engineInstance;
}

function getEngine() {
  return engineInstance;
}

module.exports = { startEngine, getEngine };
