// Running-cost estimates shown on Nikhil's dashboard. Rates are env-configurable
// because they are contract/plan specific; the dashboard labels them as estimates.

const num = (v: string | undefined, fallback: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : fallback);

export function costRates() {
  return {
    // Vaani per-minute voice rate in INR. 0 = not set yet (dashboard says so).
    vaaniPerMinInr: num(process.env.VAANI_COST_PER_MIN_INR, 0),
    // Gemini Flash list prices, USD per 1M tokens
    geminiInputPerM: num(process.env.GEMINI_INPUT_USD_PER_M, 0.3),
    geminiOutputPerM: num(process.env.GEMINI_OUTPUT_USD_PER_M, 2.5),
    usdInr: num(process.env.USD_INR, 88),
  };
}

export function aiCostInr(inputTokens: number, outputTokens: number) {
  const r = costRates();
  return ((inputTokens * r.geminiInputPerM + outputTokens * r.geminiOutputPerM) / 1_000_000) * r.usdInr;
}

export function voiceCostInr(seconds: number) {
  return (seconds / 60) * costRates().vaaniPerMinInr;
}
