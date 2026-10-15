import React, {useRef, useState} from 'react';
import {Radar, Trophy, ShieldAlert, FlaskConical} from 'lucide-react';
import {digitFromQuote} from './engine';
import {pickBest, realityCheck, scanMarket, SCAN_CONTRACTS, type MarketScan} from './scanner';
import {contractLabel} from './desk';

const HOSTS = ['wss://ws.derivws.com/websockets/v3?app_id=1089', 'wss://api.derivws.com/trading/v1/options/ws/public'];
const toDec = (v: any) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return 2; return n < 1 ? Math.round(-Math.log10(n)) : Math.round(n); };

function fetchAll(markets: readonly (readonly [string, string])[], onProgress: (done: number) => void, host = 0): Promise<Record<string, number[]>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HOSTS[host]!), out: Record<string, number[]> = {}, byReq: Record<number, string> = {};
    let done = 0;
    const finish = () => { try { ws.close(); } catch {} resolve(out); };
    const timer = setTimeout(finish, 30000);
    ws.onerror = () => { clearTimeout(timer); if (host + 1 < HOSTS.length && done === 0) fetchAll(markets, onProgress, host + 1).then(resolve, reject); else if (done) finish(); else reject(new Error('Could not reach Deriv.')); };
    ws.onopen = () => markets.forEach(([sym], i) => { byReq[i + 1] = sym; ws.send(JSON.stringify({ticks_history: sym, count: 1000, end: 'latest', style: 'ticks', req_id: i + 1})); });
    ws.onmessage = e => {
      const m = JSON.parse(e.data), sym = byReq[m.req_id]; if (!sym) return;
      if (m.history?.prices) { const dec = toDec(m.pip_size); out[sym] = m.history.prices.map((q: number) => digitFromQuote(Number(q), dec)); }
      done++; onProgress(done);
      if (done >= markets.length) { clearTimeout(timer); finish(); }
    };
  });
}

const cellColor = (s: number) => `hsl(${Math.round((Math.max(0, Math.min(100, s)) - 20) * 1.6)} 55% ${18 + s / 6}%)`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Scanner({markets, onOpen}: {markets: readonly (readonly [string, string])[]; onOpen: (symbol: string) => void}) {
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [err, setErr] = useState('');
  const [scans, setScans] = useState<MarketScan[]>([]), [at, setAt] = useState<string>('');
  const [check, setCheck] = useState<ReturnType<typeof realityCheck> | null>(null);
  const data = useRef<{symbol: string; name: string; digits: number[]}[]>([]);

  const scan = async () => {
    setBusy(true); setErr(''); setProgress(0); setCheck(null);
    try {
      const res = await fetchAll(markets, setProgress);
      data.current = markets.filter(([s]) => res[s]).map(([s, n]) => ({symbol: s, name: n, digits: res[s]!}));
      const out = data.current.map(d => scanMarket(d.symbol, d.name, d.digits));
      out.sort((a, b) => (b.best?.score ?? 0) - (a.best?.score ?? 0));
      setScans(out); setAt(new Date().toLocaleTimeString());
      if (!out.length) setErr('No market data came back. Try again.');
    } catch (e: any) { setErr(e.message || 'Scan failed.'); }
    setBusy(false);
  };
  const top = pickBest(scans), b = top?.best;

  return <div className="dk">
    <section className="panel sc-hero">
      <div><div className="eyebrow">MARKET SCANNER · OVER 1 2 3 / UNDER 8 7 6</div>
        <h2 className="dk-title">Find the strongest market right now</h2>
        <p className="dk-sub">Pulls the last 1000 ticks of every market and scores each contract on current performance, the DBot trade simulation, the six traders' psychology, stability and liquidity structure.</p></div>
      <button className="sc-scan" onClick={scan} disabled={busy}><Radar size={18}/>{busy ? `Scanning ${progress}/${markets.length}…` : 'Scan markets'}</button>
    </section>
    {err && <div className="notice"><ShieldAlert size={16}/> {err}</div>}

    {top && b && <section className="panel sc-top">
      <div className="sc-top-head"><Trophy size={22}/><div><div className="eyebrow">BEST MARKET · scanned {at}</div><div className="dk-title">{top.name} <span>· {b.label}</span></div></div>
        <span className={`sc-sig ${b.signal.toLowerCase()}`}>{b.signal}</span><span className="sc-big">{b.score}</span></div>
      <div className="sc-parts">{(Object.entries(b.parts) as [string, number][]).map(([k, v]) => <div key={k}><small>{k === 'bot' ? 'DBot simulation' : k === 'psychology' ? 'Six-trader psychology' : k === 'performance' ? 'Market performance' : k}</small><div className="dk-track"><i className={v >= 50 ? 'up' : 'down'} style={{width: `${v}%`}}/></div><b>{v}</b></div>)}</div>
      <div className="sc-facts">
        <span>Bot last 20: <b>{b.botWins20}/20 ({pct(b.bot20)})</b></span><span>Bot last 50: <b>{pct(b.bot50)}</b></span>
        <span>Last 100 ticks: <b>{pct(b.rate100)}</b> vs break-even {pct(b.breakEven)}</span>
        <span>Streak: <b>{b.streak.length} {b.streak.won ? 'wins' : 'losses'}</b></span><span>State: <b>{b.viability.toLowerCase()}</b></span><span>Liquidity: <b>{b.liquidityPhase.toLowerCase().replaceAll('_', ' ')}</b></span>
      </div>
      <p className="dk-sub">{b.crowdNote}</p>
      <div className="sc-crowds">{b.crowds.map(c => <span key={c.side} className={`dk-state ${c.state.toLowerCase()}`}>{c.label}: {c.state.toLowerCase()} · push {c.push}</span>)}</div>
      {b.reasons.length > 0 && <ul className="reason-list">{b.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
      <button className="link-btn" onClick={() => onOpen(top.symbol)}>Open {top.name} on the contract desk →</button>
    </section>}

    {scans.length > 0 && <section className="panel">
      <div className="eyebrow">ALL MARKETS</div><h3>Signal heat map</h3>
      <p className="dk-sub">Score 0–100 per contract. Bright outline = GO. Click a cell to open that market on the desk.</p>
      <div className="sc-grid"><span/>{SCAN_CONTRACTS.map(c => <small key={c.side + c.param}>{contractLabel(c.side, c.param)}</small>)}
        {scans.map(s => <React.Fragment key={s.symbol}><div className="sc-name">{s.name}<small>{s.n} ticks</small></div>
          {s.contracts.length ? s.contracts.map(c => <button key={c.label} title={`${c.label}: bot ${pct(c.bot20)} last 20 · ${c.crowdNote}`} className={`sc-cell ${c.signal.toLowerCase()} ${s === top && c === b ? 'top' : ''}`} style={{background: cellColor(c.score)}} onClick={() => onOpen(s.symbol)}>{c.score}</button>) : SCAN_CONTRACTS.map((_, i) => <span key={i} className="sc-cell">–</span>)}
        </React.Fragment>)}</div>
    </section>}

    {scans.length > 0 && <section className="panel">
      <div className="sc-top-head"><FlaskConical size={18}/><div><div className="eyebrow">REALITY CHECK</div><h3>Is the scanner finding something, or just the best of a noisy pile?</h3></div>
        <button className="sc-scan small" onClick={() => setCheck(realityCheck(data.current))}>Run check</button></div>
      <p className="dk-sub">Re-runs the same scan with each market's digit order shuffled — same digit mix, no real pattern.</p>
      {check && <><div className="sc-facts"><span>GO on your data: <b>{check.realGo}</b></span><span>GO on shuffled: <b>{check.shuffledGo.toFixed(1)}</b></span><span>WATCH real / shuffled: <b>{check.realWatch} / {check.shuffledWatch.toFixed(1)}</b></span></div>
        <p>{check.realGo > check.shuffledGo * 1.5 + 1 ? 'Your data shows clearly more GO signals than shuffled noise — worth a closer look on the desk.' : 'Your data shows about as many GO signals as shuffled noise. A GO here is not evidence of an edge.'}</p></>}
      <div className="notice"><ShieldAlert size={16}/> The scanner always names a best market, but the six traders' "psychology" is inferred from digits, not observed. Deriv digits are designed to be close to random — use the pick as a shortlist and keep stakes you can afford to lose.</div>
    </section>}
  </div>;
}
