/* ==========================================================
   PICKLE POINT — app logic

   Two selectable scoring rulesets:

   SIMPLE (default) — badminton-style rally point scoring:
   - every rally scores, for whichever team wins it
   - winner keeps serving, alternating court side each point
   - if the receiver wins, serve passes to them; the player who
     serves is whichever partner did NOT serve last time their
     team held serve (defaults to the right-court player the
     first time a team ever serves)

   INTERNATIONAL (11/15/21/timed) — side-out doubles scoring:
   - only the serving team scores
   - game starts at 0-0-2 (first serving team gets one server)
   - server keeps serving while scoring, partners swap courts
   - fault on server #1 -> server #2; fault on #2 -> side out
   - after side out, the player on the right court is server #1
   - server serves from the court they stand in; receiver is the
     diagonally-opposite player on the receiving team
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
  mode: 'simple',        // 'simple' | '11' | '15' | '21' | 'timed'
  minutes: 10,
  teamA: teams[0] ? teams[0].id : null,
  teamB: teams[1] ? teams[1].id : null,
  firstServe: 'A',
  server: 0,             // player index on serving team
  receiver: 0,           // player index on receiving team
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
function newMatch() {
  const A = teamById(setup.teamA);
  const B = teamById(setup.teamB);
  const sv = setup.firstServe;                 // 'A' | 'B'
  const rc = otherSide(sv);
  const courts = { A: {}, B: {} };
  // first server starts on the right court, partner on the left
  courts[sv] = { right: setup.server, left: 1 - setup.server };
  // chosen receiver stands diagonal to the server -> right court
  courts[rc] = { right: setup.receiver, left: 1 - setup.receiver };
  const m = {
    stage: setup.stage, game: setup.game,
    mode: setup.mode, minutes: setup.minutes,
    teamIds: { A: A.id, B: B.id },
    teams: {
      A: { name: A.name, players: [...A.players] },
      B: { name: B.name, players: [...B.players] },
    },
    score: { A: 0, B: 0 },
    serving: sv,
    serverNum: 2,                              // international 0-0-2 start
    server: setup.server,                      // player index on serving team
    lastServer: { A: null, B: null },          // simple mode: last player to serve, per team
    setup0: { firstServe: sv, server: setup.server, receiver: setup.receiver },
    courts,
    elapsed: 0, runningSince: Date.now(), paused: false,
    finished: false, winner: null, suddenDeath: false,
    msg: `GAME ON! ${teamOf(sv, { teams: { A, B } })} SERVES FIRST`,
    history: [],
  };
  m.lastServer[sv] = setup.server;
  return m;
}
function teamOf(side, m = M) { return m.teams[side].name; }

function snapshot() {
  const { history, ...rest } = M;
  return JSON.parse(JSON.stringify(rest));
}

function serveCall() {
  const s = M.score[M.serving];
  const r = M.score[otherSide(M.serving)];
  if (M.mode === 'simple') return `${s}-${r}`;
  return `${s}-${r}-${M.serverNum}`;
}

/* which court the current server stands in ('right'|'left') */
function serverCourt() {
  const c = M.courts[M.serving];
  return c.right === M.server ? 'right' : 'left';
}
/* receiver: receiving team's player diagonal to the server */
function receiverInfo() {
  const rc = otherSide(M.serving);
  const idx = M.courts[rc][serverCourt()];
  return { side: rc, idx };
}

/* the judge taps the team that WON the rally */
let lastRallyAt = 0;
function rallyWon(side) {
  if (!M || M.finished) return;
  const now = Date.now();
  if (now - lastRallyAt < 250) return;         // guard accidental double taps
  lastRallyAt = now;
  // matches persisted before SIMPLE mode existed (including old history
  // snapshots restored via undo) have no lastServer field — migrate here,
  // the only place that touches it
  if (!M.lastServer) M.lastServer = { A: null, B: null };
  if (M.paused) { togglePause(); }             // auto-resume on play
  M.history.push(snapshot());
  if (M.history.length > 200) M.history.shift();

  if (M.mode === 'simple') {
    // rally point scoring — every rally scores, for whoever wins it
    M.score[side] += 1;
    bumpScore(side);
    if (side === M.serving) {
      // winner keeps serving; partners swap courts (alternate side)
      const c = M.courts[side];
      [c.right, c.left] = [c.left, c.right];
      M.msg = `POINT — ${teamOf(side)}! ${playerName(side, M.server)} SERVES AGAIN`;
      sfx.point(); hap.point();
      floatFx(side, '+1');
    } else {
      // serve passes to the receiver: whichever partner did NOT serve
      // last time this team held serve (right-court player, if never)
      const last = M.lastServer[side];
      const newServer = (last === null || last === undefined) ? M.courts[side].right : 1 - last;
      M.serving = side;
      M.server = newServer;
      M.msg = `POINT — ${teamOf(side)}! ${playerName(side, newServer)} TO SERVE`;
      sfx.gain(); hap.gain();
      floatFx(side, '+1 · SERVE');
      flashHalf(side);
    }
  } else if (side === M.serving) {
    // point for the serving team; partners swap courts, same server
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
  M.lastServer[M.serving] = M.server;
  checkWin();
  persistMatch();
  renderCourt();
}

function playerName(side, idx) { return M.teams[side].players[idx]; }

function checkWin() {
  const a = M.score.A, b = M.score.B;
  if (M.mode === 'timed') {
    if (M.suddenDeath && a !== b) finish(a > b ? 'A' : 'B', 'SUDDEN DEATH POINT');
    return;
  }
  const target = M.mode === 'simple' ? 11 : Number(M.mode);
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
  M = Object.assign(h.pop(), { history: h });
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
function renderSetup() {
  $('in-stage').value = setup.stage;
  $('out-game').textContent = setup.game;
  $('out-min').textContent = setup.minutes;
  $('timed-row').classList.toggle('hidden', setup.mode !== 'timed');
  document.querySelectorAll('#seg-mode .seg-btn').forEach((b) =>
    b.classList.toggle('on', b.dataset.mode === setup.mode));
  $('mode-hint').textContent = setup.mode === 'timed'
    ? `HIGHEST SCORE IN ${setup.minutes} MIN WINS · TIE = SUDDEN DEATH`
    : setup.mode === 'simple'
    ? `RALLY TO 11 · WIN BY 2 · EVERY RALLY SCORES — WINNER SERVES NEXT`
    : `RALLY TO ${setup.mode} · WIN BY 2 · SIDE-OUT SCORING`;
  document.querySelectorAll('#seg-firstserve .seg-btn').forEach((b) =>
    b.classList.toggle('on', b.dataset.serve === setup.firstServe));
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
  const onRight = M.courts[side].right === idx;
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
        '<span class="player-chip"><span class="p-name"></span><span class="role-in"></span></span>';
      box.appendChild(slot);
    });
  }
  M.teams[side].players.forEach((p, i) => {
    const slot = box.querySelector(`[data-idx="${i}"]`);
    const chip = slot.firstElementChild;
    const isServer = !M.finished && M.serving === side && M.server === i;
    const isRecv = !M.finished && rec.side === side && rec.idx === i;
    chip.querySelector('.p-name').textContent = p;
    chip.querySelector('.role-in').textContent = isServer ? 'SERVING' : isRecv ? 'RECEIVING' : '';
    chip.classList.toggle('serving', isServer);
    chip.classList.toggle('receiving', isRecv);
    slot.style.transform =
      courtRow(side, i) === 0 ? 'translateY(0)' : 'translateY(calc(100% + .5em))';
  });
}

function renderTimer() {
  if (!M) return;
  const el = $('timer');
  const digits = $('timer-digits');
  const elapsed = currentElapsed();
  if (M.mode === 'timed') {
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
  if (!setup.teamA || !setup.teamB) {
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

const modeName = (mode, minutes) =>
  mode === 'simple' ? 'SIMPLE' : mode === 'timed' ? `${minutes} MIN TIMED` : `${mode} PTS`;

/* stop the current match and start it fresh under a different game mode,
   keeping the teams, match label and original serve/receive selections */
function restartWithMode(mode) {
  setup.stage = M.stage;
  setup.game = M.game;
  setup.mode = mode;
  setup.minutes = M.minutes;
  if (M.teamIds) { setup.teamA = M.teamIds.A; setup.teamB = M.teamIds.B; }
  if (M.setup0) {
    setup.firstServe = M.setup0.firstServe;
    setup.server = M.setup0.server;
    setup.receiver = M.setup0.receiver;
  }
  if (!teamById(setup.teamA) || !teamById(setup.teamB)) { endMatch(); return; }
  $('overlay-winner').classList.add('hidden');
  closeModal('modal-settings');
  M = newMatch();
  M.msg = `MODE: ${modeName(mode, M.minutes)} — FRESH GAME!`;
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
  document.querySelectorAll('#seg-mode .seg-btn').forEach((b) =>
    b.addEventListener('click', () => { setup.mode = b.dataset.mode; sfx.select(); hap.tap(); renderSetup(); }));
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
  // (same teams, label and original serve/receive picks) under the new rules
  document.querySelectorAll('#seg-mode-live .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      if (!M || b.dataset.mode === M.mode) return;
      restartWithMode(b.dataset.mode);
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
    // same teams, same settings, loser serves first next game
    setup.game = M.game + 1;
    setup.stage = M.stage;
    setup.mode = M.mode;
    setup.minutes = M.minutes;
    setup.teamA = M.teamIds ? M.teamIds.A : setup.teamA;
    setup.teamB = M.teamIds ? M.teamIds.B : setup.teamB;
    setup.firstServe = otherSide(M.winner);
    setup.server = 0; setup.receiver = 0;
    if (!teamById(setup.teamA) || !teamById(setup.teamB)) { endMatch(); return; }
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
    document.querySelectorAll('#seg-mode-live .seg-btn').forEach((b) =>
      b.classList.toggle('on', b.dataset.mode === M.mode));
    $('timed-row-live').classList.toggle('hidden', M.mode !== 'timed');
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

/* ---------------------------------------------------------- boot */
function boot() {
  bind();
  if (M && !M.finished) {
    // resume an in-progress match, paused (time away doesn't count)
    M.paused = true;
    M.elapsed = M.elapsed || 0;
    // sync setup selections so rematch / next-match carry over after reload
    setup.stage = M.stage;
    setup.game = M.game;
    setup.mode = M.mode;
    setup.minutes = M.minutes;
    if (M.teamIds) { setup.teamA = M.teamIds.A; setup.teamB = M.teamIds.B; }
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
