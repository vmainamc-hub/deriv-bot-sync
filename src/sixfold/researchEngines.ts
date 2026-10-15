// @ts-nocheck -- ported verbatim from original Sixfold source (written for non-strict index checks)
import {outcome, type ContractSide, type Decision} from './engine';

export type ContractSpec={side:ContractSide;barrier:number;label:string};
export type DependencyRow={a:ContractSide;b:ContractSide;agreement:number;correlation:number;kind:'EXACT_COMPLEMENT'|'OVERLAP'|'PARTIAL_DEPENDENCY'};
export type ChangePointReport={detected:boolean;score:number;beforeRate:number;afterRate:number;direction:'UP'|'DOWN'|'FLAT';nBefore:number;nAfter:number;note:string};
export type CalibrationBin={from:number;to:number;meanForecast:number;observedRate:number;count:number};
export type CalibrationReport={brierScore:number|null;logLoss:number|null;ece:number|null;bins:CalibrationBin[];n:number;note:string};
export type PayoutGate={decision:Decision;probability:number|null;breakEven:number|null;expectedProfit:number|null;edge:number|null;reasons:string[]};
export type SignalAudit={id:string;epoch:number;market:string;side:ContractSide;barrier:number;window:number;sampleSize:number;features:Record<string,number|string|boolean>;ruleVersion:string;forecastProbability:number|null;stake:number|null;totalPayout:number|null;decision:Decision;outcome:boolean|null;note:string};

const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const variance=(xs:number[])=>{if(xs.length<2)return 0;const m=mean(xs);return xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1)};

/** Same-stream contract dependencies. Correlation is descriptive and does not imply causation. */
export function crossContractDependencies(digits:number[],specs:ContractSpec[]):DependencyRow[]{
 const rows:DependencyRow[]=[];
 for(let i=0;i<specs.length;i++)for(let j=i+1;j<specs.length;j++){
  const a=specs[i],b=specs[j],av=digits.map(d=>outcome(a.side,d,a.barrier)?1:0),bv=digits.map(d=>outcome(b.side,d,b.barrier)?1:0);
  const ma=mean(av),mb=mean(bv),va=variance(av),vb=variance(bv);let cov=0;
  for(let k=0;k<av.length;k++)cov+=(av[k]-ma)*(bv[k]-mb);
  const corr=va&&vb?cov/Math.max(1,av.length-1)/Math.sqrt(va*vb):0;
  const exact=(a.side==='EVEN'&&b.side==='ODD')||(a.side==='ODD'&&b.side==='EVEN')||(a.side==='MATCHES'&&b.side==='DIFFERS'&&a.barrier===b.barrier)||(a.side==='DIFFERS'&&b.side==='MATCHES'&&a.barrier===b.barrier);
  const agreement=av.length?av.filter((v,k)=>v===bv[k]).length/av.length:0;
  rows.push({a:a.side,b:b.side,agreement,correlation:corr,kind:exact?'EXACT_COMPLEMENT':Math.abs(corr)>.65?'OVERLAP':'PARTIAL_DEPENDENCY'});
 }
 return rows;
}

/** Non-anticipating two-window change detector. Threshold is a screening statistic, not a significance claim. */
export function detectChangePoint(digits:number[],predicate:(digit:number)=>boolean,window=50,threshold=2.5):ChangePointReport{
 const clean=digits.filter(d=>Number.isInteger(d)&&d>=0&&d<=9),split=clean.length-window*2;
 if(split<0)return {detected:false,score:0,beforeRate:0,afterRate:0,direction:'FLAT',nBefore:Math.max(0,split+window),nAfter:clean.length,note:'Need two complete windows before change screening.'};
 const before=clean.slice(-2*window,-window).map(d=>predicate(d)?1:0),after=clean.slice(-window).map(d=>predicate(d)?1:0);
 const p0=mean(before),p1=mean(after),pooled=mean([...before,...after]);
 const se=Math.sqrt(Math.max(1e-9,pooled*(1-pooled)*(1/before.length+1/after.length)));
 const score=(p1-p0)/se;
 return {detected:Math.abs(score)>=threshold,score,beforeRate:p0,afterRate:p1,direction:score>.15?'UP':score<-.15?'DOWN':'FLAT',nBefore:before.length,nAfter:after.length,note:'Two-window z-style screen. Repeated scans require multiplicity controls and independent confirmation.'};
}

/** Evaluate a pre-registered binary probability forecast on outcomes that were not used to fit it. */
export function calibrationReport(forecasts:number[],outcomes:boolean[],binCount=10):CalibrationReport{
 const n=Math.min(forecasts.length,outcomes.length);if(!n)return {brierScore:null,logLoss:null,ece:null,bins:[],n:0,note:'No paired forecasts/outcomes.'};
 const ps=forecasts.slice(0,n).map(p=>clamp(p,1e-6,1-1e-6)),ys=outcomes.slice(0,n).map(y=>y?1:0);
 const brier=mean(ps.map((p,i)=>(p-ys[i])**2)),logLoss=mean(ps.map((p,i)=>-(ys[i]*Math.log(p)+(1-ys[i])*Math.log(1-p))));
 const bins:CalibrationBin[]=[];let ece=0;
 for(let b=0;b<binCount;b++){const from=b/binCount,to=(b+1)/binCount,idx=ps.map((p,i)=>({p,y:ys[i]})).filter(x=>x.p>=from&&(b===binCount-1?x.p<=to:x.p<to));if(!idx.length)continue;const f=mean(idx.map(x=>x.p)),o=mean(idx.map(x=>x.y));ece+=idx.length/n*Math.abs(f-o);bins.push({from,to,meanForecast:f,observedRate:o,count:idx.length});}
 return {brierScore:brier,logLoss,ece,bins,n,note:'Calibration is meaningful only for forecasts produced without training on these outcomes and evaluated on a chronologically held-out sample.'};
}

/** Hard-gated payout math. totalPayout is the total amount returned including stake on a win. */
export function payoutAwareGate(input:{probability:number|null;stake:number;totalPayout:number;sampleSize:number;minimumSample?:number;psychologySupported:boolean;losingSidePressure:number;losingDigitsGaining:number;liquidityTransitionConfirmed:boolean;outOfSampleValidated:boolean;minimumEdge?:number}):PayoutGate{
 const reasons:string[]=[],min=input.minimumSample??500,edgeMin=input.minimumEdge??.02;
 if(input.probability===null||!Number.isFinite(input.probability)||input.probability<0||input.probability>1)reasons.push('No valid calibrated probability.');
 if(input.sampleSize<min)reasons.push(`Insufficient independent validation sample (${input.sampleSize}/${min}).`);
 if(!input.psychologySupported)reasons.push('Contract-specific psychology does not support the candidate.');
 if(input.losingSidePressure>=10)reasons.push('Losing-side pressure must be below 10.');
 if(input.losingDigitsGaining!==0)reasons.push('At least one losing-side digit is still gaining or unverified.');
 if(!input.liquidityTransitionConfirmed)reasons.push('Liquidity exhaustion/transition is not confirmed.');
 if(!input.outOfSampleValidated)reasons.push('Out-of-sample predictive edge has not been validated.');
 const p=input.probability,stake=input.stake,payout=input.totalPayout;
 const breakEven=(stake+payout)>0?stake/(stake+payout):null;
 const expectedProfit=p===null?null:p*payout-(1-p)*stake;
 const edge=breakEven===null||p===null?null:p-breakEven;
 if(edge===null||edge<edgeMin)reasons.push(`Estimated probability edge is below the ${Math.round(edgeMin*100)} percentage-point minimum.`);
 if(!(stake>0&&payout>stake))reasons.push('Stake/payout terms are invalid or do not provide a positive win profit.');
 const decision=reasons.length?'WAIT':'TRADE_CANDIDATE';
 return {decision,probability:p,breakEven,expectedProfit,edge,reasons};
}

/** Replay a user-defined, pre-registered trigger using only preceding ticks. */
export function conditionalReplay(digits:number[],side:ContractSide,barrier:number,trigger:(history:number[])=>boolean,minHistory=100,maxWindow=1000){
 let triggered=0,wins=0,controlN=0,controlWins=0;
 for(let i=minHistory;i<digits.length;i++){
  const history=digits.slice(Math.max(0,i-maxWindow),i),won=outcome(side,digits[i],barrier);
  if(trigger(history)){triggered++;if(won)wins++;}else{controlN++;if(won)controlWins++;}
 }
 const rate=(w:number,n:number)=>n?w/n:null,signalRate=rate(wins,triggered),controlRate=rate(controlWins,controlN);
 return {triggered,wins,signalRate,controlN,controlWins,controlRate,lift:signalRate!==null&&controlRate!==null&&controlRate>0?signalRate/controlRate:null,absoluteLift:signalRate!==null&&controlRate!==null?signalRate-controlRate:null,note:'This replay is exploratory. Freeze the trigger before testing, use chronological holdouts, and quantify uncertainty before interpreting lift.'};
}
