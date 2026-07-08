const router = require('express').Router();
const OpenAI = require('openai');

const client = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Only the two best models
const MODELS = [
  'deepseek-ai/deepseek-v4-pro',
  'z-ai/glm-5.2',
];

async function queryModel(model, prompt) {
  const params = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    top_p: 0.95,
    max_tokens: 256,
    stream: false,
  };
  try {
    const completion = await client.chat.completions.create(params);
    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal && parsed.confidence !== undefined && parsed.reason) {
        return { model, success: true, data: parsed };
      }
    }
    // fallback
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    return {
      model,
      success: true,
      data: {
        signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
        confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
        reason: content.slice(0, 200),
      }
    };
  } catch (error) {
    console.error(`Model ${model} failed:`, error.message);
    return { model, success: false, error: error.message };
  }
}

router.post('/analyze', async (req, res) => {
  const { market, price, indicators } = req.body;
  if (!price) return res.status(400).json({ error: 'Price required' });

  const prompt = `You are a crypto analyst. BTC/USDT price ${price}, RSI ${indicators?.rsi || 'N/A'}, EMA ${indicators?.ema || 'N/A'}, MACD ${indicators?.macd || 'N/A'}. Signal (BUY/SELL/HOLD) with confidence 0-100 and reason (max 20 words). Respond ONLY JSON: {"signal":"BUY","confidence":85,"reason":"..."}`;

  try {
    const results = await Promise.allSettled(MODELS.map(m => queryModel(m, prompt)));
    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value.data);

    if (successful.length === 0) {
      return res.status(500).json({ error: 'All models failed' });
    }

    // Majority vote (only two models, so tie goes to first model)
    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
    const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);

    res.json({
      signal: finalSignal,
      confidence: avgConfidence,
      reason: `Consensus. ${successful.map(d => d.reason).join(' ')}`,
      breakdown: successful.map((d, i) => ({
        model: MODELS[i] || 'unknown',
        signal: d.signal,
        confidence: d.confidence,
      })),
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'AI service error' });
  }
});

module.exports = router;
