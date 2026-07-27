const OpenAI = require('openai');

class InstitutionalTradingDesk {
  constructor() {
    this.nvidiaClient = new OpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: process.env.NVIDIA_API_KEY,
    });
    this.model = 'z-ai/glm-5.2';

    // 17 Specialized Persona Definitions
    this.agents = {
      // LAYER 1: DATA & TECHNICAL ANALYSTS (6 AGENTS)
      rsiAnalyst: "RSI Momentum Specialist. Analyzes oversold/overbought conditions and divergence.",
      macdAnalyst: "MACD & Trend Specialist. Evaluates moving average convergence, histograms, and crossovers.",
      orderbookAnalyst: "Market Depth & Liquidity Analyst. Detects order book walls, bid/ask imbalances, and slippage.",
      volatilityAnalyst: "ATR & Volatility Specialist. Assesses market turbulence, Bollinger squeeze, and breakout risks.",
      sentimentAnalyst: "Social & Market Sentiment Analyst. Scans volume-weighted sentiment and market mood.",
      onChainAnalyst: "On-Chain & Exchange Flow Analyst. Tracks whale wallet movements and net exchange inflows/outflows.",

      // LAYER 2: RESEARCH & THESIS COMMITTEE (4 AGENTS)
      bullResearcher: "Lead Bullish Researcher. Identifies every upside catalyst and builds high-conviction long setups.",
      bearResearcher: "Lead Bearish Researcher. Identifies downside traps, liquidity hunts, and resistance rejection risks.",
      macroStrategist: "Macro Strategist. Evaluates broader crypto correlation, interest rate environment, and BTC dominance.",
      quantDebater: "Quantitative Arbitrageur. Cross-examines Bull and Bear arguments against statistical probability.",

      // LAYER 3: RISK MANAGEMENT BOARD (4 AGENTS)
      stopLossGuardian: "Risk Committee: Stop-Loss Guardian. Calculates hard liquidation bounds and invalidated price levels.",
      positionSizer: "Risk Committee: Position Sizing Specialist. Determines optimal leverage and portfolio allocation.",
      maxDrawdownAuditor: "Risk Committee: Drawdown Auditor. Rejects trades if systemic market risk violates safety limits.",
      slippageAuditor: "Execution Risk Auditor. Ensures order execution will not suffer toxic flow or front-running.",

      // LAYER 4: EXECUTIVE EXECUTION (3 AGENTS)
      portfolioManager: "Chief Portfolio Officer. Reconciles all analyst reports, debate results, and risk parameters.",
      executionTrader: "Binance API Execution Specialist. Generates exact order types (LIMIT vs MARKET) and parameters.",
      postTradeAuditor: "System Logger & Compliance Agent. Documents reasoning trails and post-execution logs."
    };
  }

  async queryLLM(prompt, temperature = 0.3) {
    try {
      const response = await this.nvidiaClient.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: 600,
      });
      return response.choices[0]?.message?.content || "";
    } catch (err) {
      console.error("[TradingDesk] LLM Query Error:", err.message);
      return "Analysis unavailable due to upstream API error.";
    }
  }

  async runFull17AgentPipeline(marketTelemetry) {
    console.log(`\n🤖 Running 17-Agent Consensus Pipeline for ${marketTelemetry.symbol}...`);

    // PHASE 1: Data & Indicator Analysts (6 Agents)
    const analystPrompt = `Market Data: ${JSON.stringify(marketTelemetry)}
You represent 6 Technical Analyst Agents: [RSI, MACD, OrderBook, Volatility, Sentiment, OnChain].
Synthesize this telemetry and provide a unified technical briefing outlining momentum, trend strength, and liquidity metrics.`;
    const analystReport = await this.queryLLM(analystPrompt, 0.2);

    // PHASE 2: Thesis & Debate Committee (4 Agents)
    const debatePrompt = `Technical Briefing: ${analystReport}
You represent 4 Research Agents: [Bull Researcher, Bear Researcher, Macro Strategist, Quant Debater].
Cross-examine the briefing. Debate the bull vs. bear scenarios and output the prevailing market thesis.`;
    const debateOutcome = await this.queryLLM(debatePrompt, 0.4);

    // PHASE 3: Risk Management Board (4 Agents)
    const riskPrompt = `Debate Thesis: ${debateOutcome}\nPrice: $${marketTelemetry.currentPrice}
You represent 4 Risk Committee Agents: [StopLoss Guardian, Position Sizer, Drawdown Auditor, Slippage Auditor].
Audit this trade thesis and define acceptable stop loss, take profit, and position bounds.`;
    const riskAudit = await this.queryLLM(riskPrompt, 0.1);

    // PHASE 4: Executive Decision & Structured Output (3 Agents)
    const executionPrompt = `
Synthesize reports from 14 previous agents:
- Briefing: ${analystReport}
- Debate: ${debateOutcome}
- Risk Audit: ${riskAudit}

Current Price: $${marketTelemetry.currentPrice}

You are the Portfolio Manager and Binance Execution Officer. Return strictly JSON with keys:
"signal" ("BUY", "SELL", or "HOLD"),
"confidence" (number 0 to 100),
"reason" (string summarizing the 17-agent consensus in 30 words or less),
"stopLoss" (number),
"takeProfit" (number)
`;

    const finalRaw = await this.queryLLM(executionPrompt, 0.1);
    
    try {
      const jsonMatch = finalRaw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          signal: parsed.signal || 'HOLD',
          confidence: Number(parsed.confidence) || 0,
          reason: parsed.reason || 'Consensus reached HOLD.',
          stopLoss: parsed.stopLoss || marketTelemetry.currentPrice * 0.98,
          takeProfit: parsed.takeProfit || marketTelemetry.currentPrice * 1.05,
          data: {
            price: marketTelemetry.currentPrice,
            analystReport,
            debateOutcome,
            riskAudit
          }
        };
      }
    } catch (e) {
      console.error("[TradingDesk] JSON Parsing Error, falling back to HOLD.");
    }

    return {
      signal: 'HOLD',
      confidence: 0,
      reason: 'Failed to extract JSON decision from executive agents.',
      data: { price: marketTelemetry.currentPrice }
    };
  }
}

module.exports = new InstitutionalTradingDesk();
