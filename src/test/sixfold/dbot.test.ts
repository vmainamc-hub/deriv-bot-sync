// @ts-nocheck
import {describe, it, expect} from 'vitest';
import {simulateDbot} from '@/sixfold/desk';
const mk = (ds: number[], start = 0) => ds.map((digit, i) => ({digit, epoch: 1000 + start + i, seq: start + i}));
describe('simulateDbot', () => {
  it('never reuses the settlement tick as the next entry', () => {
    const {trades} = simulateDbot(mk([1, 4, 7, 2, 4, 9, 3]), 'OVER', 2, 0);
    for (let i = 1; i < trades.length; i++) expect(trades[i].entryEpoch).toBeGreaterThan(trades[i - 1].exitEpoch);
    expect(trades.map(t => [t.entry, t.exit])).toEqual([[1, 4], [7, 2], [4, 9]]);
  });
  it('with a 1-tick buy delay trades complete every 3 ticks', () => {
    const {trades} = simulateDbot(mk(Array.from({length: 60}, (_, i) => i % 10)), 'EVEN', 0, 1);
    expect(trades.length).toBe(20);
    trades.slice(1).forEach((t, i) => expect(t.entryEpoch - trades[i].entryEpoch).toBe(3));
  });
  it('keeps past trades fixed as new ticks arrive and old ones drop off', () => {
    const all = mk(Array.from({length: 40}, (_, i) => (i * 7) % 10));
    const a = simulateDbot(all.slice(0, 30), 'ODD', 0, 1).trades;
    const b = simulateDbot(all.slice(5, 31), 'ODD', 0, 1).trades;
    const key = (t: any) => `${t.entryEpoch}-${t.exitEpoch}`;
    const aSet = new Set(a.map(key));
    b.forEach(t => expect(aSet.has(key(t)) || t.entryEpoch >= 1029).toBe(true));
  });
});
