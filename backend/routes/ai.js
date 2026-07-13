const router = require('express').Router();
const { runFullSystem } = require('../agents');

router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const symbol = market.replace('/', '').replace('USDT', 'USDT');
    const result = await runFullSystem(email, symbol);

    // Extract final decision
    const decision = result.finalDecision || { signal: 'HOLD', confidence: 50, reason: 'No decision' };

    // Also include a summary of agents for debugging
    res.json({
      signal: decision.signal,
      confidence: decision.confidence,
      reason: decision.reason,
      breakdown: {
        regime: result.regime,
        sentiment: result.sentiment,
        research: result.research,
        strategy: result.strategy,
        volatility: result.volatility,
        performance: result.performance,
        reflection: result.reflection,
        // include only key items to avoid overload
      }
    });
  } catch (error) {
    console.error('Orchestrator error:', error);
    res.status(500).json({ error: 'Agent system error: ' + error.message });
  }
});

module.exports = router;
