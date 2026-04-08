export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':            { input: 15.0,  output: 75.0 },
  'claude-opus-4-6-thinking':   { input: 15.0,  output: 75.0 },
  'claude-sonnet-4-6':          { input: 3.0,   output: 15.0 },
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.0 },
  'gpt-5.4':                    { input: 2.50,  output: 10.0 },
  'gpt-5.3-codex-high':         { input: 2.50,  output: 10.0 },
  'gpt-5.3-codex-low':          { input: 2.50,  output: 10.0 },
  'gpt-5.3-codex-xhigh':        { input: 2.50,  output: 10.0 },
  'gpt-5.3-codex':              { input: 2.50,  output: 10.0 },
  'gpt-5.1-codex-max':          { input: 2.50,  output: 10.0 },
  'gpt-5.1-codex-mini-high':    { input: 0.30,  output: 1.20 },
  'gpt-5-codex-mini':           { input: 0.30,  output: 1.20 },
  'gpt-oss-120b-medium':        { input: 1.10,  output: 4.40 },
  'grok-4-1-fast-reasoning':    { input: 3.0,   output: 15.0 },
  'grok-4.20':                  { input: 2.0,   output: 10.0 },
  'grok-4.20-0309-reasoning':   { input: 2.0,   output: 10.0 },
  'gemini-2.5-flash':           { input: 0.15,  output: 0.60 },
  'gemini-2.5-pro':             { input: 1.25,  output: 10.0 },
  'llama-3.3-70b-versatile':    { input: 0.59,  output: 0.79 },
};

const DEFAULT_PRICING = { input: 1.0, output: 5.0 };

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const rates = PRICING[model] ?? DEFAULT_PRICING;
  return (tokensIn * rates.input + tokensOut * rates.output) / 1_000_000;
}

export function getModelRate(model: string): { input: number; output: number } {
  return PRICING[model] ?? DEFAULT_PRICING;
}
