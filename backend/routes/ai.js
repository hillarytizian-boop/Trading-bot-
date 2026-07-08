const router = require('express').Router();
const OpenAI = require('openai');

// Two clients with different API keys
const glmClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_GLM_API_KEY,   // your existing GLM key
});

const deepseekClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_DEEPSEEK_API_KEY, // the new DeepSeek key
});

const MODELS = [
  { client: glmClient, model: 'z-ai/glm-5.2' },
  { client: deepseekClient, model: 'deepseek-ai/deepseek-v4-flash' },
];

async function queryModel({ client, model }, prompt) {
  const params = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 1,
    top_p: 0.95,
    max_tokens: 512,
    stream: false,
  };
  if (model === 'deepseek-ai/deepseek-v4-flash') {
    params.extra_body = {
      chat_template_kwargs: {
        thinking: true,
        reasoning_effort: 'high',
      },
    };
  }
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
        reason: content.slice(0, 200) || 'Analysis complete',
      },
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
    const results = await Promise.allSettled(MODELS.map(entry => queryModel(entry, prompt)));
    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value.data);

    if (successful.length === 0) {
      return res.status(500).json({ error: 'All models failed' });
    }

    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
    const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);

    res.json({
      signal: finalSignal,
      confidence: avgConfidence,
      reason: `Consensus. ${successful.map(d => d.reason).join(' ')}`,
      breakdown: successful.map((d, i) => ({
        model: MODELS[i].model,
        signal: d.signal,
        confidence: d.confidence,
      })),
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'AI service error', details: error.message });
  }
});

module.exports = router;
