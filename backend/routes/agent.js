// ... (same as before, but add a check at the start)
router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Check if Binance is connected before starting
  try {
    await getBinanceClient(email);
  } catch (err) {
    return res.status(400).json({ error: 'Binance not connected – please connect in Settings' });
  }

  if (agentState.running) {
    return res.json({ status: 'already running' });
  }

  agentState.tradesToday = 0;
  agentState.dailyLoss = 0;
  agentState.intervalId = setInterval(() => agentLoop(email), 60000);
  agentState.running = true;

  res.json({ status: 'started' });
});
