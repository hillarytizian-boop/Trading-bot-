const router = require('express').Router();
const OpenAI = require('openai');

// NVIDIA API client
const client = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Models to query – all three from your snippets
const MODELS = [
  'z-ai/glm-5.1',                     // GLM-5.1
  'deepseek-ai/deepseek-v4-pro',       // DeepSeek-v4-pro
  'moonshotai/kimi-k2.6',              // Kimi K2.6 (new)
];

// Helper: query a single model with parameters that match your Python code
async function queryModel(model, prompt) {
  // Common parameters (temperature=1, top_p=1, max_tokens=16384)
  const params = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 1,
    top_p: 1,
    max_tokens: 16384,
    stream: false,
  };

  // DeepSeek supports extra_body with thinking: false; add it only for that model
  if (model === 'deepseek-ai/deepseek-v4-pro') {
    params.extra_body = { chat_template_kwargs: { thinking: false } };
  }

  try {
    const completion = await client.chat.completions.create(params);
    const content = completion.choices[0].message.content;

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal && parsed.confidence !== undefined && parsed.reason) {
        return { model, success: true, data: parsed };
      }
    }
    // Fallback text extraction
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    const reason = content.slice(0, 200);
    const signal = signalMatch ? signalMatch[0].toUpperCase() : 'HOLD';
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;
    return { model, success: true, data: { signal, confidence, reason } };
  } catch (error) {
    console.warn(`Model ${model} failed:`, error.message);
    return { model, success: false, error: error.message };
  }
}

// Main endpoint: call all models and aggregate
router.post('/analyze', async (req, res) => {
  const { market, price, indicators } = req.body;

  const prompt = `You are a professional crypto trading analyst.
Given the following data for ${market || 'BTC/USDT'}:
- Current price: ${price || 'unknown'}
- RSI: ${indicators?.rsi || 'N/A'}
- EMA: ${indicators?.ema || 'N/A'}
- MACD: ${indicators?.macd || 'N/A'}

Provide a trading signal (BUY, SELL, or HOLD) with a confidence percentage (0-100) and a brief reason (max 50 words).
Respond ONLY with valid JSON in this exact format:
{"signal": "BUY", "confidence": 85, "reason": "Bullish breakout above resistance."}`;

  try {
    // Query all models in parallel
    const promises = MODELS.map(model => queryModel(model, prompt));
    const results = await Promise.allSettled(promises);

    // Collect successful responses
    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value.data);

    if (successful.length === 0) {
      return res.status(500).json({ error: 'All AI models failed to respond' });
    }

    // Majority vote
    const signals = successful.map(d => d.signal);
    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    signals.forEach(s => { if (signalCount[s] !== undefined) signalCount[s]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);

    // Average confidence
    const avgConfidence = Math.round(successful.reduce((sum, d) => sum + d.confidence, 0) / successful.length);
    const reasons = successful.map(d => d.reason);

    const breakdown = successful.map((d, i) => ({
      model: MODELS[i] || 'unknown',
      signal: d.signal,
      confidence: d.confidence,
      reason: d.reason,
    }));

    res.json({
      signal: finalSignal,
      confidence: avgConfidence,
      reason: `Consensus from ${successful.length} models. ${reasons.join(' ')}`,
      breakdown,
    });
  } catch (error) {
    console.error('Multi-model analysis error:', error);
    res.status(500).json({ error: 'AI service error', details: error.message });
  }
});

module.exports = router;
