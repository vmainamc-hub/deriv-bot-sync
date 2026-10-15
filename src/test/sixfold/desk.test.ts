// @ts-nocheck -- ported verbatim from original Sixfold source (written for non-strict index checks)
import {describe, it, expect} from 'vitest';
import {simulateBot, botSummary, baselineRate, breakEven, counterContract, crowdMap, relationToCrowd, contractState, siblings, counterCrowdBacktest, deskBacktests, windowStats} from '@/sixfold/desk';
import {chiSquareUniform, zScore} from '@/sixfold/stats';

// small deterministic generator so tests are repeatable
const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const randomDigits = (n: number, seed = 7) => { const r = rng(seed); return Array.from({length: n}, () => Math.floor(r() * 10)); };

describe('DBot-style simulator', () => {
  it('turns 1 4 7 2 4 into exactly two trades (entry then exit, no overlap)', () => {
    const t = simulateBot([1, 4, 7, 2, 4], 'OVER', 2, 0);
    expect(t).toHaveLength(2);
    expect(t.map(x => [x.entry, x.exit])).toEqual([[1, 4], [7, 2]]);
    expect(t.map(x => x.won)).toEqual([true, false]);
  });
  it('aligns the last trade to the newest tick by default', () => {
    const t = simulateBot([1, 4, 7, 2, 4], 'UNDER', 6);
    expect(t.at(-1)!.exitIndex).toBe(4);
    expect(t).toHaveLength(2);
  });
  it('uses the exit digit for the result and the barrier digit loses', () => {
    expect(simulateBot([9, 6], 'UNDER', 6, 0)[0].won).toBe(false);
    expect(simulateBot([9, 5], 'UNDER', 6, 0)[0].won).toBe(true);
  });
  it('summarises the last 20 trades and current streak', () => {
    const s = botSummary(simulateBot(Array.from({length: 60}, (_, i) => i % 10), 'OVER', 2, 0), 0.7);
    expect(s.last20).toHaveLength(20);
    expect(s.streak.length).toBeGreaterThan(0);
  });
});

describe('contract maths', () => {
  it('baselines and complements', () => {
    expect(baselineRate('UNDER', 6)).toBeCloseTo(0.6);
    expect(baselineRate('OVER', 2)).toBeCloseTo(0.7);
    expect(counterContract('OVER', 2)).toMatchObject({side: 'UNDER', param: 3});
    expect(counterContract('UNDER', 6)).toMatchObject({side: 'OVER', param: 5});
    expect(counterContract('MATCHES', 4)).toMatchObject({side: 'DIFFERS', param: 4});
    expect(breakEven(0.5)).toBeGreaterThan(0.5);
  });
  it('flags impossible contracts', () => {
    expect(contractState(randomDigits(300), 'OVER', 9).viability).toBe('INVALID');
    expect(contractState(randomDigits(300), 'UNDER', 0).viability).toBe('INVALID');
  });
  it('reports thin data instead of guessing', () => {
    expect(contractState([1, 2, 3], 'OVER', 2).viability).toBe('THIN');
  });
  it('flags a heavily lopsided stream as skewed', () => {
    const ds = randomDigits(400).map((d, i) => (i % 3 === 0 ? 7 : d));
    expect(contractState(ds, 'OVER', 2).viability).toBe('SKEWED');
  });
  it('compares siblings and marks the selected one', () => {
    const rows = siblings(randomDigits(300), 'OVER', 2);
    expect(rows.filter(r => r.selected)).toHaveLength(1);
    expect(rows.filter(r => r.best)).toHaveLength(1);
    expect(rows.some(r => r.label === 'Under 7')).toBe(true);
  });
  it('window stats use the contract baseline', () => {
    const w = windowStats(randomDigits(300), 'UNDER', 6);
    expect(w[0].baseline).toBeCloseTo(0.6);
  });
  it('stats helpers', () => {
    expect(zScore(60, 100, 0.5)).toBeCloseTo(2);
    expect(chiSquareUniform(Array(10).fill(10)).pValue).toBeGreaterThan(0.9);
  });
});

describe('crowd map', () => {
  it('pushes the Over crowd after a run of high digits and traps it when the next ticks go low', () => {
    const high = Array.from({length: 40}, (_, i) => [7, 8, 9, 6, 5][i % 5]);
    const low = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
    const over = crowdMap([...high, ...low], {overBarrier: 4}).find(c => c.side === 'OVER')!;
    expect(over.push).toBeGreaterThan(80);
    expect(over.state).toBe('TRAPPED');
    expect(over.counter).toMatchObject({side: 'UNDER', param: 5});
  });
  it('stays idle with too little history', () => {
    expect(crowdMap([1, 2, 3]).every(c => c.state === 'IDLE')).toBe(true);
  });
  it('relates the chosen contract to the crowd', () => {
    const high = Array.from({length: 52}, (_, i) => [7, 8, 9, 6, 5][i % 5]);
    const cs = crowdMap(high, {overBarrier: 4});
    expect(relationToCrowd(cs, 'OVER', 4).relation).toBe('WITH_CROWD');
    expect(relationToCrowd(cs, 'UNDER', 5).relation).toBe('AGAINST_CROWD');
  });
});

describe('counter-crowd back-test', () => {
  it('never overlaps trades and only uses past ticks', () => {
    const ds = randomDigits(600, 3);
    const r = counterCrowdBacktest(ds, {name: 't', overBarrier: 4, select: cs => cs.find(c => c.counter) ?? null});
    expect(r.trades).toBeLessThanOrEqual(Math.floor((ds.length - 52) / 2) + 1);
  });
  it('finds no edge in unbiased random digits', () => {
    const results = deskBacktests(randomDigits(3000, 11), 'UNDER', 6, 5);
    expect(results).toHaveLength(4);
    results.forEach(r => expect(r.verdict).not.toBe('EDGE_FOUND'));
  });
  it('does detect an edge when one is planted (a stream that reverses after every run)', () => {
    // the planted stream keeps dropping low once the Over crowd is trapped
    const ds: number[] = [];
    for (let k = 0; k < 150; k++) { for (let i = 0; i < 40; i++) ds.push(7 + (i % 3)); for (let i = 0; i < 40; i++) ds.push(i % 2); }
    const r = counterCrowdBacktest(ds, {name: 'planted', overBarrier: 4, select: cs => cs.find(c => c.side === 'OVER' && c.state === 'TRAPPED') ?? null});
    expect(r.trades).toBeGreaterThan(50);
    expect(r.rate).toBeGreaterThan(r.expected);
  });
});
