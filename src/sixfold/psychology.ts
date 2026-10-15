// @ts-nocheck -- ported verbatim from original Sixfold source (written for non-strict index checks)
import type {ContractSide, Role} from './engine';

export type PsychologySignal = {
  side: ContractSide;
  barrierOrDigit: number;
  red: number[];
  secondRed: number[];
  secondGreen: number[];
  green: number[];
  eligibleDigits: number[];
  forbiddenDigits: number[];
  pressure: number;
  losingSidePressure: number;
  losingDigitsGaining: number;
  supported: boolean;
  reasons: string[];
};

/**
 * Configurable interpretation of the user's Sentinel role framework.
 * Roles are relative frequency positions inside a contract-specific eligible set;
 * they are not universal win/loss labels or evidence of other traders' positions.
 */
export function evaluatePsychology(digits:number[], side:ContractSide, barrierOrDigit:number):PsychologySignal {
  const valid=digits.filter(d=>Number.isInteger(d)&&d>=0&&d<=9);
  const counts=Array(10).fill(0) as number[]; valid.forEach(d=>counts[d]++);
  const eligible=side==='OVER'?Array.from({length:10},(_,d)=>d).filter(d=>d>barrierOrDigit):
    side==='UNDER'?Array.from({length:10},(_,d)=>d).filter(d=>d<barrierOrDigit):
    side==='EVEN'?[0,2,4,6,8]:side==='ODD'?[1,3,5,7,9]:side==='MATCHES'?[barrierOrDigit]:Array.from({length:10},(_,d)=>d).filter(d=>d!==barrierOrDigit);
  const roleUniverse=side==='OVER'?[3,5,7,9].filter(d=>eligible.includes(d)):side==='UNDER'?[0,2,4,6,8].filter(d=>eligible.includes(d)):eligible;
  const roleDigits=[...(roleUniverse.length?roleUniverse:eligible)].sort((a,b)=>counts[a]-counts[b]);
  const red=roleDigits.slice(0,1),secondRed=roleDigits.slice(1,2),green=roleDigits.slice(-1),secondGreen=roleDigits.slice(-2,-1);
  // Preserve the user's explicitly stated Over psychology: digit 1 is forbidden and preferred
  // RED/SECOND RED candidates are odd digits in the winning zone (3/5/7/9). Under uses the
  // opposite parity family as a research hypothesis, still subject to strict barrier eligibility.
  const preferred=side==='OVER'?[3,5,7,9].filter(d=>eligible.includes(d)):side==='UNDER'?[0,2,4,6,8].filter(d=>eligible.includes(d)):
    side==='EVEN'?[0,2,4,6,8]:side==='ODD'?[1,3,5,7,9]:side==='MATCHES'?[barrierOrDigit]:Array.from({length:10},(_,d)=>d).filter(d=>d!==barrierOrDigit);
  const forbidden=side==='OVER'?[1]:[];
  const reasons:string[]=[];
  if(valid.length<100)reasons.push('Psychology support requires at least 100 prior digits in the research prototype.');
  if(!preferred.length)reasons.push('No preferred candidate is eligible under the current contract barrier.');
  if(side==='OVER'&&barrierOrDigit>=9)reasons.push('OVER has no winning digit at this barrier.');
  if(side==='UNDER'&&barrierOrDigit<=0)reasons.push('UNDER has no winning digit at this barrier.');
  const preferredShare=valid.length?preferred.reduce((s,d)=>s+counts[d],0)/valid.length:0;
  const baselineShare=valid.length?preferred.length/10:0;
  const supported=valid.length>=100&&preferred.length>0&&preferredShare>=baselineShare;
  if(!supported&&valid.length>=100)reasons.push('Observed preferred-family frequency does not currently support the hypothesis; this is descriptive, not predictive evidence.');
  // These fields are placeholders until the dedicated state-transition estimator is validated.
  // They intentionally cannot pass the final hard gate by default.
  return {side,barrierOrDigit,red,secondRed,secondGreen,green,eligibleDigits:eligible,forbiddenDigits:forbidden,pressure:Math.round(Math.min(100,Math.abs(preferredShare-baselineShare)*500)),losingSidePressure:100,losingDigitsGaining:1,supported,reasons};
}

export function roleForDigit(signal:PsychologySignal,digit:number):Role {
  if(signal.red.includes(digit))return 'RED';
  if(signal.secondRed.includes(digit))return 'SECOND_RED';
  if(signal.green.includes(digit))return 'GREEN';
  if(signal.secondGreen.includes(digit))return 'SECOND_GREEN';
  return 'NEUTRAL';
}
