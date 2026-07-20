/* ==========================================================
   Tournament scorer = the LOCAL-MODE court, Firestore-synced.

   Reuses the pure rules engine (lib/rules.js) and the full court
   UI (components/CourtScreen.jsx — serve tracking, court positions,
   timer, undo, fx) by providing the same store context CourtScreen
   already consumes (AppCtx), with actions that publish every score
   change to Firestore.

   Games run as TIMED (the 10-min cap) with a points cap on top
   (first to matchTo, win by winBy) — whichever comes first ends the
   game; a tie at time-up goes to engine sudden death, so knockout
   games can never end tied.

   The in-progress engine state (serve rotation, undo history, clock)
   lives in localStorage per tournament match, so a page reload on
   court resumes exactly where the referee left off.
   ========================================================== */
import { useEffect, useRef, useState } from 'react';
import { AppCtx, playFx } from '../store/AppStore.jsx';
import { CourtScreen } from '../components/CourtScreen.jsx';
import * as rules from '../lib/rules.js';
import * as api from './api.js';
import { LS, load, save, remove } from '../lib/storage.js';
import { sfx, setSoundEnabled } from '../lib/audio.js';
import { hap, buzz, setHapticEnabled } from '../lib/haptics.js';
import { PixelBall } from '../components/PixelBall.jsx';

const engineKey = (mid) => `pkl.tourney.engine.${mid}`;

/* does this device hold in-progress engine state for a tournament match? */
export const hasEngineState = (mid) => !!load(engineKey(mid), null);

/* "Smith/Jones" -> doubles roster; a plain name plays as singles */
const mkTeam = (id, name) => {
  const players = name.split('/').map((s) => s.trim()).filter(Boolean);
  return { id, name, players: players.length >= 2 ? players.slice(0, 2) : [name] };
};

const matchLabel = (doc) =>
  doc.group ? `GROUP ${doc.group}` : (doc.note || doc.stage || 'MATCH').toUpperCase();

export default function TournamentScorer({ tid, doc, config, onExit }) {
  // resume the engine state for this tournament match, paused
  // (time spent away from the page doesn't burn the game clock)
  const [m, setM] = useState(() => {
    const saved = rules.migrateMatch(load(engineKey(doc.id), null));
    if (saved && !saved.finished) { saved.paused = true; saved.elapsed = saved.elapsed || 0; }
    return saved;
  });
  const [fx, setFx] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  // honor the sound/haptics prefs saved by local mode
  useEffect(() => {
    const prefs = { sound: true, haptic: true, ...load(LS.prefs, {}) };
    setSoundEnabled(prefs.sound);
    setHapticEnabled(prefs.haptic);
  }, []);

  /* persist the engine state and stream score changes to Firestore.
     Writes are fire-and-forget: offline they queue in the local cache
     and sync when signal returns, and the UI never blocks on them. */
  const pushedSig = useRef(null);
  useEffect(() => {
    if (!m) return;
    save(engineKey(doc.id), m);
    const sig = `${m.score.A}-${m.score.B}-${m.finished}`;
    if (pushedSig.current === sig) return;
    pushedSig.current = sig;
    if (m.finished) {
      api.completeMatch(tid, doc.id, m.score.A, m.score.B, m.winner, m.finishHow).catch(console.warn);
    } else if (doc.status === 'completed') {
      // undo after the result was saved — put the match back live
      api.reopenMatch(tid, doc.id, m.score.A, m.score.B).catch(console.warn);
    } else {
      api.pushScore(tid, doc.id, m.score.A, m.score.B).catch(console.warn);
    }
  }, [m, tid, doc.id, doc.status]);

  const lastRallyAt = useRef(0);
  const actions = {
    rallyWon: (side) => {
      const now = Date.now();
      if (now - lastRallyAt.current < 250) return;
      lastRallyAt.current = now;
      const r = rules.rallyWon(m, side);
      if (!r) return;
      playFx(r.fx);
      setFx({ ...r.fx, at: now });
      setM(r.match);
    },
    undo: () => {
      const r = rules.undo(m);
      if (!r) { sfx.error(); buzz(40); return; }
      playFx(r.fx);
      setM(r.match);
    },
    togglePause: () => {
      const r = rules.togglePause(m);
      if (!r) return;
      playFx(r.fx);
      setM(r.match);
    },
    timeUp: () => {
      if (!m || m.finished || m.suddenDeath) return;
      const r = rules.timeUp(m);
      playFx(r.fx);
      setM(r.match);
    },
    retire: (side) => {
      const r = rules.retire(m, side);
      if (!r) return;
      playFx(r.fx);
      setM(r.match);
    },
  };

  /* keyboard shortcuts for desktop judges — same keys as local mode
     (the local handler lives in App.jsx, which tournament mode doesn't
     render, so the court needs its own) */
  useEffect(() => {
    const onKey = (e) => {
      if (!m || menuOpen) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (m.finished && e.key !== 'u' && e.key !== 'Backspace') return;
      if (e.key === 'ArrowLeft' || e.key === 'a') actions.rallyWon('A');
      else if (e.key === 'ArrowRight' || e.key === 'l') actions.rallyWon('B');
      else if (e.key === 'u' || e.key === 'Backspace') { e.preventDefault(); actions.undo(); }
      else if (e.key === ' ') { e.preventDefault(); actions.togglePause(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const exitToList = () => { setMenuOpen(false); onExit(); };

  const finishAndExit = () => {
    // already synced by the effect; re-fire unawaited as a safety net
    api.completeMatch(tid, doc.id, m.score.A, m.score.B).catch(console.warn);
    remove(engineKey(doc.id));
    sfx.tap(); hap.tap();
    onExit();
  };

  const giveBack = () => {
    api.releaseMatch(tid, doc.id).catch(console.warn);
    remove(engineKey(doc.id));
    sfx.tap();
    onExit();
  };

  // claimed but not started: pick who serves first, then play
  if (!m) {
    return (
      <PreMatch
        doc={doc} config={config}
        onStart={(fresh) => { setM(fresh); sfx.start(); buzz([30, 30, 30, 30, 80]); }}
        onBack={exitToList} onGiveBack={giveBack}
      />
    );
  }

  return (
    <AppCtx.Provider value={{ match: m, fx, ...actions }}>
      <div id="app">
        <CourtScreen
          onOpenSettings={() => { setMenuOpen(true); sfx.tap(); }}
          onOpenNote={() => { setNoteOpen(true); sfx.tap(); }}
          hasNote={!!doc.refNote}
        />
        {menuOpen && (
          <TMenu
            m={m} onClose={() => setMenuOpen(false)}
            onBackToList={exitToList} onGiveBack={giveBack}
            onRetire={(side) => { setMenuOpen(false); actions.retire(side); }}
          />
        )}
        {noteOpen && (
          <NoteModal tid={tid} doc={doc} onClose={() => setNoteOpen(false)} />
        )}
        {m.finished && <TWinnerOverlay m={m} onUndo={actions.undo} onDone={finishAndExit} />}
        <div className="scanlines" aria-hidden="true" />
      </div>
    </AppCtx.Provider>
  );
}

/* ------------------------------------------------ referee note (📝 on the court) */
function NoteModal({ tid, doc, onClose }) {
  const [text, setText] = useState(doc.refNote || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.setMatchNote(tid, doc.id, text.trim());
      sfx.tap();
      onClose();
    } catch (e) {
      console.warn(e);
      setSaving(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="match note"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <header className="modal-head">
          <h3>📝 MATCH NOTE</h3>
          <button type="button" className="px-btn icon" aria-label="close"
            onClick={() => { onClose(); sfx.tap(); }}>✕</button>
        </header>
        <div className="modal-body">
          <p className="micro dim" style={{ marginBottom: '.8em' }}>
            E.G. "PLAYER CHANGE — INJURY". SHOWS LIVE ON THE DASHBOARD.
          </p>
          <textarea
            className="t-note-input" rows={4} autoFocus
            value={text} onChange={(e) => setText(e.target.value)}
            placeholder="ADD A NOTE FOR THIS MATCH…"
          />
          <div className="toggle-row" style={{ marginTop: '.8rem' }}>
            <button type="button" className="px-btn wide ghost" disabled={saving}
              onClick={() => setText('')}>
              CLEAR
            </button>
            <button type="button" className="px-btn wide accent" disabled={saving} onClick={save}>
              {saving ? 'SAVING…' : '✔ SAVE NOTE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------ pre-match serve setup */
function Seg({ options, value, onPick }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} type="button"
          className={`seg-btn ${value === o.value ? 'on' : ''}`}
          onClick={() => { onPick(o.value); sfx.select(); hap.tap(); }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PreMatch({ doc, config, onStart, onBack, onGiveBack }) {
  const A = mkTeam('A', doc.teamA), B = mkTeam('B', doc.teamB);
  const doubles = A.players.length === 2 && B.players.length === 2;
  const [firstServe, setFirstServe] = useState('A');
  const [server, setServer] = useState(0);
  const [receiver, setReceiver] = useState(0);
  const keepScore = doc.scoreA > 0 || doc.scoreB > 0;
  const svTeam = firstServe === 'A' ? A : B;
  const rcTeam = firstServe === 'A' ? B : A;

  const start = () => {
    const setup = {
      stage: matchLabel(doc), game: 1,
      ruleset: config.ruleset || 'rally',
      format: doubles ? 'doubles' : 'singles',
      // 'points' plays to matchTo with no clock limit; 'timed' is the
      // hybrid — minutes cap AND first-to-matchTo, whichever comes first
      scoring: config.scoring === 'points' ? 'points' : 'timed',
      target: config.matchTo, minutes: config.minutes,
      capTarget: config.matchTo, capWinBy: config.winBy || 1,
      teamA: 'A', teamB: 'B', p1: A.name, p2: B.name,
      firstServe, server: doubles ? server : 0, receiver: doubles ? receiver : 0,
    };
    const fresh = rules.newMatch(setup, [A, B]);
    if (keepScore) {
      // score already on the board (rejoined from another device or an
      // admin reset) — keep it, serve continuity comes from the pickers
      fresh.score = { A: doc.scoreA, B: doc.scoreB };
      fresh.msg = `RESUMING AT ${doc.scoreA}-${doc.scoreB} — ${svTeam.name} TO SERVE`;
    }
    onStart(fresh);
  };

  const pick = (team, sel, onSel) => team.players.map((p, i) => (
    <button key={i} type="button" className={`pp-btn${sel === i ? ' on' : ''}`}
      onClick={() => { onSel(i); sfx.select(); hap.tap(); }}>
      {p}
    </button>
  ));

  return (
    <div id="app">
      <section className="screen t-screen">
        <header className="setup-header">
          <div className="logo-row">
            <PixelBall size="lg" />
            <h1>PICKLE&nbsp;POINT</h1>
            <PixelBall size="lg" flip />
          </div>
          <p className="tagline">{matchLabel(doc)} · COURT {doc.court}</p>
          <div className="net-divider" aria-hidden="true" />
        </header>
        <div className="setup-body">
          <fieldset className="panel">
            <legend>MATCH</legend>
            <div className="t-match-teams">{doc.teamA} <em>VS</em> {doc.teamB}</div>
            <p className="micro dim">
              {(config.ruleset || 'rally').toUpperCase()} · TO {config.matchTo} (WIN BY {config.winBy || 1})
              {config.scoring === 'points'
                ? ' · NO TIME LIMIT'
                : ` · ${config.minutes} MIN CAP · TIE AT TIME = SUDDEN DEATH`}
            </p>
            {keepScore && <p className="micro dim">SCORE ON THE BOARD ({doc.scoreA}-{doc.scoreB}) WILL BE KEPT</p>}
          </fieldset>

          <fieldset className="panel">
            <legend>FIRST SERVE</legend>
            <Seg value={firstServe}
              options={[{ value: 'A', label: `◀ ${A.name}` }, { value: 'B', label: `${B.name} ▶` }]}
              onPick={(v) => { setFirstServe(v); setServer(0); setReceiver(0); }} />
            {doubles && (
              <div className="serve-pickers">
                <div className="serve-picker">
                  <span className="field-label">SERVER <span className="micro">(starts right court)</span></span>
                  <div className="player-pick">{pick(svTeam, server, setServer)}</div>
                </div>
                <div className="serve-picker">
                  <span className="field-label">RECEIVER <span className="micro">(diagonal court)</span></span>
                  <div className="player-pick">{pick(rcTeam, receiver, setReceiver)}</div>
                </div>
              </div>
            )}
          </fieldset>

          <button type="button" className="px-btn start-btn" onClick={start}>
            <PixelBall size="sm" /> START GAME <PixelBall size="sm" flip />
          </button>
          <button type="button" className="px-btn wide ghost" onClick={onBack}>
            ◀ BACK TO MATCHES (KEEP THIS ONE)
          </button>
          <button type="button" className="px-btn wide ghost" onClick={onGiveBack}>
            ↩ GIVE THE MATCH BACK
          </button>
        </div>
      </section>
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

/* ------------------------------------------------ menu (⚙ on the court) */
function TMenu({ m, onClose, onBackToList, onGiveBack, onRetire }) {
  const fresh = m.score.A === 0 && m.score.B === 0 && !m.finished;
  const [retiring, setRetiring] = useState(false);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="match menu"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <header className="modal-head">
          <h3>⚙ MATCH</h3>
          <button type="button" className="px-btn icon" aria-label="close"
            onClick={() => { onClose(); sfx.tap(); }}>✕</button>
        </header>
        <div className="modal-body">
          <p className="micro dim" style={{ marginBottom: '.8em' }}>
            <span className="t-live-dot" /> SCORE SYNCS LIVE — YOU CAN LEAVE AND CONTINUE THIS MATCH ANYTIME
          </p>
          <button type="button" className="px-btn wide" onClick={onBackToList}>
            ◀ BACK TO MATCH LIST (KEEP SCORING LATER)
          </button>
          {!m.finished && !retiring && (
            <button type="button" className="px-btn wide ghost"
              onClick={() => { setRetiring(true); sfx.tap(); }}>
              🏳 RETIRE / INJURY…
            </button>
          )}
          {retiring && (
            <fieldset className="panel" style={{ marginTop: '.8rem' }}>
              <legend>WHO GIVES UP?</legend>
              <p className="micro dim" style={{ marginBottom: '.8em' }}>
                THE OTHER TEAM WINS WITH THE SCORE AS IT STANDS · UNDO REVERSES A MISTAKE
              </p>
              <button type="button" className="px-btn wide danger" onClick={() => onRetire('A')}>
                🏳 {m.teams.A.name} RETIRES
              </button>
              <button type="button" className="px-btn wide danger" onClick={() => onRetire('B')}>
                🏳 {m.teams.B.name} RETIRES
              </button>
              <button type="button" className="px-btn wide ghost"
                onClick={() => { setRetiring(false); sfx.tap(); }}>
                CANCEL
              </button>
            </fieldset>
          )}
          {fresh && (
            <button type="button" className="px-btn wide ghost" onClick={onGiveBack}>
              ↩ GIVE THE MATCH BACK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------ winner overlay */
function TWinnerOverlay({ m, onUndo, onDone }) {
  const w = m.winner, l = rules.otherSide(w);
  return (
    <div className="modal">
      <div className="winner-box">
        <div className="winner-banner">🏆 GAME!</div>
        <div className="winner-team">{rules.teamOf(m, w)} WINS!</div>
        <div className="winner-score">{m.score[w]} – {m.score[l]}</div>
        <div className="winner-sub">
          {m.finishHow} · {rules.fmtClock(m.elapsed)}<br />
          RESULT SAVED TO THE TOURNAMENT ✔
        </div>
        <div className="toggle-row center">
          <button type="button" className="px-btn" onClick={onUndo}>↶ UNDO</button>
          <button type="button" className="px-btn accent" onClick={onDone}>▶ BACK TO MATCHES</button>
        </div>
      </div>
    </div>
  );
}
