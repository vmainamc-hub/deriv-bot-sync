// @ts-nocheck -- ported verbatim from original Sixfold source (written for non-strict index checks)
export type Tick = { quote: number; epoch: number; digit: number };
export type ContractSide = 'OVER'|'UNDER'|'EVEN'|'ODD'|'MATCHES'|'DIFFERS';
export type Decision = 'TRADE_CANDIDATE'|'WAIT'|'BLOCK';
export type Role = 'GREEN'|'SECOND_GREEN'|'RED'|'SECOND_RED'|'NEUTRAL';
export type Perspective = { side: ContractSide; barrier: number; observedRate: number; baselineRate: number; count: number; lift: number; role: Role; note: string };
export type EngineReport = { perspectives: Perspective[]; digitRates: number[]; pressure: number; liquidity: LiquidityReport; decision: Decision; reasons: string[]; n: number; lastDigit: number|null; warning: string };
export type LiquidityPhase = 'FORMING'|'ACCUMULATING'|'MATURING'|'EXHAUSTION_WATCH'|'TRANSITION'|'RELEASE'|'UNCONFIRMED';
export type LiquidityReport = { phase: LiquidityPhase; score: number; reservoirDigit: number|null; reservoirShare: number; pressureChange: number; concentration: number; streak: number; explanation: string; veto: boolean };

export const WINDOW_OPTIONS = [20,50,100,120,500,1000] as const;
export function digitFromQuote(quote:number, pipSize:number):number {
  const decimals = Math.max(0, Math.min(10, Math.trunc(pipSize)));
  const fixed = Number(quote).toFixed(decimals);
  const digits = fixed.replace(/\D/g,'');
  return Number(digits.at(-1) ?? 0);
}
export function tickFromQuote(quote:number, epoch:number, pipSize:number):Tick { return {quote, epoch, digit:digitFromQuote(quote,pipSize)}; }
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
function entropyConcentration(counts:number[],n:number):number {
  if (!n) return 0;
  const h=counts.reduce((sum,c)=>{if(!c)return sum;const p=c/n;return sum-p*Math.log(p)},0);
  return clamp(1-h/Math.log(10));
}
function longestTailStreak(ds:number[]):number {
  if(ds.length<2)return ds.length;
  const last=ds.at(-1)!; let n=0;
  for(let i=ds.length-1;i>=0&&ds[i]===last;i--)n++;
  return n;
}
function liquidityModel(ds:number[]):LiquidityReport {
  const n=ds.length, tail=ds.slice(-Math.min(100,n)), prev=ds.slice(-Math.min(200,n),-Math.min(100,n));
  const counts=Array(10).fill(0) as number[]; tail.forEach(d=>counts[d]++);
  const maxCount=Math.max(...counts), reservoirDigit=counts.indexOf(maxCount), reservoirShare=tail.length?maxCount/tail.length:0;
  const concentration=entropyConcentration(counts,tail.length);
  const prevCounts=Array(10).fill(0) as number[];prev.forEach(d=>prevCounts[d]++);
  const previousShare=prev.length?Math.max(...prevCounts)/prev.length:0;
  const pressureChange=reservoirShare-previousShare;
  const streak=longestTailStreak(ds);
  // This is a digit-structure proxy, NOT an observation of actual order-book liquidity.
  const score=Math.round(clamp(.42*clamp(reservoirShare/.22)+.25*clamp(Math.abs(pressureChange)/.10)+.18*clamp(streak/5)+.15*clamp(concentration/.25))*100);
  let phase:LiquidityPhase='FORMING';
  if(n<30) phase='UNCONFIRMED';
  else if(streak>=4&&pressureChange>-.03) phase='MATURING';
  else if(previousShare>.16&&pressureChange<-.07) phase='TRANSITION';
  else if(previousShare>.19&&pressureChange<-.045) phase='EXHAUSTION_WATCH';
  else if(concentration>.20&&pressureChange<0) phase='RELEASE';
  else if(reservoirShare>.17) phase='ACCUMULATING';
  const veto = n<100 || phase==='UNCONFIRMED' || phase==='EXHAUSTION_WATCH' || phase==='TRANSITION' || phase==='FORMING';
  const explanation = n<30 ? 'Insufficient history for a stable structure read.' : phase==='ACCUMULATING' ? 'A digit concentration is forming; no sweep or release is confirmed.' : phase==='MATURING' ? 'A short-run concentration persists. Persistence alone is not an edge.' : phase==='EXHAUSTION_WATCH' ? 'A prior concentration is weakening; require more post-transition observations.' : phase==='TRANSITION' ? 'Pressure is changing rapidly; block until the transition is independently validated.' : phase==='RELEASE' ? 'Concentration is easing. This is a structural proxy, not proof of liquidity or a reversal.' : 'Structure remains unconfirmed.';
  return {phase,score,reservoirDigit,reservoirShare,pressureChange,concentration,streak,explanation,veto};
}
function roleFor(side:ContractSide, barrier:number, digit:number, rates:number[]):Role {
  // Roles describe a relative rank inside the selected contract's eligible outcomes; they are not win/loss labels.
  const candidates=side==='OVER'?rates.map((_,d)=>d).filter(d=>d>barrier):side==='UNDER'?rates.map((_,d)=>d).filter(d=>d<barrier):side==='EVEN'?[0,2,4,6,8]:side==='ODD'?[1,3,5,7,9]:rates.map((_,d)=>d);
  if(!candidates.includes(digit))return 'NEUTRAL';
  const sorted=[...candidates].sort((a,b)=>rates[a]-rates[b]);
  const rank=sorted.indexOf(digit);
  if(rank===0)return 'RED'; if(rank===1)return 'SECOND_RED'; if(rank===sorted.length-1)return 'GREEN'; if(rank===sorted.length-2)return 'SECOND_GREEN'; return 'NEUTRAL';
}
export function analyzeDigits(input:number[], options:{window?:number;barrier?:number;selectedDigit?:number;minSample?:number}={}):EngineReport {
  const window=options.window??100, barrier=options.barrier??2, selected=options.selectedDigit??5, minSample=options.minSample??100;
  const ds=input.filter(d=>Number.isInteger(d)&&d>=0&&d<=9).slice(-window), n=ds.length;
  const counts=Array(10).fill(0) as number[]; ds.forEach(d=>counts[d]++);
  const rates=counts.map(c=>n?c/n:0);
  const rate=(xs:number[])=>xs.length?xs.reduce((s,d)=>s+counts[d],0)/(n*1||1):0;
  const sides: {side:ContractSide; barrier:number; eligible:number[]; baseline:number; note:string}[]=[
    {side:'OVER',barrier,eligible:Array.from({length:10},(_,d)=>d).filter(d=>d>barrier),baseline:(9-barrier)/10,note:`Terminal digit greater than ${barrier}; barrier digit itself loses.`},
    {side:'UNDER',barrier,eligible:Array.from({length:10},(_,d)=>d).filter(d=>d<barrier),baseline:barrier/10,note:`Terminal digit less than ${barrier}; barrier digit itself loses.`},
    {side:'EVEN',barrier:0,eligible:[0,2,4,6,8],baseline:.5,note:'Even digit; shares the same underlying digit distribution as Over/Under.'},
    {side:'ODD',barrier:0,eligible:[1,3,5,7,9],baseline:.5,note:'Odd digit; exact complement of Even.'},
    {side:'MATCHES',barrier:selected,eligible:[selected],baseline:.1,note:`Terminal digit equals ${selected}.`},
    {side:'DIFFERS',barrier:selected,eligible:Array.from({length:10},(_,d)=>d).filter(d=>d!==selected),baseline:.9,note:`Terminal digit differs from ${selected}; exact complement of Matches.`}
  ];
  const perspectives=sides.map(s=>{const observedRate=rate(s.eligible);return {side:s.side,barrier:s.barrier,observedRate,baselineRate:s.baseline,count:n, lift:s.baseline?observedRate/s.baseline:0,role:s.side==='MATCHES'?roleFor(s.side,selected,selected,rates):roleFor(s.side,s.barrier,ds.at(-1)??0,rates),note:s.note};});
  const liq=liquidityModel(ds), pressure=Math.round(clamp(entropyConcentration(counts,n)*2 + Math.abs(liq.pressureChange)*3)*100);
  const reasons:string[]=[];
  if(n<minSample)reasons.push(`Sample too small (${n}/${minSample} ticks required).`);
  if(liq.veto)reasons.push(`Liquidity-structure veto: ${liq.phase.toLowerCase().replaceAll('_',' ')}.`);
  const strongest=perspectives.some(p=>Math.abs(p.observedRate-p.baselineRate)>.08);
  if(!strongest)reasons.push('No sufficiently large observed-vs-baseline deviation.');
  if(n>=minSample&&strongest&&!liq.veto)reasons.push('Exploratory candidate only: still requires out-of-sample validation and payout-aware expected value.');
  const decision:Decision=n<minSample||liq.veto||!strongest?'WAIT':'TRADE_CANDIDATE';
  return {perspectives,digitRates:rates,pressure,liquidity:liq,decision,reasons,n,lastDigit:ds.at(-1)??null,warning:'Digit-history structure is descriptive, not proof of actual liquidity, trader positioning, or predictive edge. Do not treat this report as a trade instruction.'};
}
export function outcome(side:ContractSide,digit:number,barrier:number):boolean {
  switch(side){case 'OVER':return digit>barrier;case 'UNDER':return digit<barrier;case 'EVEN':return digit%2===0;case 'ODD':return digit%2===1;case 'MATCHES':return digit===barrier;case 'DIFFERS':return digit!==barrier;}
}
export function expectedValue(winProbability:number,stake:number,payout:number):number {
  // payout is total returned on a win; stake is lost on a loss.
  return winProbability*payout-(1-winProbability)*stake;
}
export function walkForwardReplay(digits:number[],side:ContractSide,barrier:number,minHistory=100,window=100):{trials:number;wins:number;winRate:number;baseline:number;lift:number;note:string} {
  let trials=0,wins=0;
  for(let i=Math.max(minHistory,window);i<digits.length;i++){
    const history=digits.slice(Math.max(0,i-window),i); // strictly prior to the outcome
    const report=analyzeDigits(history,{window,minSample:minHistory,barrier,selectedDigit:barrier});
    const p=report.perspectives.find(x=>x.side===side)!;
    const predicted=side==='OVER'||side==='UNDER'?p.observedRate:p.observedRate;
    // This baseline replay intentionally evaluates unconditional outcome rates; no fitting on the future tick.
    void predicted;
    trials++; if(outcome(side,digits[i],barrier))wins++;
  }
  const baseline=side==='OVER'?(9-barrier)/10:side==='UNDER'?barrier/10:side==='EVEN'||side==='ODD'?.5:side==='MATCHES'?.1:.9;
  const winRate=trials?wins/trials:0;
  return {trials,wins,winRate,baseline,lift:baseline?winRate/baseline:0,note:'Baseline-only walk-forward report. This does not prove the signal predicts outcomes; strategy evaluation must compare pre-registered conditional signals against this baseline on untouched data.'};
}
/** The number that parameterises a contract: the chosen digit for Matches/Differs, otherwise the Over/Under barrier. */
export const contractParameter=(side:ContractSide,barrier:number,selectedDigit:number):number=>side==='MATCHES'||side==='DIFFERS'?selectedDigit:barrier;
export function parseDigitsText(text:string):number[] {
  const vals=text.split(/[\s,;\n\r]+/).map(s=>s.trim()).filter(Boolean).map(Number);
  if(vals.some(n=>!Number.isInteger(n)||n<0||n>9))throw new Error('Import must contain only digits 0–9 separated by spaces, commas, or new lines.');
  return vals;
}
