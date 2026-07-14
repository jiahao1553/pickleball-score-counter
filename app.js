/* ==========================================================
   PICKLE POINT — app logic

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
   ========================================================== */
'use strict';

const $ = (id) => document.getElementById(id);
const LS = { teams: 'pkl.teams', prefs: 'pkl.prefs', match: 'pkl.match' };

/* ---------------------------------------------------------- storage */
const load = (k, fb) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; }
  catch { return fb; }
};
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let teams = load(LS.teams, null);
if (!teams) {
  teams = [
    { id: 't1', name: 'SMASH BROS', players: ['TAN W.L.', 'LIM J.H.'] },
    { id: 't2', name: 'DINK DYNASTY', players: ['LEE M.', 'WONG K.T.'] },
  ];
  save(LS.teams, teams);
}
const prefs = Object.assign({ sound: true, haptic: true }, load(LS.prefs, {}));

/* setup selections (pre-game) */
const setup = {
  stage: 'GROUP A',
  game: 1,
  ruleset: 'rally',      // 'traditional' | 'rally'
  format: 'doubles',     // 'doubles' | 'singles'
  scoring: 'points',     // 'points' | 'timed'
  target: 11,            // 11 | 15 | 21 (points scoring)
  minutes: 10,           // timed scoring
  teamA: teams[0] ? teams[0].id : null,
  teamB: teams[1] ? teams[1].id : null,
  p1: '', p2: '',        // singles: left / right player names
  firstServe: 'A',
  server: 0,             // player index on serving team (doubles)
  receiver: 0,           // player index on receiving team (doubles)
};

/* live match state (null when no game running) */
let M = load(LS.match, null);

/* ---------------------------------------------------------- audio */
let actx = null;
function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended' || actx.state === 'interrupted') actx.resume();
  return actx;
}
/* iOS only fully arms the audio pipeline if a sound is actually started
   inside the unlocking gesture — creating/resuming the context is not
   enough on its own. Play one silent, zero-length buffer to unlock it. */
function unlockAudio() {
  const ctx = audio();
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
}
/* iOS suspends the AudioContext whenever the app is backgrounded (screen
   lock, app switch, phone call) and never resumes it on its own. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && actx) audio();
});
function tone(freq, dur, delay = 0, type = 'square', vol = 0.12) {
  if (!prefs.sound) return;
  try {
    const ctx = audio();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch {}
}
const sfx = {
  tap()    { tone(240, 0.05, 0, 'triangle', 0.1); },
  select() { tone(520, 0.06); tone(700, 0.08, 0.06); },
  point()  { tone(660, 0.09); tone(880, 0.14, 0.09); },
  gain()   { tone(660, 0.09); tone(880, 0.14, 0.09); tone(988, 0.12, 0.2); },
  second() { tone(494, 0.09); tone(392, 0.12, 0.09); },
  sideout(){ tone(440, 0.1); tone(294, 0.12, 0.1); tone(220, 0.16, 0.2); },
  start()  { tone(392, 0.09); tone(523, 0.09, 0.1); tone(659, 0.18, 0.2); },
  win()    { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.14, i * 0.12)); },
  timeup() { tone(880, 0.3, 0, 'sawtooth', 0.09); tone(880, 0.3, 0.4, 'sawtooth', 0.09); },
  error()  { tone(150, 0.2, 0, 'sawtooth', 0.1); },
};
/* iOS Safari has never implemented the Vibration API (deliberate WebKit
   limitation, not a bug here) — navigator.vibrate is simply absent there,
   so haptics silently no-op on iPhone/iPad regardless of this setting. */
const HAPTIC_SUPPORTED = typeof navigator.vibrate === 'function';
function buzz(pattern) {
  if (prefs.haptic && HAPTIC_SUPPORTED) { try { navigator.vibrate(pattern); } catch {} }
}
const hap = {
  tap: () => buzz(12),
  point: () => buzz([28, 30, 40]),
  gain: () => buzz([28, 30, 40, 30, 60]),
  sideout: () => buzz(70),
  second: () => buzz([20, 25, 20]),
  win: () => buzz([60, 50, 60, 50, 160]),
};

/* ---------------------------------------------------------- pixel ball art */
const BALL_MAP = [
  '....####....',
  '..########..',
  '.##########.',
  '.####o#####.',
  '############',
  '##o######o##',
  '######o#####',
  '###o######o#',
  '.#####o####.',
  '.##########.',
  '..########..',
  '....####....',
];
function paintBalls() {
  document.querySelectorAll('.pixel-ball').forEach((el) => {
    const px = el.classList.contains('lg') ? 5 : el.classList.contains('xs') ? 2 : 3;
    const shadows = [];
    BALL_MAP.forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (c === '#') shadows.push(`${x * px}px ${y * px}px 0 var(--ball)`);
        else if (c === 'o') shadows.push(`${x * px}px ${y * px}px 0 var(--ball-dark)`);
      });
    });
    // container box is the full 12x12 art; a 1px-unit child carries the shadows
    el.style.width = px * 12 + 'px';
    el.style.height = px * 12 + 'px';
    let dot = el.firstElementChild;
    if (!dot) {
      dot = document.createElement('i');
      el.appendChild(dot);
    }
    dot.style.cssText =
      `position:absolute;left:0;top:0;width:${px}px;height:${px}px;box-shadow:${shadows.join(',')}`;
  });
}

/* ---------------------------------------------------------- helpers */
const teamById = (id) => teams.find((t) => t.id === id);
const otherSide = (s) => (s === 'A' ? 'B' : 'A');
const fmt2 = (n) => String(n).padStart(2, '0');

function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${fmt2(Math.floor(s / 60))}:${fmt2(s % 60)}`;
}

/* ---------------------------------------------------------- match engine */
const isSingles = (m = M) => m.format === 'singles';

function newMatch() {
  const sv = setup.firstServe;                 // 'A' | 'B'
  const rc = otherSide(sv);
  let A, B, teamIds = null;
  if (setup.format === 'singles') {
    A = { name: setup.p1, players: [setup.p1] };
    B = { name: setup.p2, players: [setup.p2] };
  } else {
    const tA = teamById(setup.teamA), tB = teamById(setup.teamB);
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
    finished: false, winner: null, suddenDeath: false,
    msg: `GAME ON! ${(sv === 'A' ? A : B).name} SERVES FIRST`,
    history: [],
  };
}
function teamOf(side, m = M) { return m.teams[side].name; }

function snapshot() {
  const { history, ...rest } = M;
  return JSON.parse(JSON.stringify(rest));
}

function serveCall() {
  const s = M.score[M.serving];
  const r = M.score[otherSide(M.serving)];
  // 3-number call only exists in traditional doubles
  if (M.ruleset === 'traditional' && !isSingles()) return `${s}-${r}-${M.serverNum}`;
  return `${s}-${r}`;
}

/* which court ('right'|'left') a player stands in right now */
function courtOf(side, idx) {
  if (isSingles()) {
    // both players mirror diagonally off the server's score parity
    return M.score[M.serving] % 2 === 0 ? 'right' : 'left';
  }
  if (M.ruleset === 'traditional') {
    return M.courts[side].right === idx ? 'right' : 'left';
  }
  // rally doubles: starting server is on the right at even team score
  const even = M.score[side] % 2 === 0;
  return (idx === M.starting[side]) === even ? 'right' : 'left';
}
/* which court the current server stands in */
function serverCourt() { return courtOf(M.serving, M.server); }
/* receiver: receiving side's player diagonal to the server
   (the diagonal court carries the same right/left name) */
function receiverInfo() {
  const rc = otherSide(M.serving);
  if (isSingles()) return { side: rc, idx: 0 };
  const sc = serverCourt();
  return { side: rc, idx: courtOf(rc, 0) === sc ? 0 : 1 };
}

/* the judge taps the team that WON the rally */
let lastRallyAt = 0;
function rallyWon(side) {
  if (!M || M.finished) return;
  const now = Date.now();
  if (now - lastRallyAt < 250) return;         // guard accidental double taps
  lastRallyAt = now;
  // matches persisted before SIMPLE mode existed (including old history
  if (M.paused) { togglePause(); }             // auto-resume on play
  M.history.push(snapshot());
  if (M.history.length > 200) M.history.shift();

  if (M.ruleset === 'rally') {
    // rally scoring: every rally scores, for whichever side wins it
    M.score[side] += 1;
    bumpScore(side);
    if (side === M.serving) {
      // same server continues; positions derive from the new score parity
      M.msg = `POINT — ${teamOf(side)}! ${playerName(side, M.server)} SERVES AGAIN`;
      sfx.point(); hap.point();
      floatFx(side, '+1');
    } else {
      // receiving side scores AND takes over serve, initiated from the
      // right court: even score -> starting server, odd -> their partner
      M.serving = side;
      M.server = isSingles() ? 0
        : (M.score[side] % 2 === 0 ? M.starting[side] : 1 - M.starting[side]);
      M.msg = `POINT — ${teamOf(side)}! ${playerName(side, M.server)} TO SERVE`;
      sfx.gain(); hap.gain();
      floatFx(side, '+1 · SERVE');
      flashHalf(side);
    }
  } else if (isSingles()) {
    // traditional singles: server scores or an immediate side out
    if (side === M.serving) {
      M.score[side] += 1;
      M.msg = `POINT — ${teamOf(side)}! SERVES AGAIN`;
      sfx.point(); hap.point();
      floatFx(side, '+1');
      bumpScore(side);
    } else {
      M.serving = side;
      M.msg = `SIDE OUT! ${teamOf(side)} TO SERVE`;
      sfx.sideout(); hap.sideout();
      floatFx(side, 'SIDE OUT', true);
      flashHalf(side);
    }
  } else if (side === M.serving) {
    // traditional doubles: point for the serving team; partners swap
    // courts, same server
    M.score[side] += 1;
    const c = M.courts[side];
    [c.right, c.left] = [c.left, c.right];
    M.msg = `POINT — ${teamOf(side)}! ${playerName(side, M.server)} SERVES AGAIN`;
    sfx.point(); hap.point();
    floatFx(side, '+1');
    bumpScore(side);
  } else if (M.serverNum === 1) {
    // first server faults -> partner serves
    M.serverNum = 2;
    M.server = 1 - M.server;
    M.msg = `SECOND SERVER — ${playerName(M.serving, M.server)} TO SERVE`;
    sfx.second(); hap.second();
    floatFx(M.serving, '2ND SERVER', true);
  } else {
    // side out -> other team serves, right-court player is server #1
    M.serving = side;
    M.serverNum = 1;
    M.server = M.courts[side].right;
    M.msg = `SIDE OUT! ${teamOf(side)} TO SERVE — ${playerName(side, M.server)} UP`;
    sfx.sideout(); hap.sideout();
    floatFx(side, 'SIDE OUT', true);
    flashHalf(side);
  }
  checkWin();
  persistMatch();
  renderCourt();
}

function playerName(side, idx) { return M.teams[side].players[idx]; }

function checkWin() {
  const a = M.score.A, b = M.score.B;
  if (M.scoring === 'timed') {
    if (M.suddenDeath && a !== b) finish(a > b ? 'A' : 'B', 'SUDDEN DEATH POINT');
    return;
  }
  const target = M.target || 11;
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  if (hi >= target && hi - lo >= 2) {
    finish(a > b ? 'A' : 'B', `FIRST TO ${target} · WIN BY 2`);
  }
}

function onTimeUp() {
  const a = M.score.A, b = M.score.B;
  if (a === b) {
    M.suddenDeath = true;
    M.msg = '⏱ TIME! TIED — SUDDEN DEATH, NEXT POINT WINS';
    sfx.timeup(); buzz([120, 80, 120]);
    persistMatch(); renderCourt();
  } else {
    finish(a > b ? 'A' : 'B', 'HIGHEST SCORE AT TIME');
  }
}

function finish(side, how) {
  M.finished = true;
  M.winner = side;
  M.paused = true;
  M.elapsed = currentElapsed();
  M.msg = `🏆 ${teamOf(side)} WINS!`;
  sfx.win(); hap.win();
  persistMatch();
  showWinner(how);
  confetti();
}

function undo() {
  if (!M || !M.history.length) { sfx.error(); buzz(40); return; }
  const wasFinished = M.finished;
  const elapsedNow = currentElapsed();         // clock never rewinds on undo
  const h = M.history;
  M = migrateMatch(Object.assign(h.pop(), { history: h }));
  M.elapsed = elapsedNow;
  M.runningSince = Date.now();
  if (wasFinished) $('overlay-winner').classList.add('hidden');
  M.msg = '↶ UNDO — ' + M.msg;
  sfx.tap(); hap.tap();
  persistMatch();
  renderCourt();
}

/* ---------------------------------------------------------- timer */
function currentElapsed() {
  if (!M) return 0;
  return M.paused ? M.elapsed : M.elapsed + (Date.now() - M.runningSince);
}
function togglePause() {
  if (!M || M.finished) return;
  if (M.paused) {
    M.runningSince = Date.now();
    M.paused = false;
  } else {
    M.elapsed = currentElapsed();
    M.paused = true;
  }
  sfx.tap(); hap.tap();
  persistMatch();
  renderTimer();
}
let timerIv = null;
function startTicker() {
  clearInterval(timerIv);
  timerIv = setInterval(() => { if (M && !M.finished) renderTimer(); }, 250);
}

/* ---------------------------------------------------------- wake lock */
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && M && !M.finished) keepAwake();
});

/* ---------------------------------------------------------- persistence */
function persistMatch() {
  // roll running time into `elapsed` so a reload never loses clock time
  if (M && !M.paused && !M.finished) {
    M.elapsed = M.elapsed + (Date.now() - M.runningSince);
    M.runningSince = Date.now();
  }
  save(LS.match, M);
}
function persistTeams() { save(LS.teams, teams); }
function persistPrefs() { save(LS.prefs, prefs); }

/* ==========================================================
   RENDERING
   ========================================================== */
function show(screen) {
  $('screen-setup').classList.toggle('hidden', screen !== 'setup');
  $('screen-court').classList.toggle('hidden', screen !== 'court');
}

/* ---------- setup screen ---------- */
function modeHint() {
  const rules = setup.ruleset === 'rally'
    ? 'EVERY RALLY SCORES — RECEIVERS SCORE + TAKE SERVE'
    : 'SIDE-OUT SCORING — ONLY THE SERVING SIDE SCORES';
  const win = setup.scoring === 'timed'
    ? `HIGHEST SCORE IN ${setup.minutes} MIN · TIE = SUDDEN DEATH`
    : `FIRST TO ${setup.target} · WIN BY 2`;
  return `${rules} · ${win}`;
}

function renderSetup() {
  $('in-stage').value = setup.stage;
  $('out-game').textContent = setup.game;
  $('out-min').textContent = setup.minutes;
  const singles = setup.format === 'singles';
  document.querySelectorAll('#seg-ruleset .seg-btn').forEach((b) =>
    b.classList.toggle('on', b.dataset.ruleset === setup.ruleset));
  document.querySelectorAll('#seg-format .seg-btn').forEach((b) =>
    b.classList.toggle('on', b.dataset.format === setup.format));
  document.querySelectorAll('#seg-scoring .seg-btn').forEach((b) =>
    b.classList.toggle('on', b.dataset.scoring === setup.scoring));
  document.querySelectorAll('#seg-target .seg-btn').forEach((b) =>
    b.classList.toggle('on', Number(b.dataset.target) === setup.target));
  $('target-row').classList.toggle('hidden', setup.scoring !== 'points');
  $('timed-row').classList.toggle('hidden', setup.scoring !== 'timed');
  $('mode-hint').textContent = modeHint();
  // teams panel: doubles picks registered teams, singles types two names
  $('roster-legend').textContent = singles ? 'PLAYERS' : 'TEAMS';
  $('doubles-roster').classList.toggle('hidden', singles);
  $('singles-roster').classList.toggle('hidden', !singles);
  $('in-p1').value = setup.p1;
  $('in-p2').value = setup.p2;
  document.querySelectorAll('#seg-firstserve .seg-btn').forEach((b) =>
    b.classList.toggle('on', b.dataset.serve === setup.firstServe));
  // server/receiver pickers only make sense in doubles
  $('serve-pickers').classList.toggle('hidden', singles);
  renderChips();
  renderServePickers();
}

function renderChips() {
  ['A', 'B'].forEach((side) => {
    const box = $('chips-' + side);
    box.innerHTML = '';
    if (!teams.length) {
      box.innerHTML = '<p class="empty">NO TEAMS YET —<br>REGISTER BELOW ▼</p>';
      return;
    }
    teams.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'team-chip';
      const mine = (side === 'A' ? setup.teamA : setup.teamB) === t.id;
      const taken = (side === 'A' ? setup.teamB : setup.teamA) === t.id;
      if (mine) btn.classList.add(side === 'A' ? 'on-a' : 'on-b');
      if (taken) btn.classList.add('dim-out');
      btn.innerHTML = `${t.name}<span class="roster">${t.players.join(' + ')}</span>`;
      btn.addEventListener('click', () => {
        if (taken) { sfx.error(); return; }
        if (side === 'A') setup.teamA = t.id; else setup.teamB = t.id;
        setup.server = 0; setup.receiver = 0;
        sfx.select(); hap.tap();
        renderSetup();
      });
      box.appendChild(btn);
    });
  });
}

function renderServePickers() {
  const svId = setup.firstServe === 'A' ? setup.teamA : setup.teamB;
  const rcId = setup.firstServe === 'A' ? setup.teamB : setup.teamA;
  const build = (boxId, team, sel, key) => {
    const box = $(boxId);
    box.innerHTML = '';
    if (!team) { box.innerHTML = '<p class="empty micro dim">PICK TEAMS FIRST</p>'; return; }
    team.players.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pp-btn' + (sel === i ? ' on' : '');
      b.textContent = p;
      b.addEventListener('click', () => {
        setup[key] = i;
        sfx.select(); hap.tap();
        renderServePickers();
      });
      box.appendChild(b);
    });
  };
  build('pick-server', teamById(svId), setup.server, 'server');
  build('pick-receiver', teamById(rcId), setup.receiver, 'receiver');
}

/* ---------- court screen ---------- */
function renderCourt() {
  if (!M) return;
  $('court-label').textContent = `${M.stage} · GAME ${M.game}`;
  const rec = receiverInfo();

  ['A', 'B'].forEach((side) => {
    $('name-' + side).textContent = M.teams[side].name;
    $('score-' + side).textContent = M.score[side];
    $('flag-' + side).classList.toggle('on', M.serving === side && !M.finished);
    renderPlayers(side, rec);
  });

  $('serve-call').innerHTML = `CALL&nbsp;<b>${serveCall()}</b>`;
  const im = $('info-msg');
  if (im.textContent !== M.msg) {
    im.textContent = M.msg;
    im.classList.remove('new');
    void im.offsetWidth;
    im.classList.add('new');
  }
  renderTimer();
  paintBalls();
}

/* two rows per team, mirroring where each player stands on court
   (bird's-eye view, net down the middle):
   left team's right service court is the BOTTOM row, the right team's
   right court is the TOP row — so the serve's diagonal reads correctly.
   Slots are persistent DOM nodes moved with a transform transition, so
   court swaps play as visible movement instead of an instant repaint. */
function courtRow(side, idx) {
  const onRight = courtOf(side, idx) === 'right';
  return side === 'A' ? (onRight ? 1 : 0) : (onRight ? 0 : 1);
}
function renderPlayers(side, rec) {
  const box = $('players-' + side);
  const key = M.teams[side].players.join('|');
  if (box.dataset.key !== key) {                 // (re)build once per roster
    box.dataset.key = key;
    box.innerHTML = '';
    M.teams[side].players.forEach((_, i) => {
      const slot = document.createElement('div');
      slot.className = 'player-slot';
      slot.dataset.idx = i;
      slot.innerHTML =
        '<span class="player-chip"><span class="role"></span><span class="p-name"></span></span>';
      box.appendChild(slot);
    });
  }
  M.teams[side].players.forEach((p, i) => {
    const slot = box.querySelector(`[data-idx="${i}"]`);
    const chip = slot.firstElementChild;
    const isServer = !M.finished && M.serving === side && M.server === i;
    const isRecv = !M.finished && rec.side === side && rec.idx === i;
    chip.querySelector('.p-name').textContent = p;
    chip.querySelector('.role').textContent = isServer ? 'SERVING' : isRecv ? 'RECEIVING' : '';
    chip.classList.toggle('serving', isServer);
    chip.classList.toggle('receiving', isRecv);
    slot.style.transform =
      courtRow(side, i) === 0 ? 'translateY(0)' : 'translateY(calc(100% + 1.4em))';
  });
}

function renderTimer() {
  if (!M) return;
  const el = $('timer');
  const digits = $('timer-digits');
  const elapsed = currentElapsed();
  if (M.scoring === 'timed') {
    const left = M.minutes * 60000 - elapsed;
    $('timer-mode').textContent = M.suddenDeath ? 'SUDDEN DEATH' : 'TIME LEFT';
    digits.textContent = M.suddenDeath ? '00:00' : fmtClock(left);
    digits.classList.toggle('low', !M.suddenDeath && left <= 60000);
    if (left <= 0 && !M.suddenDeath && !M.finished && !M.paused) onTimeUp();
  } else {
    $('timer-mode').textContent = 'TIME USED';
    digits.textContent = fmtClock(elapsed);
    digits.classList.remove('low');
  }
  el.classList.toggle('paused', M.paused && !M.finished);
  $('timer-state').textContent = M.finished ? 'FINAL'
    : M.paused ? '⏸ PAUSED — TAP TO RESUME' : 'TAP TO PAUSE';
}

/* ---------- fx ---------- */
function bumpScore(side) {
  const s = $('score-' + side);
  s.classList.remove('bump');
  void s.offsetWidth;
  s.classList.add('bump');
}
function flashHalf(side) {
  const h = $('half-' + side);
  h.classList.remove('flash');
  void h.offsetWidth;
  h.classList.add('flash');
}
function floatFx(side, text, gray = false) {
  const zone = $('zone-' + side);
  zone.querySelectorAll('.float-fx').forEach((n) => n.remove());
  const fx = document.createElement('div');
  fx.className = 'float-fx' + (gray ? ' gray' : '');
  fx.textContent = text;
  zone.appendChild(fx);
  setTimeout(() => fx.remove(), 850);
}
function confetti() {
  const layer = $('confetti-layer');
  const colors = ['#d7f205', '#33e0ff', '#ff9d3c', '#ff4d5e', '#e8f1ff'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('div');
    c.className = 'confetto';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 2 + 's';
    c.style.animationDelay = Math.random() * 0.8 + 's';
    const sz = 5 + Math.floor(Math.random() * 6);
    c.style.width = sz + 'px'; c.style.height = sz + 'px';
    layer.appendChild(c);
    setTimeout(() => c.remove(), 4600);
  }
}

/* ---------- winner overlay ---------- */
function showWinner(how) {
  $('winner-team').textContent = `${teamOf(M.winner)} WINS!`;
  const w = M.winner, l = otherSide(w);
  $('winner-score').textContent = `${M.score[w]} – ${M.score[l]}`;
  $('winner-sub').innerHTML =
    `${M.teams[w].players.join(' + ')}<br>DEF. ${M.teams[l].players.join(' + ')}<br>` +
    `${how} · ${fmtClock(M.elapsed)}`;
  $('overlay-winner').classList.remove('hidden');
}

/* ==========================================================
   TEAMS MODAL
   ========================================================== */
let editingId = null;
function renderTeamList() {
  const box = $('team-list');
  box.innerHTML = '';
  if (!teams.length) {
    box.innerHTML = '<p class="empty">NO TEAMS REGISTERED YET.<br>ADD YOUR FIRST TEAM ABOVE ▲</p>';
    return;
  }
  teams.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'team-row';
    row.innerHTML = `<div class="t-info"><div class="t-name">${t.name}</div>
      <div class="t-roster">${t.players.join(' + ')}</div></div>`;
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'px-btn sm'; edit.textContent = '✎';
    edit.setAttribute('aria-label', 'edit team');
    edit.addEventListener('click', () => {
      editingId = t.id;
      $('tf-name').value = t.name;
      $('tf-p1').value = t.players[0];
      $('tf-p2').value = t.players[1];
      $('team-form-legend').textContent = 'EDIT TEAM';
      $('tf-cancel').classList.remove('hidden');
      sfx.tap();
    });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'px-btn sm danger'; del.textContent = '✕';
    del.setAttribute('aria-label', 'delete team');
    del.addEventListener('click', () => {
      teams = teams.filter((x) => x.id !== t.id);
      if (setup.teamA === t.id) setup.teamA = null;
      if (setup.teamB === t.id) setup.teamB = null;
      persistTeams();
      sfx.sideout(); hap.tap();
      renderTeamList(); renderSetup();
    });
    row.append(edit, del);
    box.appendChild(row);
  });
}
function resetTeamForm() {
  editingId = null;
  $('tf-name').value = ''; $('tf-p1').value = ''; $('tf-p2').value = '';
  $('team-form-legend').textContent = 'NEW TEAM';
  $('tf-cancel').classList.add('hidden');
}
function saveTeamForm() {
  const name = $('tf-name').value.trim().toUpperCase();
  const p1 = $('tf-p1').value.trim().toUpperCase();
  const p2 = $('tf-p2').value.trim().toUpperCase();
  if (!name || !p1 || !p2) { sfx.error(); buzz(60); return; }
  if (editingId) {
    const t = teamById(editingId);
    if (t) { t.name = name; t.players = [p1, p2]; }
    // live match keeps its own copy on purpose (mid-game roster is frozen)
  } else {
    teams.push({ id: 't' + Date.now().toString(36), name, players: [p1, p2] });
  }
  persistTeams();
  sfx.select(); hap.tap();
  resetTeamForm();
  renderTeamList(); renderSetup();
}

/* ==========================================================
   WIRING
   ========================================================== */
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function startGame() {
  const err = $('setup-error');
  err.classList.add('hidden');
  setup.stage = ($('in-stage').value.trim() || 'MATCH').toUpperCase();
  if (setup.format === 'singles') {
    setup.p1 = $('in-p1').value.trim().toUpperCase();
    setup.p2 = $('in-p2').value.trim().toUpperCase();
    if (!setup.p1 || !setup.p2) {
      err.textContent = '⚠ ENTER BOTH PLAYER NAMES!';
      err.classList.remove('hidden');
      sfx.error(); buzz([60, 40, 60]);
      return;
    }
  } else if (!setup.teamA || !setup.teamB) {
    err.textContent = '⚠ SELECT A TEAM FOR EACH SIDE!';
    err.classList.remove('hidden');
    sfx.error(); buzz([60, 40, 60]);
    return;
  }
  M = newMatch();
  persistMatch();
  sfx.start(); buzz([30, 30, 30, 30, 80]);
  show('court');
  renderCourt();
  startTicker();
  keepAwake();
}

function endMatch(backToSetup = true) {
  M = null;
  localStorage.removeItem(LS.match);
  clearInterval(timerIv);
  closeModal('modal-settings');
  $('overlay-winner').classList.add('hidden');
  if (backToSetup) { show('setup'); renderSetup(); paintBalls(); }
}

const modeName = (m) =>
  `${m.ruleset === 'rally' ? 'RALLY' : 'TRADITIONAL'} · ` +
  (m.scoring === 'timed' ? `${m.minutes} MIN` : `${m.target} PTS`);

/* copy the live match's configuration back into the setup selections
   (used when restarting, rematching, or resuming after a reload) */
function syncSetupFromMatch() {
  setup.stage = M.stage;
  setup.game = M.game;
  setup.ruleset = M.ruleset;
  setup.format = M.format;
  setup.scoring = M.scoring;
  setup.target = M.target;
  setup.minutes = M.minutes;
  if (M.teamIds) { setup.teamA = M.teamIds.A; setup.teamB = M.teamIds.B; }
  if (M.format === 'singles') {
    setup.p1 = M.teams.A.players[0];
    setup.p2 = M.teams.B.players[0];
  }
  if (M.setup0) {
    setup.firstServe = M.setup0.firstServe;
    setup.server = M.setup0.server;
    setup.receiver = M.setup0.receiver;
  }
}

/* stop the current match and start it fresh with changed game-mode
   settings, keeping the sides, label and original serve/receive picks */
function restartWith(patch) {
  syncSetupFromMatch();
  Object.assign(setup, patch);
  if (setup.format === 'doubles' &&
      (!teamById(setup.teamA) || !teamById(setup.teamB))) { endMatch(); return; }
  $('overlay-winner').classList.add('hidden');
  closeModal('modal-settings');
  M = newMatch();
  M.msg = `MODE: ${modeName(M)} — FRESH GAME!`;
  persistMatch();
  sfx.start(); buzz([30, 30, 30, 30, 80]);
  renderCourt();
  startTicker();
}

function bind() {
  /* --- setup --- */
  $('in-stage').addEventListener('input', (e) => { setup.stage = e.target.value.toUpperCase(); });
  $('game-minus').addEventListener('click', () => { setup.game = Math.max(1, setup.game - 1); sfx.tap(); renderSetup(); });
  $('game-plus').addEventListener('click', () => { setup.game += 1; sfx.tap(); renderSetup(); });
  $('min-minus').addEventListener('click', () => { setup.minutes = Math.max(1, setup.minutes - 1); sfx.tap(); renderSetup(); });
  $('min-plus').addEventListener('click', () => { setup.minutes = Math.min(60, setup.minutes + 1); sfx.tap(); renderSetup(); });
  document.querySelectorAll('#seg-ruleset .seg-btn').forEach((b) =>
    b.addEventListener('click', () => { setup.ruleset = b.dataset.ruleset; sfx.select(); hap.tap(); renderSetup(); }));
  document.querySelectorAll('#seg-format .seg-btn').forEach((b) =>
    b.addEventListener('click', () => { setup.format = b.dataset.format; sfx.select(); hap.tap(); renderSetup(); }));
  document.querySelectorAll('#seg-scoring .seg-btn').forEach((b) =>
    b.addEventListener('click', () => { setup.scoring = b.dataset.scoring; sfx.select(); hap.tap(); renderSetup(); }));
  document.querySelectorAll('#seg-target .seg-btn').forEach((b) =>
    b.addEventListener('click', () => { setup.target = Number(b.dataset.target); sfx.select(); hap.tap(); renderSetup(); }));
  $('in-p1').addEventListener('input', (e) => { setup.p1 = e.target.value.toUpperCase(); });
  $('in-p2').addEventListener('input', (e) => { setup.p2 = e.target.value.toUpperCase(); });
  document.querySelectorAll('#seg-firstserve .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      setup.firstServe = b.dataset.serve;
      setup.server = 0; setup.receiver = 0;
      sfx.select(); hap.tap(); renderSetup();
    }));
  $('btn-manage-teams').addEventListener('click', () => { resetTeamForm(); renderTeamList(); openModal('modal-teams'); sfx.tap(); });
  $('btn-start').addEventListener('click', startGame);

  /* --- court --- */
  const zoneHandler = (side) => (e) => {
    if (e.button !== undefined && e.button !== 0) return; // primary button/touch only
    e.preventDefault();
    rallyWon(side);
  };
  $('zone-A').addEventListener('pointerdown', zoneHandler('A'));
  $('zone-B').addEventListener('pointerdown', zoneHandler('B'));
  $('btn-undo').addEventListener('click', undo);
  $('timer').addEventListener('click', togglePause);
  $('btn-settings').addEventListener('click', () => {
    renderLiveSettings();
    openModal('modal-settings');
    sfx.tap();
  });

  /* --- settings modal --- */
  // changing the game mode mid-match stops the match and starts it fresh
  // (same sides, label and original serve/receive picks) under the new rules
  document.querySelectorAll('#seg-ruleset-live .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      if (!M || b.dataset.ruleset === M.ruleset) return;
      restartWith({ ruleset: b.dataset.ruleset });
    }));
  document.querySelectorAll('#seg-scoring-live .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      if (!M || b.dataset.scoring === M.scoring) return;
      restartWith({ scoring: b.dataset.scoring });
    }));
  document.querySelectorAll('#seg-target-live .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      if (!M || Number(b.dataset.target) === M.target) return;
      restartWith({ target: Number(b.dataset.target) });
    }));
  $('min-minus-live').addEventListener('click', () => { if (!M) return; M.minutes = Math.max(1, M.minutes - 1); M.suddenDeath = false; sfx.tap(); persistMatch(); renderLiveSettings(); renderTimer(); });
  $('min-plus-live').addEventListener('click', () => { if (!M) return; M.minutes = Math.min(60, M.minutes + 1); M.suddenDeath = false; sfx.tap(); persistMatch(); renderLiveSettings(); renderTimer(); });
  $('tgl-sound').addEventListener('click', () => { prefs.sound = !prefs.sound; persistPrefs(); renderLiveSettings(); sfx.select(); });
  $('tgl-haptic').addEventListener('click', () => { prefs.haptic = !prefs.haptic; persistPrefs(); renderLiveSettings(); hap.tap(); });
  $('btn-teams-live').addEventListener('click', () => { resetTeamForm(); renderTeamList(); openModal('modal-teams'); sfx.tap(); });
  $('btn-end-match').addEventListener('click', () => {
    if (confirm('End this match and return to setup?')) endMatch();
  });

  /* --- teams modal --- */
  $('tf-save').addEventListener('click', saveTeamForm);
  $('tf-cancel').addEventListener('click', () => { resetTeamForm(); sfx.tap(); });

  /* --- winner overlay --- */
  $('btn-rematch').addEventListener('click', () => {
    // same sides, same settings, loser serves first next game
    syncSetupFromMatch();
    setup.game = M.game + 1;
    setup.firstServe = otherSide(M.winner);
    setup.server = 0; setup.receiver = 0;
    if (setup.format === 'doubles' &&
        (!teamById(setup.teamA) || !teamById(setup.teamB))) { endMatch(); return; }
    $('overlay-winner').classList.add('hidden');
    M = newMatch();
    persistMatch();
    sfx.start(); buzz([30, 30, 30, 30, 80]);
    renderCourt();
    startTicker();
  });
  $('btn-new-match').addEventListener('click', () => {
    setup.game = M ? M.game + 1 : setup.game + 1;
    if (M) setup.stage = M.stage;
    endMatch();
    sfx.tap();
  });

  /* --- modal close buttons + backdrop --- */
  document.querySelectorAll('.modal [data-close]').forEach((b) =>
    b.addEventListener('click', () => { b.closest('.modal').classList.add('hidden'); sfx.tap(); }));
  ['modal-settings', 'modal-teams'].forEach((id) =>
    $(id).addEventListener('click', (e) => { if (e.target.id === id) closeModal(id); }));

  /* keyboard shortcuts for desktop judges */
  document.addEventListener('keydown', (e) => {
    if ($('screen-court').classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT') return;
    const blocked = [...document.querySelectorAll('.modal')].some(
      (m) => !m.classList.contains('hidden') && m.id !== 'overlay-winner');
    if (blocked) return;
    if (!$('overlay-winner').classList.contains('hidden') &&
        e.key !== 'u' && e.key !== 'Backspace') return;
    if (e.key === 'ArrowLeft' || e.key === 'a') rallyWon('A');
    else if (e.key === 'ArrowRight' || e.key === 'l') rallyWon('B');
    else if (e.key === 'u' || e.key === 'Backspace') { e.preventDefault(); undo(); }
    else if (e.key === ' ') { e.preventDefault(); togglePause(); }
  });

  /* unlock audio on first interaction (mobile autoplay policy) */
  document.addEventListener('pointerdown', function unlock() {
    unlockAudio();
    document.removeEventListener('pointerdown', unlock);
  }, { once: true });
}

function renderLiveSettings() {
  if (M) {
    document.querySelectorAll('#seg-ruleset-live .seg-btn').forEach((b) =>
      b.classList.toggle('on', b.dataset.ruleset === M.ruleset));
    document.querySelectorAll('#seg-scoring-live .seg-btn').forEach((b) =>
      b.classList.toggle('on', b.dataset.scoring === M.scoring));
    document.querySelectorAll('#seg-target-live .seg-btn').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.target) === M.target));
    $('target-row-live').classList.toggle('hidden', M.scoring !== 'points');
    $('timed-row-live').classList.toggle('hidden', M.scoring !== 'timed');
    $('out-min-live').textContent = M.minutes;
  }
  const ts = $('tgl-sound'), th = $('tgl-haptic');
  ts.textContent = `🔊 SOUND: ${prefs.sound ? 'ON' : 'OFF'}`;
  ts.classList.toggle('off', !prefs.sound);
  if (HAPTIC_SUPPORTED) {
    th.textContent = `📳 HAPTIC: ${prefs.haptic ? 'ON' : 'OFF'}`;
    th.classList.toggle('off', !prefs.haptic);
  } else {
    th.textContent = '📳 HAPTIC: UNSUPPORTED';
    th.classList.add('off');
    th.disabled = true;
    th.title = 'This browser (e.g. iOS Safari) does not support vibration feedback';
  }
}

/* migrate a match persisted by an older app version (mode-string era)
   into the ruleset/format/scoring model so it keeps working */
function migrateMatch(m) {
  if (!m || m.ruleset) return m;
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

/* ---------------------------------------------------------- boot */
function boot() {
  bind();
  M = migrateMatch(M);
  if (M && !M.finished) {
    // resume an in-progress match, paused (time away doesn't count)
    M.paused = true;
    M.elapsed = M.elapsed || 0;
    // sync setup selections so rematch / next-match carry over after reload
    syncSetupFromMatch();
    show('court');
    renderCourt();
    startTicker();
    keepAwake();
  } else {
    M = null;
    localStorage.removeItem(LS.match);
    show('setup');
    renderSetup();
  }
  paintBalls();
}
boot();
