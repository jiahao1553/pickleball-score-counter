/* 8-bit Web Audio bleeps. `enabled` is toggled from prefs so the pure
   sfx callers don't need to know about React state. */
let actx = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = on; }

function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended' || actx.state === 'interrupted') actx.resume();
  return actx;
}

/* iOS only fully arms the audio pipeline if a sound is actually started
   inside the unlocking gesture — creating/resuming the context is not
   enough on its own. Play one silent, zero-length buffer to unlock it. */
export function unlockAudio() {
  try {
    const ctx = audio();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {}
}

/* iOS suspends the AudioContext whenever the app is backgrounded (screen
   lock, app switch, phone call) and never resumes it on its own. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && actx) audio();
  });
}

function tone(freq, dur, delay = 0, type = 'square', vol = 0.12) {
  if (!enabled) return;
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

export const sfx = {
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
