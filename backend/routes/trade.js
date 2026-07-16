const router = require('express').Router();
const supabase = require('../db');
const { getAIAnalysis } = require('./ai.js');
const { v4: uuidv4 } = require('uuid');

// Auto-trade endpoint – uses AI only
router.post('/auto', async (req, res) => {
  const { email, symbol, price, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const market = symbol || 'BTCUSDT';
    const ai = await getAIAnalysis(email, market, price, closes);
    if (ai.signal === 'HOLD' || ai.confidence < 60) {
      return res.json({ signal: 'HOLD', confidence: ai.confidence, reason: ai.reason || 'Low confidence' });
    }

    // Check for open trade
    const existing = await supabase.from('trades').select('*').eq('user_email', email).eq('status', 'open').single();
    if (existing.data) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Trade already active' });
    }

    // Get balance (paper or real)
    const user = await supabase.from('users').select('paper_balance, binance_api_key, binance_secret_key').eq('email', email).single();
    let balance = user.data?.paper_balance || 1000;
    // For real Binance, you would fetch actual balance, but we keep paper for simplicity

    // Position sizing – max $0.50
    const tradeAmount = Math.min(balance * 0.01, 0.50);
    const quantity = tradeAmount / price;

    const slPercent = 2, tpPercent = 5;
    let stopLoss, takeProfit;
    if (ai.signal === 'BUY') {
      stopLoss = price * (1 - slPercent/100);
      takeProfit = price * (1 + tpPercent/100);
    } else {
      stopLoss = price * (1 + slPercent/100);
      takeProfit = price * (1 - tpPercent/100);
    }

    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: market,
      type: ai.signal,
      entry_price: price,
      quantity,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      status: 'open',
      opened_at: new Date().toISOString(),
      signal_confidence: ai.confidence,
      signal_reason: ai.reason,
      is_paper: true,
    }]);

    res.json({
      signal: ai.signal,
      confidence: ai.confidence,
      reason: ai.reason,
      trade: { id: tradeId, type: ai.signal, entryPrice: price, quantity, stopLoss, takeProfit },
    });
  } catch (error) {
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

module.exports = router;
