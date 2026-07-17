/* ==========================================================
   Central app store: teams, prefs, setup selections and the live
   match. Every match transition flows through the action functions
   here (which delegate to the pure engine in lib/rules.js), so this
   is the single choke point where a future Firebase realtime sync
   for the tournament dashboard can publish live results.
   ========================================================== */
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { LS, load, save, remove } from '../lib/storage.js';
import * as rules from '../lib/rules.js';
import { sfx, setSoundEnabled } from '../lib/audio.js';
import { hap, buzz, setHapticEnabled } from '../lib/haptics.js';

const SEED_TEAMS = [
  { id: 't1', name: 'SMASH BROS', players: ['TAN W.L.', 'LIM J.H.'] },
  { id: 't2', name: 'DINK DYNASTY', players: ['LEE M.', 'WONG K.T.'] },
];

const DEFAULT_SETUP = {
  stage: 'GROUP A',
  game: 1,
  ruleset: 'rally',      // 'traditional' | 'rally'
  format: 'doubles',     // 'doubles' | 'singles'
  scoring: 'points',     // 'points' | 'timed'
  target: 11,            // 11 | 15 | 21
  minutes: 10,
  teamA: null, teamB: null,
  p1: '', p2: '',        // singles: left / right player names
  firstServe: 'A',
  server: 0,             // player index on serving team (doubles)
  receiver: 0,           // player index on receiving team (doubles)
};

/* play the sound + haptic pattern matching an engine fx descriptor */
function playFx(fx) {
  if (!fx) return;
  switch (fx.type) {
    case 'point':   sfx.point();   hap.point();   break;
    case 'gain':    sfx.gain();    hap.gain();    break;
    case 'second':  sfx.second();  hap.second();  break;
    case 'sideout': sfx.sideout(); hap.sideout(); break;
    case 'win':     sfx.win();     hap.win();     break;
    case 'timeup':  sfx.timeup();  buzz([120, 80, 120]); break;
    case 'tap':     sfx.tap();     hap.tap();     break;
    default: break;
  }
}

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [teams, setTeams] = useState(() => {
    const t = load(LS.teams, null);
    if (t) return t;
    save(LS.teams, SEED_TEAMS);
    return SEED_TEAMS;
  });
  const [prefs, setPrefs] = useState(() =>
    Object.assign({ sound: true, haptic: true }, load(LS.prefs, {})));
  const [setup, setSetup] = useState(() => {
    const s = { ...DEFAULT_SETUP };
    const t = load(LS.teams, SEED_TEAMS);
    s.teamA = t[0] ? t[0].id : null;
    s.teamB = t[1] ? t[1].id : null;
    return s;
  });
  const [match, setMatch] = useState(() => {
    const m = rules.migrateMatch(load(LS.match, null));
    if (!m || m.finished) return null;
    // resume an in-progress match, paused (time away doesn't count)
    m.paused = true;
    m.elapsed = m.elapsed || 0;
    return m;
  });
  // fx: last engine feedback event, consumed by the court screen for
  // floating "+1"/"SIDE OUT" text, score bumps and half flashes
  const [fx, setFx] = useState(null);

  /* ---------- persistence ---------- */
  useEffect(() => save(LS.teams, teams), [teams]);
  useEffect(() => {
    save(LS.prefs, prefs);
    setSoundEnabled(prefs.sound);
    setHapticEnabled(prefs.haptic);
  }, [prefs]);
  useEffect(() => {
    if (!match) { remove(LS.match); return; }
    // roll running time into `elapsed` so a reload never loses clock time
    const m = match.paused || match.finished ? match : {
      ...match,
      elapsed: match.elapsed + (Date.now() - match.runningSince),
      runningSince: Date.now(),
    };
    save(LS.match, m);
  }, [match]);

  /* sync setup selections from the live match (used on resume, restart,
     rematch) so follow-up games carry the same configuration */
  const syncSetupFromMatch = useCallback((m) => {
    setSetup((s) => {
      const next = {
        ...s,
        stage: m.stage, game: m.game,
        ruleset: m.ruleset, format: m.format,
        scoring: m.scoring, target: m.target, minutes: m.minutes,
      };
      if (m.teamIds) { next.teamA = m.teamIds.A; next.teamB = m.teamIds.B; }
      if (m.format === 'singles') {
        next.p1 = m.teams.A.players[0];
        next.p2 = m.teams.B.players[0];
      }
      if (m.setup0) {
        next.firstServe = m.setup0.firstServe;
        next.server = m.setup0.server;
        next.receiver = m.setup0.receiver;
      }
      return next;
    });
  }, []);

  // populate setup from a resumed match once on mount
  const resumedRef = useRef(false);
  useEffect(() => {
    if (match && !resumedRef.current) syncSetupFromMatch(match);
    resumedRef.current = true;
  }, [match, syncSetupFromMatch]);

  /* ---------- actions ---------- */
  const lastRallyAt = useRef(0);

  const actions = {
    setSetup: (patch) => setSetup((s) => ({ ...s, ...patch })),
    setPrefs: (patch) => setPrefs((p) => ({ ...p, ...patch })),

    startMatch: (freshSetup) => {
      const m = rules.newMatch(freshSetup, teams);
      setMatch(m);
      sfx.start(); buzz([30, 30, 30, 30, 80]);
      return m;
    },

    /* transitions are computed OUTSIDE the state updater so the sound /
       haptic side effects can never double-fire (StrictMode re-invokes
       updaters); the 250ms guard covers rapid re-entry before re-render */
    rallyWon: (side) => {
      const now = Date.now();
      if (now - lastRallyAt.current < 250) return;   // accidental double taps
      lastRallyAt.current = now;
      const r = rules.rallyWon(match, side);
      if (!r) return;
      playFx(r.fx);
      setFx({ ...r.fx, at: now });
      setMatch(r.match);
    },

    undo: () => {
      const r = rules.undo(match);
      if (!r) { sfx.error(); buzz(40); return; }
      playFx(r.fx);
      setMatch(r.match);
    },

    togglePause: () => {
      const r = rules.togglePause(match);
      if (!r) return;
      playFx(r.fx);
      setMatch(r.match);
    },

    timeUp: () => {
      if (!match || match.finished || match.suddenDeath) return;
      const r = rules.timeUp(match);
      playFx(r.fx);
      setMatch(r.match);
    },

    setMinutesLive: (minutes) => {
      setMatch((prev) => prev
        ? { ...prev, minutes, suddenDeath: false }
        : prev);
      sfx.tap();
    },

    /* stop the current match and start it fresh with changed game-mode
       settings, keeping sides, label and original serve/receive picks */
    restartWith: (patch, m = match) => {
      const s = {
        ...setup,
        stage: m.stage, game: m.game,
        ruleset: m.ruleset, format: m.format,
        scoring: m.scoring, target: m.target, minutes: m.minutes,
        ...(m.teamIds ? { teamA: m.teamIds.A, teamB: m.teamIds.B } : {}),
        ...(m.format === 'singles'
          ? { p1: m.teams.A.players[0], p2: m.teams.B.players[0] } : {}),
        ...(m.setup0 ? {
          firstServe: m.setup0.firstServe,
          server: m.setup0.server,
          receiver: m.setup0.receiver,
        } : {}),
        ...patch,
      };
      if (s.format === 'doubles' &&
          (!teams.find((t) => t.id === s.teamA) || !teams.find((t) => t.id === s.teamB))) {
        actions.endMatch();
        return;
      }
      setSetup(s);
      const next = rules.newMatch(s, teams);
      next.msg = `MODE: ${rules.modeName(next)} — FRESH GAME!`;
      setMatch(next);
      sfx.start(); buzz([30, 30, 30, 30, 80]);
    },

    /* same sides, same settings, loser serves first next game */
    rematch: () => {
      const m = match;
      const s = {
        ...setup,
        stage: m.stage, game: m.game + 1,
        ruleset: m.ruleset, format: m.format,
        scoring: m.scoring, target: m.target, minutes: m.minutes,
        ...(m.teamIds ? { teamA: m.teamIds.A, teamB: m.teamIds.B } : {}),
        ...(m.format === 'singles'
          ? { p1: m.teams.A.players[0], p2: m.teams.B.players[0] } : {}),
        firstServe: rules.otherSide(m.winner),
        server: 0, receiver: 0,
      };
      if (s.format === 'doubles' &&
          (!teams.find((t) => t.id === s.teamA) || !teams.find((t) => t.id === s.teamB))) {
        actions.endMatch();
        return;
      }
      setSetup(s);
      setMatch(rules.newMatch(s, teams));
      sfx.start(); buzz([30, 30, 30, 30, 80]);
    },

    nextMatch: () => {
      if (match) syncSetupFromMatch(match);
      setSetup((s) => ({ ...s, game: (match ? match.game : s.game) + 1 }));
      setMatch(null);
      sfx.tap();
    },

    endMatch: () => setMatch(null),

    /* ---------- team registry ---------- */
    saveTeam: (id, name, players) => {
      setTeams((ts) => id
        ? ts.map((t) => (t.id === id ? { ...t, name, players } : t))
        : [...ts, { id: 't' + Date.now().toString(36), name, players }]);
      sfx.select(); hap.tap();
    },
    deleteTeam: (id) => {
      setTeams((ts) => ts.filter((t) => t.id !== id));
      setSetup((s) => ({
        ...s,
        teamA: s.teamA === id ? null : s.teamA,
        teamB: s.teamB === id ? null : s.teamB,
      }));
      sfx.sideout(); hap.tap();
    },
  };

  return (
    <Ctx.Provider value={{ teams, prefs, setup, match, fx, ...actions }}>
      {children}
    </Ctx.Provider>
  );
}
