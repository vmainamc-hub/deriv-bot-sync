// @ts-nocheck -- ported verbatim from original Sixfold source (written for non-strict index checks)
import {outcome, type ContractSide} from './engine';
import {detectChangePoint} from './researchEngines';
import {chiSquareUniform, clamp, expectedLongestRun, longestRun, wilson, zScore} from './stats';

/** Assumed built-in margin of Deriv digit contracts. Real payouts come from live proposals, which this app does not fetch. */
export const HOUSE_EDGE = 0.035;
export const ALL_SIDES: ContractSide[] = ['OVER', 'UNDER', 'EVEN', 'ODD', 'MATCHES', 'DIFFERS'];
export const usesParam = (s: ContractSide) => s === 'OVER' || s === 'UNDER' || s === 'MATCHES' || s === 'DIFFERS';

export const winDigits = (side: ContractSide, param: number): number[] =>
  Array.from({length: 10}, (_, d) => d).filter(d => outcome(side, d, param));
export const baselineRate = (side: ContractSide, param: number) => winDigits(side, param).length / 10;
export const isTradable = (side: ContractSide, param: number) => { const b = baselineRate(side, param); return b > 0 && b < 1; };
/** Win probability needed to break even if payout = stake * (1 - edge) / baseline. */
export const breakEven = (baseline: number, edge = HOUSE_EDGE) => Math.min(1, baseline / (1 - edge));
export const contractLabel = (side: ContractSide, param: number) =>
  usesParam(side) ? `${side[0]}${side.slice(1).toLowerCase()} ${param}` : `${side[0]}${side.slice(1).toLowerCase()}`;
const stakeProfit = (baseline: number, won: boolean, edge = HOUSE_EDGE) => won ? (1 - edge) / baseline - 1 : -1;

// ---------------------------------------------------------------- simulated bot
export type Trade = {n: number; entryIndex: number; exitIndex: number; entry: number; exit: number; won: boolean};

/**
 * DBot-style simulator for 1-tick contracts: buy on one tick (entry digit), settle on the next (exit digit),
 * then buy again on the tick after. Trades never overlap, so digits 1 4 7 2 4 give exactly two trades.
 * `offset` is the index of the first entry tick; the default aligns the final trade to the newest tick.
 */
export function simulateBot(digits: number[], side: ContractSide, param: number, offset = digits.length % 2): Trade[] {
  const trades: Trade[] = [];
  for (let i = Math.max(0, offset); i + 1 < digits.length; i += 2) {
    const entry = digits[i], exit = digits[i + 1];
    trades.push({n: trades.length + 1, entryIndex: i, exitIndex: i + 1, entry, exit, won: outcome(side, exit, param)});
  }
  return trades;
}

export type BotSummary = {last20: Trade[]; wins20: number; rate20: number; rate50: number; streak: {won: boolean; length: number}; longestLoss50: number; expectedLongestLoss50: number; trades: number};
export function botSummary(trades: Trade[], baseline: number): BotSummary {
  const last20 = trades.slice(-20), last50 = trades.slice(-50), wins20 = last20.filter(t => t.won).length;
  let length = 0; const lastWon = trades.at(-1)?.won ?? true;
  for (let i = trades.length - 1; i >= 0 && trades[i].won === lastWon; i--) length++;
  return {
    last20, wins20, rate20: last20.length ? wins20 / last20.length : 0,
    rate50: last50.length ? last50.filter(t => t.won).length / last50.length : 0,
    streak: {won: lastWon, length}, longestLoss50: longestRun(last50.map(t => t.won), false),
    expectedLongestLoss50: expectedLongestRun(last50.length, 1 - baseline), trades: trades.length,
  };
}

// ---------------------------------------------------------------- contract state
export type WindowStat = {window: number; n: number; wins: number; rate: number; baseline: number; breakEven: number; z: number; lo: number; hi: number};
export function windowStats(digits: number[], side: ContractSide, param: number, windows = [20, 50, 100, 300, 1000]): WindowStat[] {
  const b = baselineRate(side, param), be = breakEven(b);
  return windows.filter(w => digits.length >= Math.min(w, 20)).map(w => {
    const ds = digits.slice(-w), wins = ds.filter(d => outcome(side, d, param)).length, [lo, hi] = wilson(wins, ds.length);
    return {window: w, n: ds.length, wins, rate: ds.length ? wins / ds.length : 0, baseline: b, breakEven: be, z: zScore(wins, ds.length, b), lo, hi};
  });
}

export type Viability = 'VIABLE' | 'UNSTABLE' | 'COLD' | 'SKEWED' | 'THIN' | 'INVALID';
export type ContractState = {viability: Viability; headline: string; reasons: string[]; windows: WindowStat[]; chiP: number; changeDetected: boolean};

export function contractState(digits: number[], side: ContractSide, param: number): ContractState {
  const windows = windowStats(digits, side, param);
  if (!isTradable(side, param)) return {viability: 'INVALID', headline: 'This contract cannot win or cannot lose at this barrier.', reasons: [], windows, chiP: 1, changeDetected: false};
  const n = digits.length, b = baselineRate(side, param), be = breakEven(b), reasons: string[] = [];
  if (n < 100) return {viability: 'THIN', headline: `Only ${n} ticks loaded; need 100+ for a read.`, reasons, windows, chiP: 1, changeDetected: false};
  const w100 = windows.find(w => w.window === 100)!, long = digits.slice(-Math.min(n, 300));
  const rateLong = long.filter(d => outcome(side, d, param)).length / long.length;
  const rate50 = (windows.find(w => w.window === 50)?.rate) ?? w100.rate;
  const se50 = Math.sqrt(b * (1 - b) / 50), drift = Math.abs(rate50 - rateLong) / se50;
  const counts = Array(10).fill(0) as number[]; digits.slice(-Math.min(n, 500)).forEach(d => counts[d]++);
  const chi = chiSquareUniform(counts), cp = detectChangePoint(digits, d => outcome(side, d, param), 50, 2.5);
  reasons.push(`Last 100 ticks: ${(w100.rate * 100).toFixed(0)}% wins vs ${(b * 100).toFixed(0)}% baseline and ${(be * 100).toFixed(1)}% break-even.`);
  if (chi.pValue < 0.01) {
    const favours = w100.rate >= b;
    reasons.push(`Digit distribution over the last ${Math.min(n, 500)} ticks is lopsided (p≈${chi.pValue.toFixed(3)}); it ${favours ? 'currently favours' : 'currently hurts'} this contract.`);
    return {viability: 'SKEWED', headline: 'Digit distribution is visibly lopsided.', reasons, windows, chiP: chi.pValue, changeDetected: cp.detected};
  }
  if (cp.detected || drift > 2.5) {
    reasons.push(`Short-window rate (${(rate50 * 100).toFixed(0)}%) has moved away from the longer window (${(rateLong * 100).toFixed(0)}%).`);
    return {viability: 'UNSTABLE', headline: 'Recent behaviour differs from the longer run.', reasons, windows, chiP: chi.pValue, changeDetected: true};
  }
  if (w100.rate >= be && rateLong >= b) return {viability: 'VIABLE', headline: 'Recent and long windows agree and clear break-even.', reasons, windows, chiP: chi.pValue, changeDetected: false};
  reasons.push('Recent win rate is below the level needed to cover the built-in margin.');
  return {viability: 'COLD', headline: 'Running below break-even.', reasons, windows, chiP: chi.pValue, changeDetected: false};
}

// ---------------------------------------------------------------- siblings
export type SiblingRow = {side: ContractSide; param: number; label: string; baseline: number; rate: number; edge: number; z: number; viability: Viability; selected: boolean; best: boolean};
export function siblings(digits: number[], side: ContractSide, param: number, window = 100): SiblingRow[] {
  const cands: {side: ContractSide; param: number}[] = [];
  if (side === 'OVER' || side === 'UNDER') {
    for (let p = 0; p <= 8; p++) cands.push({side: 'OVER', param: p});
    for (let p = 1; p <= 9; p++) cands.push({side: 'UNDER', param: p});
  } else if (side === 'EVEN' || side === 'ODD') { cands.push({side: 'EVEN', param: 0}, {side: 'ODD', param: 0}); }
  else for (let p = 0; p <= 9; p++) cands.push({side, param: p});
  const ds = digits.slice(-window);
  const rows = cands.map(c => {
    const b = baselineRate(c.side, c.param), wins = ds.filter(d => outcome(c.side, d, c.param)).length, rate = ds.length ? wins / ds.length : 0;
    return {side: c.side, param: c.param, label: contractLabel(c.side, c.param), baseline: b, rate, edge: rate - breakEven(b), z: zScore(wins, ds.length, b),
      viability: contractState(digits, c.side, c.param).viability, selected: c.side === side && (c.param === param || !usesParam(side)), best: false};
  });
  const bestEdge = Math.max(...rows.map(r => r.edge));
  rows.forEach(r => { r.best = r.edge === bestEdge; });
  return rows;
}

// ---------------------------------------------------------------- crowd map
export type CrowdState = 'LOADING' | 'TRAPPED' | 'RELIEVED' | 'IDLE';
export type ContractRef = {side: ContractSide; param: number; label: string; baseline: number};
export type Crowd = {side: ContractSide; param: number; label: string; push: number; state: CrowdState; shownRate: number; deliveredRate: number; baseline: number; counter: ContractRef | null; note: string};

const ref = (side: ContractSide, param: number): ContractRef => ({side, param, label: contractLabel(side, param), baseline: baselineRate(side, param)});
/** Exact complement of a contract: the other side of the same market. */
export function counterContract(side: ContractSide, param: number): ContractRef | null {
  switch (side) {
    case 'OVER': return param <= 8 ? ref('UNDER', param + 1) : null;
    case 'UNDER': return param >= 1 ? ref('OVER', param - 1) : null;
    case 'EVEN': return ref('ODD', 0);
    case 'ODD': return ref('EVEN', 0);
    case 'MATCHES': return ref('DIFFERS', param);
    case 'DIFFERS': return ref('MATCHES', param);
  }
}

export type CrowdOptions = {overBarrier?: number; showWindow?: number; deliverWindow?: number; pushThreshold?: number};
/**
 * Estimates where each of the six trader crowds is leaning, from digits alone.
 * Model (an assumption, not an observation of real positions): a crowd is PUSHED toward a contract when that contract
 * has been winning more than its baseline over the "shown" window (older part of the recent history). It is TRAPPED
 * when the most recent "delivered" window then went against it, LOADING when it hasn't paid off or failed yet, RELIEVED when it did.
 * Matches follows the hottest digit; Differs follows the coldest digit (it "feels safe" because it has been absent).
 */
export function crowdMap(digits: number[], opts: CrowdOptions = {}): Crowd[] {
  const show = opts.showWindow ?? 40, del = opts.deliverWindow ?? 12, th = opts.pushThreshold ?? 40, ob = opts.overBarrier ?? 4;
  const recent = digits.slice(-(show + del)), ready = recent.length >= show + del;
  const shown = recent.slice(0, Math.max(0, recent.length - del)), delivered = recent.slice(-del);
  const counts = Array(10).fill(0) as number[]; shown.forEach(d => counts[d]++);
  let hot = 0, cold = 0;
  for (let d = 0; d < 10; d++) {
    if (counts[d] >= counts[hot]) hot = d;
    if (counts[d] < counts[cold] || (counts[d] === counts[cold] && lastSeen(shown, d) < lastSeen(shown, cold))) cold = d;
  }
  const specs: {side: ContractSide; param: number; note: string}[] = [
    {side: 'OVER', param: ob, note: 'Chases a run of high digits.'}, {side: 'UNDER', param: ob + 1, note: 'Chases a run of low digits.'},
    {side: 'EVEN', param: 0, note: 'Chases a run of even digits.'}, {side: 'ODD', param: 0, note: 'Chases a run of odd digits.'},
    {side: 'MATCHES', param: hot, note: `Follows the hottest digit (${hot}).`}, {side: 'DIFFERS', param: cold, note: `Leans on the coldest digit (${cold}) staying away.`},
  ];
  return specs.map(s => {
    const b = baselineRate(s.side, s.param), valid = isTradable(s.side, s.param);
    const sw = shown.filter(d => outcome(s.side, d, s.param)).length, dw = delivered.filter(d => outcome(s.side, d, s.param)).length;
    const zS = zScore(sw, shown.length, b), zD = zScore(dw, delivered.length, b);
    const push = ready && valid ? Math.round(clamp(zS / 2.5) * 100) : 0;
    const state: CrowdState = push < th ? 'IDLE' : zD <= -0.75 ? 'TRAPPED' : zD >= 0 ? 'RELIEVED' : 'LOADING';
    return {side: s.side, param: s.param, label: contractLabel(s.side, s.param), push, state, baseline: b,
      shownRate: shown.length ? sw / shown.length : 0, deliveredRate: delivered.length ? dw / delivered.length : 0,
      counter: valid ? counterContract(s.side, s.param) : null, note: ready ? s.note : `Need ${show + del} ticks.`};
  });
}
function lastSeen(ds: number[], d: number) { const i = ds.lastIndexOf(d); return i; }

export type CrowdRelation = 'WITH_CROWD' | 'AGAINST_CROWD' | 'NEUTRAL';
/** Is the chosen contract the same as a pushed crowd's contract, or its exact counter? */
export function relationToCrowd(crowds: Crowd[], side: ContractSide, param: number, th = 40): {relation: CrowdRelation; crowd: Crowd | null} {
  const same = (a: ContractSide, p: number) => a === side && (!usesParam(side) || p === param);
  const pushed = crowds.filter(c => c.push >= th);
  const withC = pushed.find(c => same(c.side, c.param));
  if (withC) return {relation: 'WITH_CROWD', crowd: withC};
  const against = pushed.find(c => c.counter && same(c.counter.side, c.counter.param));
  if (against) return {relation: 'AGAINST_CROWD', crowd: against};
  return {relation: 'NEUTRAL', crowd: null};
}

// ---------------------------------------------------------------- counter-crowd back-test
export type BacktestHalf = {trades: number; rate: number; expected: number; z: number};
export type BacktestResult = {name: string; trades: number; wins: number; rate: number; expected: number; z: number; roi: number; first: BacktestHalf; second: BacktestHalf; verdict: 'TOO_FEW' | 'NO_EDGE' | 'WORSE_THAN_ODDS' | 'EDGE_FOUND'; note: string};
export type BacktestOptions = CrowdOptions & {name: string; select: (crowds: Crowd[]) => Crowd | null; minTrades?: number; edge?: number};

/**
 * Walk-forward: each trade's signal uses only ticks up to and including its entry digit, the outcome is the exit digit,
 * and trades never overlap (a DBot buys again on the tick after a trade settles). Compares wins to the odds of the
 * contracts actually traded and reports ROI after the assumed built-in margin.
 */
export function counterCrowdBacktest(digits: number[], opts: BacktestOptions): BacktestResult {
  const need = (opts.showWindow ?? 40) + (opts.deliverWindow ?? 12), edge = opts.edge ?? HOUSE_EDGE;
  const log: {won: boolean; b: number}[] = [];
  let next = need;
  for (let i = need; i < digits.length; i++) {
    if (i < next) continue;
    const pick = opts.select(crowdMap(digits.slice(i - need, i), opts));
    if (!pick?.counter) continue;
    const c = pick.counter;
    log.push({won: outcome(c.side, digits[i], c.param), b: c.baseline});
    next = i + 2;
  }
  const agg = (xs: typeof log): BacktestHalf => {
    const wins = xs.filter(x => x.won).length, exp = xs.reduce((s, x) => s + x.b, 0), v = xs.reduce((s, x) => s + x.b * (1 - x.b), 0);
    return {trades: xs.length, rate: xs.length ? wins / xs.length : 0, expected: xs.length ? exp / xs.length : 0, z: v ? (wins - exp) / Math.sqrt(v) : 0};
  };
  const all = agg(log), mid = Math.floor(log.length / 2), first = agg(log.slice(0, mid)), second = agg(log.slice(mid));
  const wins = log.filter(x => x.won).length;
  const roi = log.length ? log.reduce((s, x) => s + stakeProfit(x.b, x.won, edge), 0) / log.length : 0;
  const minTrades = opts.minTrades ?? 100;
  let verdict: BacktestResult['verdict'] = 'NO_EDGE', note = 'Results are within what luck alone produces.';
  if (log.length < minTrades) { verdict = 'TOO_FEW'; note = `Only ${log.length} signals; need ${minTrades}+ before this means anything.`; }
  else if (all.z >= 2 && roi > 0 && second.z > 0) { verdict = 'EDGE_FOUND'; note = 'Beat the odds in-sample and in the later half. Confirm on fresh ticks, and remember that testing many variants produces false winners.'; }
  else if (all.z <= -2) { verdict = 'WORSE_THAN_ODDS'; note = 'Trading against this crowd did worse than random.'; }
  return {name: opts.name, trades: log.length, wins, rate: all.rate, expected: all.expected, z: all.z, roi, first, second, verdict, note};
}

/** The four back-tests shown on the desk: any crowd / trapped only, and the same two filtered to the chosen contract. */
export function deskBacktests(digits: number[], side: ContractSide, param: number, overBarrier: number): BacktestResult[] {
  const base = {overBarrier};
  const dominant = (cs: Crowd[], trappedOnly: boolean) => cs.filter(c => c.push >= 40 && (!trappedOnly || c.state === 'TRAPPED')).sort((a, b) => b.push - a.push)[0] ?? null;
  const mine = (cs: Crowd[], trappedOnly: boolean) => cs.find(c => c.push >= 40 && (!trappedOnly || c.state === 'TRAPPED') && c.counter?.side === side && (!usesParam(side) || c.counter.param === param)) ?? null;
  return [
    counterCrowdBacktest(digits, {...base, name: 'Any pushed crowd → opposite', select: cs => dominant(cs, false)}),
    counterCrowdBacktest(digits, {...base, name: 'Trapped crowds only → opposite', select: cs => dominant(cs, true)}),
    counterCrowdBacktest(digits, {...base, name: `${contractLabel(side, param)} when its opposite crowd is pushed`, select: cs => mine(cs, false)}),
    counterCrowdBacktest(digits, {...base, name: `${contractLabel(side, param)} when its opposite crowd is trapped`, select: cs => mine(cs, true)}),
  ];
}
