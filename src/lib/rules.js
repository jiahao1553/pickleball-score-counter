/* ==========================================================
   PICKLE POINT — pure rules engine (no DOM, no React)

   Two rulesets per usapickleball.org skills guides, each playable
   as singles or doubles, with points (11/15/21, win by 2) or timed
   scoring:

   TRADITIONAL — side-out scoring (level-one guide):
   - only the serving side scores
   - doubles: 3-number call (server score, receiver score, server #),
     game starts at 0-0-2 (first serving team gets one server);
     server keeps serving while scoring, partners swap courts; fault
     on server #1 -> server #2; fault on #2 -> side out; whoever is
     on the right after a side out is server #1 for that turn
   - singles: 2-number call; server serves from the right when their
     score is even, left when odd; a fault is an immediate side out
   - the receiver is always the player diagonally opposite the server

   RALLY — rally scoring (level-three guide):
   - every rally scores a point, for whichever side wins it; win by 2
     (no freeze), 2-number call, one server per service turn
   - doubles: while a team holds serve the same player keeps serving,
     partners swapping sides on each point won; positions are tied to
     the team's score — starting server on the right when their score
     is even, left when odd; when the receiving team wins they score
     AND take over serve, always initiated from the right court, so
     even score -> the starting server serves, odd -> their partner
   - singles: as traditional singles, but the receiver scores and
     takes over serve on winning a rally

   Every state transition happens through the functions in this file,
   so a future Firebase realtime sync (live tournament dashboard) only
   needs to observe the match object after each transition.
   ========================================================== */

export const otherSide = (s) => (s === 'A' ? 'B' : 'A');
export const isSingles = (m) => m.format === 'singles';

/* unique id for a match; the random suffix avoids collisions when a
   rematch/restart is created within the same millisecond */
const newId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* the rally-derived fields an undo snapshot must restore — the game state
   that changes as points are played/undone. Config (teams, ruleset, target,
   minutes, setup0, …) is fixed; the clock (elapsed/runningSince/paused) is
   handled separately by undo, so neither belongs here. The persistence layer
   reuses this list (plus the clock) as the fields of a score row. */
export const MUTABLE_STATE = [
  'score', 'serving', 'serverNum', 'server', 'courts', 'msg',
  'suddenDeath', 'finished', 'winner', 'finishHow',
];

const fmt2 = (n) => String(n).padStart(2, '0');
export const fmtClock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${fmt2(Math.floor(s / 60))}:${fmt2(s % 60)}`;
};

export const modeName = (m) =>
  `${m.ruleset === 'rally' ? 'RALLY' : 'TRADITIONAL'} · ` +
  (m.scoring === 'timed' ? `${m.minutes} MIN` : `${m.target} PTS`);

export const currentElapsed = (m) =>
  !m ? 0 : m.paused ? m.elapsed : m.elapsed + (Date.now() - m.runningSince);

/* ---------------------------------------------------------- creation */
export function newMatch(setup, registeredTeams) {
  const sv = setup.firstServe;                 // 'A' | 'B'
  const rc = otherSide(sv);
  let A, B, teamIds = null;
  if (setup.format === 'singles') {
    A = { name: setup.p1, players: [setup.p1] };
    B = { name: setup.p2, players: [setup.p2] };
  } else {
    const tA = registeredTeams.find((t) => t.id === setup.teamA);
    const tB = registeredTeams.find((t) => t.id === setup.teamB);
    A = { name: tA.name, players: [...tA.players] };
    B = { name: tB.name, players: [...tB.players] };
    teamIds = { A: tA.id, B: tB.id };
  }
  const server = setup.format === 'singles' ? 0 : setup.server;
  const receiver = setup.format === 'singles' ? 0 : setup.receiver;
  // traditional doubles: mutable court map, first server on the right,
  // chosen receiver diagonal to them (also on the right)
  const courts = { A: {}, B: {} };
  courts[sv] = { right: server, left: 1 - server };
  courts[rc] = { right: receiver, left: 1 - receiver };
  // rally doubles: per-team starting server, on the right at even score
  const starting = { [sv]: server, [rc]: receiver };
  return {
    id: newId(), createdAt: Date.now(),
    stage: setup.stage, game: setup.game,
    ruleset: setup.ruleset, format: setup.format,
    scoring: setup.scoring, target: setup.target, minutes: setup.minutes,
    teamIds,
    teams: { A, B },
    score: { A: 0, B: 0 },
    serving: sv,
    serverNum: 2,                              // traditional doubles 0-0-2 start
    server,                                    // player index on serving side
    starting,
    setup0: { firstServe: sv, server, receiver },
    courts,
    elapsed: 0, runningSince: Date.now(), paused: false,
    finished: false, winner: null, finishHow: null, suddenDeath: false,
    msg: `GAME ON! ${(sv === 'A' ? A : B).name} SERVES FIRST`,
    history: [],
  };
}

/* migrate a match persisted by an older app version (mode-string era)
   into the ruleset/format/scoring model so it keeps working */
export function migrateMatch(m) {
  if (!m) return m;
  if (!m.id) m.id = newId();
  if (m.ruleset) return m;
  m.format = 'doubles';
  m.scoring = m.mode === 'timed' ? 'timed' : 'points';
  m.target = Number(m.mode) || 11;
  if (m.mode === 'simple') {
    m.ruleset = 'rally';
    // approximate each team's starting server so the parity rule holds
    // from here on: whoever satisfies "right court at even score" now
    m.starting = {
      A: m.score.A % 2 === 0 ? m.courts.A.right : m.courts.A.left,
      B: m.score.B % 2 === 0 ? m.courts.B.right : m.courts.B.left,
    };
  } else {
    m.ruleset = 'traditional';
    m.starting = { A: m.courts.A.right, B: m.courts.B.right };
  }
  delete m.mode;
  delete m.lastServer;
  return m;
}

/* ---------------------------------------------------------- queries */
export const teamOf = (m, side) => m.teams[side].name;
export const playerName = (m, side, idx) => m.teams[side].players[idx];

export function serveCall(m) {
  const s = m.score[m.serving];
  const r = m.score[otherSide(m.serving)];
  // 3-number call only exists in traditional doubles
  if (m.ruleset === 'traditional' && !isSingles(m)) return `${s}-${r}-${m.serverNum}`;
  return `${s}-${r}`;
}

/* which court ('right'|'left') a player stands in right now */
export function courtOf(m, side, idx) {
  if (isSingles(m)) {
    // both players mirror diagonally off the server's score parity
    return m.score[m.serving] % 2 === 0 ? 'right' : 'left';
  }
  if (m.ruleset === 'traditional') {
    return m.courts[side].right === idx ? 'right' : 'left';
  }
  // rally doubles: starting server is on the right at even team score
  const even = m.score[side] % 2 === 0;
  return (idx === m.starting[side]) === even ? 'right' : 'left';
}

export const serverCourt = (m) => courtOf(m, m.serving, m.server);

/* receiver: receiving side's player diagonal to the server
   (the diagonal court carries the same right/left name) */
export function receiverInfo(m) {
  const rc = otherSide(m.serving);
  if (isSingles(m)) return { side: rc, idx: 0 };
  const sc = serverCourt(m);
  return { side: rc, idx: courtOf(m, rc, 0) === sc ? 0 : 1 };
}

/* which display row (0 = top, 1 = bottom) a player occupies, mirroring
   the real court bird's-eye: left team's right service court is the
   bottom row, right team's right court is the top row, so the serve
   diagonal reads correctly */
export function courtRow(m, side, idx) {
  const onRight = courtOf(m, side, idx) === 'right';
  return side === 'A' ? (onRight ? 1 : 0) : (onRight ? 0 : 1);
}

/* ---------------------------------------------------------- rally log
   The persistence layer records one row per score update. These builders
   capture who served / received (from the pre-rally state) alongside the
   resulting game state, so the stored rows read as a rally-by-rally log. */
const servedBy = (m) => ({ side: m.serving, idx: m.server, name: playerName(m, m.serving, m.server) });
const receivedBy = (m) => {
  const r = receiverInfo(m);
  return { side: r.side, idx: r.idx, name: playerName(m, r.side, r.idx) };
};
const rowState = (m) => {
  const e = currentElapsed(m);   // in-play clock (excludes paused time)
  return {
    score: m.score, serving: m.serving, serverNum: m.serverNum, server: m.server,
    courts: m.courts, suddenDeath: m.suddenDeath, finished: m.finished,
    winner: m.winner, finishHow: m.finishHow, msg: m.msg,
    elapsed: e,      // live match clock — kept fresh on the tail row while running
    elapsedAt: e,    // frozen in-play time at this rally; rally durations delta it
    paused: m.paused,
  };
};

/* the opening state of a match, before any rally is played */
export function initialLogEntry(m) {
  return { wonBy: null, servedBy: servedBy(m), receivedBy: receivedBy(m), serveCall: serveCall(m), ...rowState(m) };
}
/* one score update: who served / received the rally (pre-rally state) and
   the resulting state after `side` won it */
export function rallyLogEntry(prev, next, side) {
  return { wonBy: side, servedBy: servedBy(prev), receivedBy: receivedBy(prev), serveCall: serveCall(prev), ...rowState(next) };
}

/* ---------------------------------------------------------- transitions
   Each transition returns { match, fx } where fx describes the sound /
   haptic / visual feedback the UI should play. The engine never touches
   the DOM. `match` is a fresh object; the input is not mutated. */

function snapshot(m) {
  const s = {};
  for (const k of MUTABLE_STATE) s[k] = m[k];
  return JSON.parse(JSON.stringify(s));
}

function checkWin(m) {
  const a = m.score.A, b = m.score.B;
  if (m.scoring === 'timed') {
    if (m.suddenDeath && a !== b) return doFinish(m, a > b ? 'A' : 'B', 'SUDDEN DEATH POINT');
    return null;
  }
  const target = m.target || 11;
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  if (hi >= target && hi - lo >= 2) {
    return doFinish(m, a > b ? 'A' : 'B', `FIRST TO ${target} · WIN BY 2`);
  }
  return null;
}

function doFinish(m, side, how) {
  m.finished = true;
  m.winner = side;
  m.finishHow = how;
  m.elapsed = currentElapsed(m);
  m.paused = true;
  m.msg = `🏆 ${teamOf(m, side)} WINS!`;
  return { type: 'win', side };
}

/* the judge taps the side that WON the rally */
export function rallyWon(prev, side) {
  if (!prev || prev.finished) return null;
  const m = structuredClone(prev);
  if (m.paused) {                              // auto-resume on play
    m.paused = false;
    m.runningSince = Date.now();
  }
  m.history.push(snapshot(prev));
  if (m.history.length > 200) m.history.shift();

  let fx;
  if (m.ruleset === 'rally') {
    // rally scoring: every rally scores, for whichever side wins it
    m.score[side] += 1;
    if (side === m.serving) {
      // same server continues; positions derive from the new score parity
      m.msg = `POINT — ${teamOf(m, side)}! ${playerName(m, side, m.server)} SERVES AGAIN`;
      fx = { type: 'point', side };
    } else {
      // receiving side scores AND takes over serve, initiated from the
      // right court: even score -> starting server, odd -> their partner
      m.serving = side;
      m.server = isSingles(m) ? 0
        : (m.score[side] % 2 === 0 ? m.starting[side] : 1 - m.starting[side]);
      m.msg = `POINT — ${teamOf(m, side)}! ${playerName(m, side, m.server)} TO SERVE`;
      fx = { type: 'gain', side };
    }
  } else if (isSingles(m)) {
    // traditional singles: server scores or an immediate side out
    if (side === m.serving) {
      m.score[side] += 1;
      m.msg = `POINT — ${teamOf(m, side)}! SERVES AGAIN`;
      fx = { type: 'point', side };
    } else {
      m.serving = side;
      m.msg = `SIDE OUT! ${teamOf(m, side)} TO SERVE`;
      fx = { type: 'sideout', side };
    }
  } else if (side === m.serving) {
    // traditional doubles: point for the serving team; partners swap
    // courts, same server
    m.score[side] += 1;
    const c = m.courts[side];
    [c.right, c.left] = [c.left, c.right];
    m.msg = `POINT — ${teamOf(m, side)}! ${playerName(m, side, m.server)} SERVES AGAIN`;
    fx = { type: 'point', side };
  } else if (m.serverNum === 1) {
    // first server faults -> partner serves
    m.serverNum = 2;
    m.server = 1 - m.server;
    m.msg = `SECOND SERVER — ${playerName(m, m.serving, m.server)} TO SERVE`;
    fx = { type: 'second', side: m.serving };
  } else {
    // side out -> other team serves, right-court player is server #1
    m.serving = side;
    m.serverNum = 1;
    m.server = m.courts[side].right;
    m.msg = `SIDE OUT! ${teamOf(m, side)} TO SERVE — ${playerName(m, side, m.server)} UP`;
    fx = { type: 'sideout', side };
  }
  const winFx = checkWin(m);
  return { match: m, fx: winFx || fx };
}

/* timed scoring reached 00:00 */
export function timeUp(prev) {
  const m = structuredClone(prev);
  const a = m.score.A, b = m.score.B;
  if (a === b) {
    m.suddenDeath = true;
    m.msg = '⏱ TIME! TIED — SUDDEN DEATH, NEXT POINT WINS';
    return { match: m, fx: { type: 'timeup' } };
  }
  const fx = doFinish(m, a > b ? 'A' : 'B', 'HIGHEST SCORE AT TIME');
  return { match: m, fx };
}

export function togglePause(prev) {
  if (!prev || prev.finished) return null;
  const m = structuredClone(prev);
  if (m.paused) {
    m.runningSince = Date.now();
    m.paused = false;
  } else {
    m.elapsed = currentElapsed(m);
    m.paused = true;
  }
  return { match: m, fx: { type: 'tap' } };
}

/* undo restores the previous snapshot; the clock never rewinds */
export function undo(prev) {
  if (!prev || !prev.history.length) return null;
  const elapsedNow = currentElapsed(prev);
  const history = prev.history.slice(0, -1);
  // restore the prior state onto the fixed config (config never changes,
  // so snapshots only carry the mutable fields; older full snapshots merge
  // just as well since their config fields match prev's)
  const snap = structuredClone(prev.history[prev.history.length - 1]);
  const m = migrateMatch({ ...prev, ...snap });
  m.history = history;
  m.elapsed = elapsedNow;
  m.runningSince = Date.now();
  m.msg = '↶ UNDO — ' + m.msg;
  return { match: m, fx: { type: 'tap' } };
}
