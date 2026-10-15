// Market scanner: ranks Over 1/2/3 and Under 8/7/6 across markets using every engine in the app.
import {analyzeDigits, outcome, type ContractSide} from './engine';
import {evaluatePsychology} from './psychology';
import {baselineRate, breakEven, botSummary, contractLabel, contractState, crowdMap, relationToCrowd, simulateDbot, windowStats, type Crowd, type Viability} from './desk';
import {clamp} from './stats';

export const SCAN_CONTRACTS: {side: ContractSide; param: number}[] = [
  {side: 'OVER', param: 1}, {side: 'OVER', param: 2}, {side: 'OVER', param: 3},
  {side: 'UNDER', param: 8}, {side: 'UNDER', param: 7}, {side: 'UNDER', param: 6},
];
export type Signal = 'GO' | 'WATCH' | 'NO';
export type ContractScore = {
  side: ContractSide; param: number; label: string; score: number; signal: Signal;
  parts: {performance: number; bot: number; psychology: number; stability: number; liquidity: number};
  rate100: number; breakEven: number; bot20: number; bot50: number; botWins20: number; streak: {won: boolean; length: number};
  viability: Viability; liquidityPhase: string; crowdNote: string; crowds: Crowd[]; reasons: string[];
};
export type MarketScan = {symbol: string; name: string; n: number; contracts: ContractScore[]; best: ContractScore | null; error?: string};

const vScore: Record<Viability, number> = {VIABLE: 100, SKEWED: 60, UNSTABLE: 35, COLD: 15, THIN: 0, INVALID: 0};
const toPct = (x: number) => Math.round(clamp(x) * 100);

export function scoreContract(digits: number[], side: ContractSide, param: number): ContractScore {
  const b = baselineRate(side, param), be = breakEven(b), label = contractLabel(side, param), reasons: string[] = [];
  // 1. Current market performance: edge over break-even across windows (z-weighted, longer windows weigh more).
  const ws = windowStats(digits, side, param, [50, 100, 300, 1000]);
  const wsum = ws.reduce((s, w) => s + Math.sqrt(w.n), 0) || 1;
  const perfZ = ws.reduce((s, w) => s + Math.sqrt(w.n) * ((w.rate - w.breakEven) / Math.sqrt(b * (1 - b) / Math.max(1, w.n))), 0) / wsum;
  const performance = toPct(0.5 + perfZ / 4);
  const rate100 = ws.find(w => w.window === 100)?.rate ?? 0;
  // 2. DBot simulation: fresh entry tick -> settle on next fresh tick, gap 1.
  const ticks = digits.map((d, i) => ({digit: d, epoch: i, seq: i}));
  const {trades} = simulateDbot(ticks, side, param, 1, 0);
  const bs = botSummary(trades, b);
  const botEdge = 0.6 * (bs.rate20 - be) + 0.4 * (bs.rate50 - be);
  let bot = toPct(0.5 + botEdge / (2 * Math.sqrt(b * (1 - b) / 20)) / 2);
  if (!bs.streak.won && bs.streak.length >= 3) { bot = Math.max(0, bot - 15); reasons.push(`Bot is on a ${bs.streak.length}-trade losing streak.`); }
  // 3. Psychology of all six traders: is the crowd on the other side pushed and trapped?
  const crowdBarrier = side === 'OVER' ? param : param - 1;
  const crowds = crowdMap(digits, {overBarrier: crowdBarrier});
  const rel = relationToCrowd(crowds, side, param);
  let psych = 50, crowdNote = 'No crowd is leaning on this contract.';
  if (rel.relation === 'AGAINST_CROWD' && rel.crowd) {
    psych += rel.crowd.state === 'TRAPPED' ? 35 : rel.crowd.state === 'LOADING' ? 20 : 5;
    crowdNote = `${rel.crowd.label} crowd is ${rel.crowd.state.toLowerCase()} — you sit on the other side.`;
  } else if (rel.relation === 'WITH_CROWD' && rel.crowd) {
    psych += rel.crowd.state === 'TRAPPED' ? -35 : rel.crowd.state === 'RELIEVED' ? -10 : -5;
    crowdNote = `You'd be trading with the ${rel.crowd.label} crowd (${rel.crowd.state.toLowerCase()}).`;
  }
  // The other four crowds: trapped crowds whose losing digits are inside our winning zone help us.
  crowds.forEach(c => {
    if (c === rel.crowd || c.state === 'IDLE') return;
    const overlap = Array.from({length: 10}, (_, d) => d).filter(d => !outcome(c.side, d, c.param) && outcome(side, d, param)).length / 10;
    if (c.state === 'TRAPPED') psych += 6 * overlap * 2; else if (c.state === 'LOADING') psych -= 3;
  });
  const sentinel = evaluatePsychology(digits.slice(-300), side, param);
  if (sentinel.supported) psych += 8; else psych -= 8;
  if (side === 'OVER') { // digit 1 is the forbidden/losing digit for the Over trader
    const r1 = digits.slice(-100).filter(d => d <= param).length / Math.max(1, Math.min(100, digits.length));
    if (r1 > (param + 1) / 10 + 0.04) { psych -= 8; reasons.push('Losing digits are gaining in the last 100 ticks.'); }
  } else {
    const rl = digits.slice(-100).filter(d => d >= param).length / Math.max(1, Math.min(100, digits.length));
    if (rl > (10 - param) / 10 + 0.04) { psych -= 8; reasons.push('Losing digits are gaining in the last 100 ticks.'); }
  }
  const psychology = Math.round(clamp(psych, 0, 100));
  // 4. Stability and 5. liquidity structure.
  const st = contractState(digits, side, param);
  const stability = st.viability === 'SKEWED' && rate100 >= b ? 75 : vScore[st.viability];
  const rep = analyzeDigits(digits, {window: Math.min(1000, digits.length), barrier: param, minSample: 100});
  const liquidity = rep.liquidity.veto ? 35 : 85;
  const score = Math.round(0.28 * performance + 0.27 * bot + 0.25 * psychology + 0.1 * stability + 0.1 * liquidity);
  const go = score >= 68 && bs.rate20 >= be && rate100 >= be && psychology >= 55 && (st.viability === 'VIABLE' || stability >= 75);
  const signal: Signal = go ? 'GO' : score >= 55 ? 'WATCH' : 'NO';
  if (bs.rate20 < be) reasons.push(`Bot last 20 at ${Math.round(bs.rate20 * 100)}% is below break-even ${Math.round(be * 100)}%.`);
  if (rep.liquidity.veto) reasons.push(`Liquidity phase: ${rep.liquidity.phase.toLowerCase().replaceAll('_', ' ')}.`);
  return {side, param, label, score, signal, parts: {performance, bot, psychology, stability, liquidity}, rate100, breakEven: be,
    bot20: bs.rate20, bot50: bs.rate50, botWins20: bs.wins20, streak: bs.streak, viability: st.viability,
    liquidityPhase: rep.liquidity.phase, crowdNote, crowds, reasons};
}

export function scanMarket(symbol: string, name: string, digits: number[]): MarketScan {
  if (digits.length < 120) return {symbol, name, n: digits.length, contracts: [], best: null, error: 'Not enough ticks'};
  const contracts = SCAN_CONTRACTS.map(c => scoreContract(digits, c.side, c.param));
  const best = [...contracts].sort((a, b) => b.score - a.score)[0];
  return {symbol, name, n: digits.length, contracts, best: best ?? null};
}

/** Overall winner: highest best-contract score, tie broken by bot last 20 then whole-market average. */
export function pickBest(scans: MarketScan[]): MarketScan | null {
  const ok = scans.filter(s => s.best);
  const avg = (s: MarketScan) => s.contracts.reduce((a, c) => a + c.score, 0) / s.contracts.length;
  ok.sort((a, b) => b.best!.score - a.best!.score || b.best!.bot20 - a.best!.bot20 || avg(b) - avg(a));
  return ok[0] ?? null;
}

export function shuffle<T>(xs: T[], seed = 1): T[] {
  const a = [...xs]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
/** Re-run the scan on shuffled digits (keeps mix, destroys order) to see how many GO/WATCH appear by chance. */
export function realityCheck(data: {symbol: string; name: string; digits: number[]}[], runs = 3) {
  const count = (scans: MarketScan[], sig: Signal) => scans.reduce((n, s) => n + s.contracts.filter(c => c.signal === sig).length, 0);
  const real = data.map(d => scanMarket(d.symbol, d.name, d.digits));
  let go = 0, watch = 0;
  for (let r = 0; r < runs; r++) { const sh = data.map((d, i) => scanMarket(d.symbol, d.name, shuffle(d.digits, 7 + r * 31 + i))); go += count(sh, 'GO'); watch += count(sh, 'WATCH'); }
  return {realGo: count(real, 'GO'), realWatch: count(real, 'WATCH'), shuffledGo: go / runs, shuffledWatch: watch / runs};
}
