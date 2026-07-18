/* ==========================================================
   TOURNAMENT MODE — referee flow (pixel-styled like local mode).

   join (name + tournament code + passcode, validated by security
   rules) -> match list for the current stage -> live scorer that
   streams every point to Firestore. Stage / config changes made in
   the admin panel arrive live through the tournament listener.
   ========================================================== */
import { useEffect, useRef, useState } from 'react';
import { firebaseConfigured } from './firebase.js';
import * as api from './api.js';
import { stageName, stageConfig } from './schedule.js';
import TournamentScorer, { hasEngineState } from './TournamentScorer.jsx';
import { sfx } from '../lib/audio.js';
import { hap, buzz } from '../lib/haptics.js';
import { load, save, remove } from '../lib/storage.js';
import { PixelBall } from '../components/PixelBall.jsx';

const SESSION_KEY = 'pkl.tourney.ref';

const errMsg = (e) =>
  e.message === 'NOT_FOUND' ? '⚠ TOURNAMENT NOT FOUND' :
  e.message === 'BAD_PASSCODE' ? '⚠ WRONG PASSCODE' :
  '⚠ ' + (e.message || 'SOMETHING WENT WRONG');

export default function TournamentApp({ join = null }) {
  const [session, setSession] = useState(() => {
    const s = load(SESSION_KEY, null);
    // a QR join link for a DIFFERENT tournament overrides an old session
    if (s && join && join.tid.toUpperCase() !== String(s.tid).toUpperCase()) {
      remove(SESSION_KEY);
      return null;
    }
    return s;
  });

  if (!firebaseConfigured()) return <NotConfigured />;
  return session
    ? <Joined session={session} onLeave={() => { remove(SESSION_KEY); setSession(null); }} />
    : <Join join={join} onJoined={(s) => {
        save(SESSION_KEY, s);
        // drop the passcode-bearing QR link from the address bar
        if (window.location.hash.includes('/join/')) {
          window.history.replaceState(null, '', '#/tournament');
        }
        setSession(s);
      }} />;
}

function Shell({ children, title = 'TOURNAMENT MODE' }) {
  return (
    <div id="app">
      <section className="screen t-screen">
        <header className="setup-header">
          <div className="logo-row">
            <PixelBall size="lg" />
            <h1>PICKLE&nbsp;POINT</h1>
            <PixelBall size="lg" flip />
          </div>
          <p className="tagline">{title}</p>
          <div className="net-divider" aria-hidden="true" />
        </header>
        <div className="setup-body">{children}</div>
      </section>
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

function NotConfigured() {
  return (
    <Shell>
      <fieldset className="panel">
        <legend>SETUP NEEDED</legend>
        <p className="t-copy">
          TOURNAMENT MODE NEEDS A FIREBASE PROJECT. COPY <b>.env.example</b> TO{' '}
          <b>.env</b>, FILL IN YOUR FIREBASE WEB APP CONFIG, THEN REBUILD.
        </p>
        <button type="button" className="px-btn wide ghost" onClick={() => { window.location.hash = ''; }}>
          ◀ BACK TO LOCAL MODE
        </button>
      </fieldset>
    </Shell>
  );
}

/* ---------------------------------------------------------- join */
function Join({ join, onJoined }) {
  // a QR link carries the tournament + passcode: only the name is asked
  const viaQr = !!join;
  const [tid, setTid] = useState(join ? join.tid.toUpperCase() : '');
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState(join ? join.passcode : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    const t = tid.trim().toUpperCase(), n = name.trim().toUpperCase(), p = passcode.trim();
    if (!t || !n || !p) { setError('⚠ FILL IN ALL FIELDS'); sfx.error(); buzz([60, 40, 60]); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.checkInReferee(t, n, p);
      sfx.start(); hap.tap();
      onJoined({ tid: r.tid, name: n, uid: r.uid });
    } catch (e) {
      setError(errMsg(e)); sfx.error(); buzz([60, 40, 60]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="TOURNAMENT MODE · REFEREE CHECK-IN">
      <fieldset className="panel">
        <legend>CHECK IN</legend>
        {viaQr ? (
          <p className="t-copy">TOURNAMENT: <b>{tid}</b><br />PASSCODE FILLED IN FROM THE QR CODE — JUST ENTER YOUR NAME.</p>
        ) : (
          <label className="field">
            <span className="field-label">TOURNAMENT CODE</span>
            <input type="text" autoComplete="off" placeholder="CITY-OPEN-2026"
              autoCapitalize="characters" style={{ textTransform: 'uppercase' }}
              value={tid} onChange={(e) => setTid(e.target.value.toUpperCase())} />
          </label>
        )}
        <label className="field">
          <span className="field-label">YOUR NAME</span>
          <input type="text" maxLength={20} autoComplete="off" placeholder="JOHN DOE"
            value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
        </label>
        {!viaQr && (
          <label className="field">
            <span className="field-label">EVENT PASSCODE <span className="micro">(case sensitive)</span></span>
            <input type="text" autoComplete="off" placeholder="court123"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={passcode} onChange={(e) => setPasscode(e.target.value)} />
          </label>
        )}
        <button type="button" className="px-btn wide start-btn" disabled={busy} onClick={submit}>
          {busy ? 'CHECKING IN…' : '▶ CHECK IN'}
        </button>
        {error && <p className="setup-error">{error}</p>}
        <p className="micro dim t-copy">NO ACCOUNT NEEDED — YOU ARE SIGNED IN ANONYMOUSLY. THE PASSCODE COMES FROM THE ORGANIZER.</p>
      </fieldset>
      <button type="button" className="px-btn wide ghost" onClick={() => { window.location.hash = ''; }}>
        ◀ BACK TO LOCAL MODE
      </button>
      {tid.trim() && (
        <button type="button" className="px-btn wide ghost"
          onClick={() => window.open(`#/dashboard/${encodeURIComponent(tid.trim().toUpperCase())}`, '_blank', 'noopener')}>
          📺 OPEN LIVE DASHBOARD ↗
        </button>
      )}
    </Shell>
  );
}

/* ---------------------------------------------------------- joined */
function Joined({ session, onLeave }) {
  const { tid, uid, name } = session;
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    const off1 = api.watchTournament(tid, setTournament, (e) => setError(e.message));
    const off2 = api.watchMatches(tid, setMatches, (e) => setError(e.message));
    return () => { off1(); off2(); };
  }, [tid]);

  // auto-resume a match this referee already has live — ONCE per visit
  // (e.g. after a reload); afterwards "back to matches" stays on the list
  // and the referee re-enters via CONTINUE SCORING
  const autoResumed = useRef(false);
  useEffect(() => {
    if (autoResumed.current || !matches) return;
    autoResumed.current = true;
    const mine = matches.find((m) => m.status === 'live' && m.refereeId === uid);
    if (mine) setActiveId(mine.id);
  }, [matches, uid]);

  if (error) {
    return (
      <Shell>
        <fieldset className="panel"><legend>ERROR</legend>
          <p className="setup-error">⚠ {error}</p>
          <button type="button" className="px-btn wide ghost" onClick={onLeave}>SIGN OUT</button>
        </fieldset>
      </Shell>
    );
  }
  if (!tournament || !matches) return <Shell><p className="t-copy dim">CONNECTING…</p></Shell>;

  // the current stage's game config (falls back to tournament defaults)
  const config = stageConfig(tournament, tournament.currentStage);
  const active = activeId ? matches.find((m) => m.id === activeId) : null;

  // stay on the scorer while the match is live, and also right after it
  // completes (local engine state still present) so the winner overlay
  // isn't yanked away before the referee taps BACK TO MATCHES
  if (active && (active.status === 'live' || hasEngineState(active.id))) {
    return (
      <TournamentScorer
        key={active.id}
        tid={tid} doc={active} config={config}
        onExit={() => setActiveId(null)}
      />
    );
  }

  return (
    <MatchList
      tournament={tournament} matches={matches} config={config}
      uid={uid} name={name} tid={tid}
      onOpen={setActiveId} onLeave={onLeave}
    />
  );
}

/* ---------------------------------------------------------- match list */
function MatchList({ tournament, matches, config, uid, name, tid, onOpen, onLeave }) {
  const [claiming, setClaiming] = useState(null);   // match id pending confirm
  const [busy, setBusy] = useState(false);

  const stage = tournament.currentStage;
  const stageMatches = matches.filter((m) => m.stage === stage);
  const open = stageMatches.filter((m) => m.status !== 'completed');
  const done = stageMatches.filter((m) => m.status === 'completed');
  const courts = [...new Set(open.map((m) => m.court))].sort((a, b) => a - b);

  // teams currently on court (any stage) — their next match can't start yet
  const onCourt = new Set(matches
    .filter((m) => m.status === 'live')
    .flatMap((m) => [m.teamA, m.teamB]));
  const busyTeam = (m) =>
    onCourt.has(m.teamA) ? m.teamA : onCourt.has(m.teamB) ? m.teamB : null;

  const claim = async (m) => {
    setBusy(true);
    try {
      await api.claimMatch(tid, m.id, uid, name);
      sfx.start(); hap.tap();
      onOpen(m.id);
    } catch {
      sfx.error(); buzz([60, 40, 60]);
    } finally {
      setBusy(false); setClaiming(null);
    }
  };

  return (
    <Shell title={`${(tournament.name || tid).toUpperCase()} · ${stageName(tournament, stage).toUpperCase()}`}>
      <p className="t-copy dim">
        {(config.ruleset || 'rally').toUpperCase()} · PLAY TO {config.matchTo} · WIN BY {config.winBy}
        {config.scoring === 'points' ? '' : ` · ${config.minutes} MIN CAP`} ·
        REFEREE: {name} · <span className="t-live-dot" /> LIVE SYNC
      </p>

      {courts.map((c) => (
        <fieldset className="panel" key={c}>
          <legend>COURT {c}</legend>
          {open.filter((m) => m.court === c).map((m) => {
            const mine = m.refereeId === uid;
            const taken = m.status === 'live' && !mine;
            const waitingOn = m.status === 'scheduled' ? busyTeam(m) : null;
            return (
              <div className={`t-match ${m.status}${mine ? ' mine' : ''}`} key={m.id}>
                <div className="t-match-head">
                  <span className="t-match-note">{m.group ? `GROUP ${m.group}` : (m.note || m.id).toUpperCase()}</span>
                  <span className={`t-badge ${m.status}`}>
                    {m.status === 'live' ? `● LIVE ${m.scoreA}-${m.scoreB}` : 'SCHEDULED'}
                  </span>
                </div>
                <div className="t-match-teams">{m.teamA} <em>VS</em> {m.teamB}</div>
                {taken && <p className="micro dim">REFEREE: {m.refereeName}</p>}
                {mine && m.status === 'live' && (
                  <button type="button" className="px-btn wide" onClick={() => onOpen(m.id)}>▶ CONTINUE SCORING</button>
                )}
                {waitingOn && (
                  <p className="micro dim">⏳ WAITING — {waitingOn} IS STILL ON COURT</p>
                )}
                {m.status === 'scheduled' && !waitingOn && claiming !== m.id && (
                  <button type="button" className="px-btn wide ghost" disabled={busy}
                    onClick={() => { setClaiming(m.id); sfx.tap(); }}>
                    TAKE THIS MATCH
                  </button>
                )}
                {m.status === 'scheduled' && !waitingOn && claiming === m.id && (
                  <button type="button" className="px-btn wide start-btn" disabled={busy}
                    onClick={() => claim(m)}>
                    ✔ CONFIRM — I AM REFEREEING THIS
                  </button>
                )}
              </div>
            );
          })}
          {!open.filter((m) => m.court === c).length && <p className="micro dim">NO MATCHES LEFT ON THIS COURT</p>}
        </fieldset>
      ))}

      {!open.length && (
        <fieldset className="panel"><legend>ALL DONE</legend>
          <p className="t-copy">NO OPEN MATCHES IN THIS STAGE — WAIT FOR THE ORGANIZER TO ADVANCE THE STAGE.</p>
        </fieldset>
      )}
      {done.length > 0 && <p className="micro dim t-copy">{done.length} MATCH{done.length > 1 ? 'ES' : ''} COMPLETED THIS STAGE ✔</p>}

      <button type="button" className="px-btn wide ghost"
        onClick={() => window.open(`#/dashboard/${encodeURIComponent(tid)}`, '_blank', 'noopener')}>
        📺 LIVE DASHBOARD ↗
      </button>
      <button type="button" className="px-btn wide ghost" onClick={onLeave}>◀ SIGN OUT</button>
    </Shell>
  );
}
