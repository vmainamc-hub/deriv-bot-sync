// @ts-nocheck -- ported verbatim from original Sixfold source (written for non-strict index checks)
import React, {useMemo, useState} from 'react';
import {AlertTriangle, ChevronDown, CircleDot, GitCompareArrows, ShieldAlert, Users} from 'lucide-react';
import type {ContractSide} from './engine';
import {ALL_SIDES, baselineRate, botSummary, breakEven, contractLabel, contractState, crowdMap, deskBacktests, relationToCrowd, siblings, simulateDbot, usesParam, type Viability, type CrowdState} from './desk';

type Props = {
  ticks: {digit: number; epoch: number; seq?: number}[]; digits: number[]; market: string; markets: readonly (readonly [string, string])[]; onMarket: (m: string) => void;
  status: string; feedMode: string; onConnect: () => void; onDemo: () => void;
};
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const VIA: Record<Viability, string> = {VIABLE: 'viable', UNSTABLE: 'unstable', COLD: 'cold', SKEWED: 'skewed', THIN: 'thin', INVALID: 'thin'};
const CROWD_TXT: Record<CrowdState, string> = {LOADING: 'LOADING UP', TRAPPED: 'TRAPPED', RELIEVED: 'PAID OFF', IDLE: 'NO CROWD'};
const validParams = (s: ContractSide) => s === 'OVER' ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : s === 'UNDER' ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const VERDICT: Record<string, string> = {EDGE_FOUND: 'EDGE FOUND', NO_EDGE: 'NO EDGE', WORSE_THAN_ODDS: 'WORSE THAN ODDS', TOO_FEW: 'TOO FEW SIGNALS'};

export function ContractDesk({ticks, digits, market, markets, onMarket, status, feedMode, onConnect, onDemo}: Props) {
  const [side, setSide] = useState<ContractSide>('OVER'), [param, setParam] = useState(2), [flip, setFlip] = useState(0), [gap, setGap] = useState(1);
  const marketLabel = markets.find(m => m[0] === market)?.[1] ?? market;
  const pickSide = (s: ContractSide) => { setSide(s); if (usesParam(s) && !validParams(s).includes(param)) setParam(s === 'UNDER' ? 6 : 2); };
  const overBarrier = side === 'OVER' ? param : side === 'UNDER' ? param - 1 : 4;
  const base = baselineRate(side, param), be = breakEven(base);

  const state = useMemo(() => contractState(digits, side, param), [digits, side, param]);
  const sim = useMemo(() => simulateDbot(ticks.map((t, i) => ({digit: t.digit, epoch: t.epoch, seq: t.seq ?? i})), side, param, gap, flip), [ticks, side, param, gap, flip]);
  const trades = sim.trades;
  const fmt = (e: number) => new Date(e * 1000).toLocaleTimeString([], {hour12: false});
  const bot = useMemo(() => botSummary(trades, base), [trades, base]);
  const sibs = useMemo(() => siblings(digits, side, param), [digits, side, param]);
  const crowds = useMemo(() => crowdMap(digits, {overBarrier}), [digits, overBarrier]);
  const rel = useMemo(() => relationToCrowd(crowds, side, param), [crowds, side, param]);
  const tests = useMemo(() => deskBacktests(digits, side, param, overBarrier), [digits, side, param, overBarrier]);
  const dominant = [...crowds].sort((a, b) => b.push - a.push)[0];
  const w100 = state.windows.find(w => w.window === 100);
  const groups = side === 'OVER' || side === 'UNDER' ? [['OVER', 'Over family'], ['UNDER', 'Under family']] : side === 'EVEN' || side === 'ODD' ? [[side, 'Even vs Odd']] : [[side, `${contractLabel(side, 0).split(' ')[0]} by digit`]];

  return <div className="dk">
    <section className="panel dk-pick">
      <div className="dk-pick-row">
        <div className="control"><label>MARKET</label><div className="select-wrap"><select value={market} onChange={e => onMarket(e.target.value)}>{markets.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select><ChevronDown size={14}/></div></div>
        <div className="control"><label>CONTRACT</label><div className="dk-sides">{ALL_SIDES.map(s => <button key={s} className={side === s ? 'selected' : ''} onClick={() => pickSide(s)}>{s}</button>)}</div></div>
        {usesParam(side) && <div className="control compact"><label>{side === 'OVER' || side === 'UNDER' ? 'BARRIER' : 'DIGIT'}</label><select value={param} onChange={e => setParam(Number(e.target.value))}>{validParams(side).map(n => <option key={n} value={n}>{n}</option>)}</select></div>}
      </div>
      {digits.length === 0 && <div className="notice"><AlertTriangle size={16}/><span>No ticks yet ({status === 'connecting' ? 'connecting…' : feedMode === 'demo' ? 'demo' : status}). <button className="link-btn" onClick={onConnect}>Connect live</button> or <button className="link-btn" onClick={onDemo}>use a demo stream</button>.</span></div>}
    </section>

    <section className="panel dk-hero">
      <div><div className="eyebrow">CONTRACT DESK</div><h2 className="dk-title">{contractLabel(side, param).toUpperCase()} <span>· {marketLabel}</span></h2><p className="dk-sub">{state.headline}</p>
        <ul className="reason-list">{state.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
      <div className="dk-hero-side">
        <span className={`dk-pill ${VIA[state.viability]}`}>{state.viability}</span>
        <div className="dk-kpis"><div><small>Win rate · 100 ticks</small><b>{w100 ? pct(w100.rate) : '—'}</b></div><div><small>Baseline</small><b>{pct(base)}</b></div><div><small>Break-even*</small><b>{pct(be, 1)}</b></div></div>
        <div className={`dk-relation ${rel.relation.toLowerCase()}`}><Users size={15}/>{rel.relation === 'WITH_CROWD' ? `You'd be WITH the ${rel.crowd?.label} crowd` : rel.relation === 'AGAINST_CROWD' ? `You'd be AGAINST the ${rel.crowd?.label} crowd` : 'No pushed crowd is on either side of this contract'}</div>
      </div>
    </section>

    <div className="two-col">
      <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">01 / SIMULATED BOT</div><h2>Last 20 trades</h2><p>DBot-style: each trade opens on a fresh tick and settles on the next one. The settlement tick is never reused; {gap === 0 ? 'the next trade opens on the very next tick' : `${gap} tick${gap > 1 ? 's' : ''} pass while the next buy is placed`}. One trade every {2 + gap} ticks.</p></div>
          <div style={{display:'flex',gap:8}}><select value={gap} onChange={e => setGap(Number(e.target.value))} title="Ticks skipped between settlement and the next buy"><option value={0}>No buy delay</option><option value={1}>1-tick buy delay</option><option value={2}>2-tick buy delay</option></select><button className="btn subtle" onClick={() => setFlip(f => (f + 1) % (2 + gap))} title="Shift which tick the bot starts on"><GitCompareArrows size={14}/> Shift start</button></div></div>
        <div className="dk-trades">{bot.last20.map((t, i) => <div key={t.n} className={`dk-trade ${t.won ? 'w' : 'l'} ${i === bot.last20.length - 1 ? 'latest' : ''}`} title={`Trade ${t.n}: opened ${fmt(t.entryEpoch)} on ${t.entry} → settled ${fmt(t.exitEpoch)} on ${t.exit}`}><b>{t.won ? 'W' : 'L'}</b><small>{t.entry}→{t.exit}</small></div>)}{sim.open && <div className="dk-trade latest" title={`Open since ${fmt(sim.open.entryEpoch)}`}><b>…</b><small>{sim.open.entry}→?</small></div>}</div>
        <div className="mini-stats"><div><small>Last 20</small><b>{bot.wins20}W · {bot.last20.length - bot.wins20}L</b></div><div><small>Last 50 win rate</small><b>{pct(bot.rate50)}</b></div><div><small>Now</small><b>{bot.streak.length} {bot.streak.won ? 'wins' : 'losses'}</b></div><div><small>Longest loss run (50)</small><b>{bot.longestLoss50} <em>exp ≈{bot.expectedLongestLoss50.toFixed(1)}</em></b></div></div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">02 / CONTRACT STATE</div><h2>Where this contract is now</h2><p>Every tick counted. Marks: baseline ┆ break-even.</p></div></div>
        <div className="dk-windows">{state.windows.map(w => <div className="dk-win" key={w.window}><span>{w.window}</span>
          <div className="dk-track"><i style={{width: pct(w.rate)}} className={w.rate >= w.breakEven ? 'up' : 'down'}/><u style={{left: pct(w.baseline)}}/><u className="be" style={{left: pct(w.breakEven)}}/></div>
          <b>{pct(w.rate)}</b><em className={Math.abs(w.z) >= 2 ? 'hot' : ''}>{w.z >= 0 ? '+' : ''}{w.z.toFixed(1)}σ</em></div>)}</div>
      </section>
    </div>

    <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">03 / SIBLINGS</div><h2>How neighbouring contracts compare</h2><p>Last 100 ticks. Edge = win rate minus break-even. The ★ is simply the best of many; picking the best of many always flatters it.</p></div></div>
      <div className="dk-sibs">{groups.map(([s, title]) => <div key={s}><div className="dk-sib-title">{title}</div>{sibs.filter(r => r.side === s).map(r => <div key={r.label} className={`dk-sib ${r.selected ? 'sel' : ''}`}><b>{r.label}</b><span>{pct(r.rate)}<small> / {pct(r.baseline)}</small></span><em className={r.edge >= 0 ? 'pos' : 'neg'}>{r.edge >= 0 ? '+' : ''}{(r.edge * 100).toFixed(1)}pp</em><i className={`dk-dot ${VIA[r.viability]}`} title={r.viability}/>{r.best && <strong title="best edge right now">★</strong>}</div>)}</div>)}</div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">04 / CROWD MAP</div><h2>Where the six crowds probably are</h2><p>{dominant && dominant.push >= 40 ? `Strongest push: ${dominant.label} (${dominant.push}/100), ${CROWD_TXT[dominant.state].toLowerCase()}.` : 'No crowd is strongly pushed right now.'} Inferred from digits only; real positions are not visible.</p></div></div>
      <div className="contract-grid">{crowds.map(c => <div key={c.side} className={`contract-card dk-crowd ${c.state.toLowerCase()}`}>
        <div className="contract-top"><span className="contract-icon"><CircleDot/></span><div><b>{c.label} crowd</b><small>{c.note}</small></div></div>
        <div className="rate-row"><strong>{c.push}<small>/100 push</small></strong><span className={`dk-state ${c.state.toLowerCase()}`}>{CROWD_TXT[c.state]}</span></div>
        <div className="bar-track"><div className="bar-fill" style={{width: `${c.push}%`}}/></div>
        <div className="contract-foot"><span>shown {pct(c.shownRate)} → delivered {pct(c.deliveredRate)}</span><span>{c.counter ? `opposite: ${c.counter.label}` : 'n/a'}</span></div></div>)}</div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">05 / COUNTER-CROWD BACK-TEST</div><h2>Has trading against the crowd beaten the odds?</h2><p>Walk-forward over your loaded ticks. Each signal uses only earlier ticks; trades never overlap; ROI uses the assumed margin.</p></div></div>
      <div className="dk-bt"><div className="dk-bt-head"><span>Rule</span><span>Trades</span><span>Win %</span><span>Odds %</span><span>σ</span><span>ROI</span><span>Verdict</span></div>
        {tests.map(t => <div className="dk-bt-row" key={t.name}><span>{t.name}<small>{t.trades ? `1st half ${pct(t.first.rate)} vs ${pct(t.first.expected)} · 2nd half ${pct(t.second.rate)} vs ${pct(t.second.expected)}` : t.note}</small></span><span>{t.trades}</span><span>{pct(t.rate, 1)}</span><span>{pct(t.expected, 1)}</span><span>{t.z >= 0 ? '+' : ''}{t.z.toFixed(1)}</span><span className={t.roi >= 0 ? 'pos' : 'neg'}>{(t.roi * 100).toFixed(1)}%</span><span className={`dk-verdict ${t.verdict.toLowerCase()}`}>{VERDICT[t.verdict]}</span></div>)}</div>
      <div className="notice large"><ShieldAlert size={18}/><div><b>Read this before trusting a green result</b><p>Deriv's synthetic indices are generated by a random number process, and digits are designed to be close to uniform and independent, so a crowd model has little to find in them. Four rules tested on a few hundred ticks will throw up a false winner now and then. Treat EDGE FOUND as "worth re-testing on fresh ticks", never as a green light. *Break-even assumes a ~3.5% built-in margin; check the real payout on Deriv.</p></div></div>
    </section>
  </div>;
}
