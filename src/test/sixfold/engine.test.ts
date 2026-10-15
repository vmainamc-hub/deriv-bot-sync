// @ts-nocheck -- ported verbatim from original Sixfold source (written for non-strict index checks)
import {describe,it,expect} from 'vitest';
import {evaluatePsychology} from '@/sixfold/psychology';
import {analyzeDigits,contractParameter,digitFromQuote,expectedValue,outcome,parseDigitsText,walkForwardReplay} from '@/sixfold/engine';

describe('digit extraction',()=>{
 it('uses fixed precision to extract the terminal digit',()=>{expect(digitFromQuote(123.47,2)).toBe(7);expect(digitFromQuote(12.3,2)).toBe(0);});
});
describe('contract complements',()=>{
 it('treats even and odd as exact complements',()=>{for(let d=0;d<=9;d++)expect(outcome('EVEN',d,0)).not.toBe(outcome('ODD',d,0));});
 it('treats matches and differs as exact complements',()=>{for(let d=0;d<=9;d++)expect(outcome('MATCHES',d,4)).not.toBe(outcome('DIFFERS',d,4));});
 it('uses strict Over/Under barriers',()=>{expect(outcome('OVER',3,2)).toBe(true);expect(outcome('OVER',2,2)).toBe(false);expect(outcome('UNDER',1,2)).toBe(true);expect(outcome('UNDER',2,2)).toBe(false);});
});
describe('analysis and import',()=>{
 it('keeps all six perspectives tied to one sample',()=>{const r=analyzeDigits([0,1,2,3,4,5,6,7,8,9],{window:20,minSample:10});expect(r.perspectives).toHaveLength(6);expect(r.perspectives.every(p=>p.count===10)).toBe(true);});
 it('blocks weak sample sizes with WAIT',()=>{expect(analyzeDigits([1,2,3],{minSample:100}).decision).toBe('WAIT');});
 it('rejects malformed digit imports',()=>{expect(()=>parseDigitsText('1, 2, 12')).toThrow();expect(parseDigitsText('1, 2, 9')).toEqual([1,2,9]);});
 it('calculates payout-aware expected value',()=>{expect(expectedValue(.5,1,1.8)).toBeCloseTo(.4);});
 it('walk-forward replay does not include future ticks in each history window',()=>{const r=walkForwardReplay(Array.from({length:120},(_,i)=>i%10),'EVEN',100,20);expect(r.trials).toBe(20);expect(r.wins).toBe(10);});
});

describe('Sentinel psychology constraints',()=>{
 it('keeps digit 1 forbidden in the Over framework and enforces strict barrier eligibility',()=>{const p=evaluatePsychology(Array.from({length:120},(_,i)=>i%10),'OVER',2);expect(p.forbiddenDigits).toEqual([1]);expect(p.eligibleDigits).toEqual([3,4,5,6,7,8,9]);});
 it('does not mark losing-side pressure or liquidity transition as validated by placeholder data',()=>{const p=evaluatePsychology(Array.from({length:120},(_,i)=>i%10),'UNDER',6);expect(p.losingSidePressure).toBe(100);expect(p.losingDigitsGaining).toBe(1);});
});
import {calibrationReport, conditionalReplay, crossContractDependencies, detectChangePoint, payoutAwareGate} from '@/sixfold/researchEngines';

describe('research engines',()=>{
 it('identifies even/odd as an exact complement pair',()=>{const rows=crossContractDependencies([0,1,2,3,4,5,6,7,8,9],[{side:'EVEN',barrier:0,label:'Even'},{side:'ODD',barrier:0,label:'Odd'}]);expect(rows[0].kind).toBe('EXACT_COMPLEMENT');expect(rows[0].correlation).toBeCloseTo(-1);});
 it('detects a strong change between separated windows',()=>{const ds=[...Array(50).fill(1),...Array(50).fill(9)];const r=detectChangePoint(ds,d=>d===9,50,2.5);expect(r.detected).toBe(true);expect(r.direction).toBe('UP');});
 it('calculates calibration scores for held-out predictions',()=>{const r=calibrationReport([.9,.1,.8,.2],[true,false,true,false]);expect(r.n).toBe(4);expect(r.brierScore).toBeCloseTo(.025);});
 it('keeps payout gate closed if any hard condition fails',()=>{const r=payoutAwareGate({probability:.95,stake:1,totalPayout:1.8,sampleSize:1000,psychologySupported:true,losingSidePressure:4,losingDigitsGaining:0,liquidityTransitionConfirmed:true,outOfSampleValidated:false});expect(r.decision).toBe('WAIT');expect(r.reasons.some(x=>x.includes('Out-of-sample'))).toBe(true);});
 it('supports trigger/control walk-forward cohorts',()=>{const ds=Array.from({length:140},(_,i)=>i%10);const r=conditionalReplay(ds,'EVEN',0,h=>h.at(-1)===8,100);expect(r.triggered+r.controlN).toBe(40);});
});

describe('replay uses the parameter of its own contract',()=>{
 const cycle=Array.from({length:220},(_,i)=>i%10);
 it('Under 2 wins on digits 0 and 1 only, so the win rate matches its 20% baseline (not 100%)',()=>{
  const r=walkForwardReplay(cycle,'UNDER',2,100,100);
  expect(r.trials).toBe(120);
  expect(r.baseline).toBeCloseTo(0.2);
  expect(r.winRate).toBeCloseTo(0.2);
  expect(r.lift).toBeCloseTo(1);
 });
 it('a barrier of 100 is not a real contract: it would win on every digit',()=>{
  expect(walkForwardReplay(cycle,'UNDER',100,100,100).winRate).toBe(1);
 });
 it('contractParameter picks the digit for Matches/Differs and the barrier for the rest',()=>{
  expect(contractParameter('MATCHES',2,5)).toBe(5);
  expect(contractParameter('DIFFERS',2,5)).toBe(5);
  for(const side of ['OVER','UNDER','EVEN','ODD'] as const) expect(contractParameter(side,2,5)).toBe(2);
 });
 it('Matches 5 replays at its 10% baseline',()=>{
  const r=walkForwardReplay(cycle,'MATCHES',contractParameter('MATCHES',2,5),100,100);
  expect(r.baseline).toBeCloseTo(0.1);
  expect(r.winRate).toBeCloseTo(0.1);
 });
});
