/* localStorage persistence.

   Matches are stored normalized:

     pkl.matches  { [id]: config }  — everything fixed for a match: stage,
                                      ruleset, format, scoring, target, minutes,
                                      teamIds, starting, setup0, createdAt.
                                      Doubles rosters are referenced by id and
                                      rehydrated from pkl.teams (frozen onto the
                                      config once the match finishes); singles
                                      names have no id, so they stay.
     pkl.scores   [ row, … ]        — an APPEND-ONLY rally log: one row per score
                                      update, tagged with matchId + seq. Each row
                                      records who served / received, the serve
                                      call, start/end time + rally duration, the
                                      msg, and the full resulting game state. The
                                      last row for a match is its current state;
                                      the rows before it are its undo history.
     pkl.active   id                — the in-progress match to resume (or absent)

   pkl.teams (doubles) / pkl.players (singles names) / pkl.prefs keep their
   shapes. migrateStorage() upgrades the pre-normalization pkl.match layout. */
import { MUTABLE_STATE, migrateMatch } from './rules.js';
export const LS = {
  teams: 'pkl.teams',
  players: 'pkl.players',
  prefs: 'pkl.prefs',
  matches: 'pkl.matches',
  scores: 'pkl.scores',
  active: 'pkl.active',
};

export const load = (k, fb) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? fb;
  } catch {
    return fb;
  }
};

export const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

export const remove = (k) => {
  try { localStorage.removeItem(k); } catch {}
};

/* ---- match config split ---------------------------------------------- */
/* a score row's live fields (rally state + clock); everything else on the
   flat match object is fixed config */
const SCORE_FIELDS = new Set([...MUTABLE_STATE, 'elapsed', 'paused']);
const SKIP_FIELDS = new Set(['history', 'runningSince']);

const configOf = (m) => {
  const config = {};
  for (const k of Object.keys(m)) {
    if (SKIP_FIELDS.has(k) || SCORE_FIELDS.has(k)) continue;
    config[k] = m[k];
  }
  return config;
};

/* doubles rosters live in pkl.teams and are referenced by id, so the config
   doesn't repeat them; singles names have no id, so they stay on the config */
const leanConfig = (config) => {
  if (!config.teamIds) return config;                 // singles — keep names
  const { teams, ...rest } = config;
  return rest;
};

/* rebuild the { A, B } roster the app works with: from pkl.teams for
   doubles, or the names carried on the config for singles / a frozen match */
const hydrateTeams = (config) => {
  if (config.teams) return config.teams;              // singles / frozen snapshot
  const reg = load(LS.teams, []);
  const find = (id) => reg.find((t) => t.id === id);
  const tA = find(config.teamIds && config.teamIds.A);
  const tB = find(config.teamIds && config.teamIds.B);
  if (!tA || !tB) return null;                        // a referenced team is gone
  return {
    A: { name: tA.name, players: [...tA.players] },
    B: { name: tB.name, players: [...tB.players] },
  };
};

/* ---- rally-log rows -------------------------------------------------- */
/* row metadata (identity, rally info, timing) vs. the game-state fields */
const ROW_META = new Set(['matchId', 'seq', 'wonBy', 'servedBy', 'receivedBy', 'serveCall', 'tStart', 'tEnd', 'dur', 'elapsedAt']);
const stateFromRow = (row) => {
  const s = {};
  for (const k in row) if (!ROW_META.has(k)) s[k] = row[k];
  return s;
};
const snapFromRow = (row) => {
  const s = {};
  for (const k of MUTABLE_STATE) s[k] = row[k];
  return s;
};
const rowsFor = (id) =>
  load(LS.scores, []).filter((r) => r.matchId === id).sort((a, b) => a.seq - b.seq);

/* append a score row (initial state or a rally). tStart/tEnd are wall-clock
   timestamps; dur is the rally's IN-PLAY duration (the delta of the in-play
   clock carried on entry.elapsed), so paused time is excluded. */
export function appendScore(matchId, entry) {
  const rows = load(LS.scores, []);
  const mine = rows.filter((r) => r.matchId === matchId);
  const prev = mine.length ? mine[mine.length - 1] : null;
  rows.push({
    matchId, seq: mine.length,
    tStart: prev ? prev.tEnd : Date.now(),
    tEnd: Date.now(),
    dur: prev ? Math.max(0, entry.elapsedAt - prev.elapsedAt) : 0,
    ...entry,
  });
  save(LS.scores, rows);
}

/* refresh the live fields of a match's last row (clock, pause, and the
   time-up outcome — none of which create a new score update) */
export function updateTailLive(m) {
  const rows = load(LS.scores, []);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].matchId === m.id) {
      rows[i] = {
        ...rows[i],
        msg: m.msg, elapsed: m.elapsed, paused: m.paused,
        suddenDeath: m.suddenDeath, finished: m.finished,
        winner: m.winner, finishHow: m.finishHow,
      };
      save(LS.scores, rows);
      return;
    }
  }
}

/* undo removes the match's last row */
export function popScore(matchId) {
  const rows = load(LS.scores, []);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].matchId === matchId) { rows.splice(i, 1); save(LS.scores, rows); return; }
  }
}

/* ensure the config exists (written once) and patch the two things that can
   change — a live minutes edit and the roster freeze on finish; then refresh
   the active pointer and the tail row's live fields. Rows are appended by the
   rally actions, never here. */
export function saveMatchMeta(m) {
  const matches = load(LS.matches, {});
  const config = configOf(m);
  const existing = matches[m.id];
  if (!existing) {
    matches[m.id] = leanConfig(config);
    save(LS.matches, matches);
  } else {
    const patch = {};
    if (existing.minutes !== config.minutes) patch.minutes = config.minutes;
    if (m.finished && !existing.teams) patch.teams = config.teams;
    if (Object.keys(patch).length) { matches[m.id] = { ...existing, ...patch }; save(LS.matches, matches); }
  }
  updateTailLive(m);
  save(LS.active, m.id);
}

/* reassemble the flat match object from its config + rally log; the last row
   is the current state, earlier rows are the in-session undo history */
export function loadActiveMatch() {
  const id = load(LS.active, null);
  if (!id) return null;
  const config = load(LS.matches, {})[id];
  const rows = rowsFor(id);
  if (!config || !rows.length) return null;
  const teams = hydrateTeams(config);
  if (!teams) return null;
  const history = rows.slice(0, -1).map(snapFromRow);
  return { ...config, teams, ...stateFromRow(rows[rows.length - 1]), history };
}

/* forget the in-progress pointer without discarding match history */
export const clearActive = () => remove(LS.active);

/* completed games, newest first, joined into display-ready summaries.
   Exactly one row per match is finished (the terminal one). */
export function loadHistory() {
  const matches = load(LS.matches, {});
  return load(LS.scores, [])
    .filter((s) => s.finished && matches[s.matchId])
    .map((s) => {
      const config = matches[s.matchId];
      const teams = hydrateTeams(config);
      if (!teams) return null;
      return {
        id: s.matchId, teams,
        stage: config.stage, game: config.game,
        ruleset: config.ruleset, format: config.format,
        scoring: config.scoring, target: config.target, minutes: config.minutes,
        score: s.score, winner: s.winner, finishHow: s.finishHow,
        elapsed: s.elapsed, at: s.tEnd || config.createdAt || 0,
        rallies: s.seq,   // rows before the finish = number of score updates
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at);
}

/* the full rally log for a match, ordered, for a detailed timeline */
export const loadRallies = (matchId) => rowsFor(matchId);

/* delete one match (its config + all score rows) from history */
export function deleteMatch(id) {
  const matches = load(LS.matches, {});
  delete matches[id];
  save(LS.matches, matches);
  save(LS.scores, load(LS.scores, []).filter((s) => s.matchId !== id));
  if (load(LS.active, null) === id) remove(LS.active);
}

/* clear all history, keeping only the active (in-progress) match if any */
export function clearHistory() {
  const activeId = load(LS.active, null);
  const matches = load(LS.matches, {});
  const kept = {};
  if (activeId && matches[activeId]) kept[activeId] = matches[activeId];
  save(LS.matches, kept);
  save(LS.scores, load(LS.scores, []).filter((s) => s.matchId === activeId));
}

/* one-time migration: the pre-normalization app stored the single live match
   as a flat object under pkl.match. Reshape it into pkl.matches + a single
   pkl.scores row + pkl.active, then drop the legacy keys. The pre-feature undo
   history isn't reconstructable as a rally log, so only the current state is
   kept. Idempotent — a no-op once pkl.matches exists. */
export function migrateStorage() {
  if (load(LS.matches, null) !== null) return;        // already migrated
  const legacy = load('pkl.match', null);
  if (legacy && !Array.isArray(legacy) && (legacy.teams || legacy.score || legacy.mode)) {
    const m = migrateMatch({ ...legacy, id: legacy.id || ('m' + Date.now().toString(36)) });
    save(LS.matches, { [m.id]: leanConfig(configOf(m)) });
    const now = Date.now();
    const state = {};
    for (const k of [...SCORE_FIELDS]) state[k] = m[k];
    save(LS.scores, [{ matchId: m.id, seq: 0, wonBy: null, servedBy: null, receivedBy: null, serveCall: null, tStart: now, tEnd: now, dur: 0, elapsedAt: m.elapsed || 0, ...state }]);
    if (m.finished) remove(LS.active); else save(LS.active, m.id);
  }
  remove('pkl.match');
  remove('pkl.score');
}
