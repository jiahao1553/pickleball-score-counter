/* 8-bit Web Audio bleeps. `enabled` is toggled from prefs so the pure
   sfx callers don't need to know about React state.

   Mobile unlock strategy: browsers only allow audio to start inside a
   user-activation gesture, and on touch screens activation is granted
   at pointerUP / touchend / click — NOT at pointerdown, which is what
   the score zones listen to. So sounds requested while the context is
   locked are queued, and persistent capture listeners on the
   activation-granting events unlock the context (resume + a silent
   buffer, which iOS needs to actually arm the output) and replay the
   queued sound. Worst case the first tap's feedback lands at finger
   lift; everything after plays instantly. */
let actx = null;
let enabled = true;
let pendingSfx = null;

export function setSoundEnabled(on) { enabled = on; }

function ensureCtx() {
  if (actx && actx.state === 'closed') actx = null;
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}
const running = () => actx && actx.state === 'running';

function flushPending() {
  if (pendingSfx && running()) {
    const play = pendingSfx;
    pendingSfx = null;
    play();
  }
}

/* resume + silent one-sample buffer: iOS only fully arms the audio
   pipeline if a sound actually starts inside the unlocking gesture */
export function unlockAudio() {
  try {
    const ctx = ensureCtx();
    if (ctx.state !== 'running') {
      ctx.resume().then(flushPending).catch(() => {});
    }
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    flushPending();
  } catch {}
}

if (typeof document !== 'undefined') {
  /* iOS suspends the AudioContext whenever the app is backgrounded
     (screen lock, app switch, phone call) and never resumes it on its
     own; try on return, and the gesture listeners below cover the rest */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && actx) {
      try { actx.resume().then(flushPending).catch(() => {}); } catch {}
    }
  });
  /* persistent unlock on every activation-granting gesture — heals the
     context after interruptions, and catches the case where the user's
     first-ever interaction is a pointerdown-only score tap */
  ['pointerup', 'touchend', 'mousedown', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => {
      if (!running()) unlockAudio();
      else flushPending();
    }, { capture: true, passive: true }));
}

function tone(freq, dur, delay = 0, type = 'square', vol = 0.12) {
  try {
    const ctx = ensureCtx();
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

/* wrap each pattern: play now if the context is live, otherwise queue
   the latest request for the unlock listeners to replay */
function play(fn) {
  if (!enabled) return;
  try {
    if (running()) { fn(); return; }
    pendingSfx = fn;
    ensureCtx().resume().then(flushPending).catch(() => {});
  } catch {}
}

export const sfx = {
  tap()    { play(() => tone(240, 0.05, 0, 'triangle', 0.1)); },
  select() { play(() => { tone(520, 0.06); tone(700, 0.08, 0.06); }); },
  point()  { play(() => { tone(660, 0.09); tone(880, 0.14, 0.09); }); },
  gain()   { play(() => { tone(660, 0.09); tone(880, 0.14, 0.09); tone(988, 0.12, 0.2); }); },
  second() { play(() => { tone(494, 0.09); tone(392, 0.12, 0.09); }); },
  sideout(){ play(() => { tone(440, 0.1); tone(294, 0.12, 0.1); tone(220, 0.16, 0.2); }); },
  start()  { play(() => { tone(392, 0.09); tone(523, 0.09, 0.1); tone(659, 0.18, 0.2); }); },
  win()    { play(() => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.14, i * 0.12))); },
  timeup() { play(() => { tone(880, 0.3, 0, 'sawtooth', 0.09); tone(880, 0.3, 0.4, 'sawtooth', 0.09); }); },
  error()  { play(() => tone(150, 0.2, 0, 'sawtooth', 0.1)); },
};
