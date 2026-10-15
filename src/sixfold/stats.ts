// @ts-nocheck -- ported verbatim from original Sixfold source (written for non-strict index checks)
export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 erf approximation). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Wins vs expected wins under probability p, in standard deviations. */
export function zScore(wins: number, n: number, p: number): number {
  if (!n || p <= 0 || p >= 1) return 0;
  return (wins - n * p) / Math.sqrt(n * p * (1 - p));
}

/** Wilson 95% interval for a win rate. */
export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const p = wins / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Chi-square test of uniformity over the ten digits (df = 9, Wilson-Hilferty p-value approximation). */
export function chiSquareUniform(counts: number[]): { chi: number; pValue: number } {
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return { chi: 0, pValue: 1 };
  const e = n / counts.length;
  const chi = counts.reduce((s, c) => s + (c - e) ** 2 / e, 0);
  const k = counts.length - 1;
  const t = (Math.cbrt(chi / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return { chi, pValue: clamp(1 - normalCdf(t)) };
}

/** Longest run of `value` in a boolean series. */
export function longestRun(flags: boolean[], value: boolean): number {
  let best = 0, cur = 0;
  for (const f of flags) { cur = f === value ? cur + 1 : 0; if (cur > best) best = cur; }
  return best;
}

/** Rough expected longest run of an event with probability p in n independent trials. */
export function expectedLongestRun(n: number, p: number): number {
  if (n < 1 || p <= 0) return 0;
  if (p >= 1) return n;
  return Math.max(1, Math.log(n * (1 - p)) / Math.log(1 / p));
}
