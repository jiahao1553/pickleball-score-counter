import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppStore.jsx';
import { PixelBall } from './PixelBall.jsx';
import * as rules from '../lib/rules.js';
import { sfx } from '../lib/audio.js';
import { useTicker } from '../hooks/useTicker.js';
import { useWakeLock } from '../hooks/useWakeLock.js';

/* floating "+1" / "SIDE OUT" feedback text over a score zone */
const FX_TEXT = {
  point: { text: '+1', gray: false },
  gain: { text: '+1 · SERVE', gray: false },
  second: { text: '2ND SERVER', gray: true },
  sideout: { text: 'SIDE OUT', gray: true },
};

function Timer() {
  const { match, togglePause, timeUp } = useApp();
  const running = match && !match.finished && !match.paused;
  useTicker(running);
  const elapsed = rules.currentElapsed(match);
  const timed = match.scoring === 'timed';
  const left = timed ? match.minutes * 60000 - elapsed : 0;

  useEffect(() => {
    if (timed && running && !match.suddenDeath && left <= 0) timeUp();
  });

  const digits = timed
    ? (match.suddenDeath ? '00:00' : rules.fmtClock(left))
    : rules.fmtClock(elapsed);
  const low = timed && !match.suddenDeath && left <= 60000;

  return (
    <button
      type="button" id="timer"
      className={`timer${match.paused && !match.finished ? ' paused' : ''}`}
      aria-label="tap to pause or resume" onClick={togglePause}
    >
      <span className="timer-mode" id="timer-mode">
        {timed ? (match.suddenDeath ? 'SUDDEN DEATH' : 'TIME LEFT') : 'TIME USED'}
      </span>
      <span className={`timer-digits${low ? ' low' : ''}`} id="timer-digits">{digits}</span>
      <span className="timer-state" id="timer-state">
        {match.finished ? 'FINAL' : match.paused ? '⏸ PAUSED — TAP TO RESUME' : 'TAP TO PAUSE'}
      </span>
    </button>
  );
}

function PlayerRows({ side, rec }) {
  const { match } = useApp();
  return (
    <div className="players" id={`players-${side}`}>
      {match.teams[side].players.map((p, i) => {
        const isServer = !match.finished && match.serving === side && match.server === i;
        const isRecv = !match.finished && rec.side === side && rec.idx === i;
        const row = rules.courtRow(match, side, i);
        return (
          <div
            key={i} className="player-slot" data-idx={i}
            style={{ transform: row === 0 ? 'translateY(0)' : 'translateY(calc(100% + 1.4em))' }}
          >
            <span className={`player-chip${isServer ? ' serving' : ''}${isRecv ? ' receiving' : ''}`}>
              <span className="role">{isServer ? 'SERVING' : isRecv ? 'RECEIVING' : ''}</span>
              <span className="p-name">{p}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TeamHalf({ side, rec, floats }) {
  const { match, rallyWon, fx } = useApp();
  const halfRef = useRef(null);
  const scoreRef = useRef(null);

  // score bump / half flash animations, retriggered via class reflow so
  // they never remount the slots mid-slide
  useEffect(() => {
    if (!fx || fx.side !== side) return;
    if (fx.type === 'point' || fx.type === 'gain' || fx.type === 'win') {
      const el = scoreRef.current;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    if (fx.type === 'sideout' || fx.type === 'gain') {
      const el = halfRef.current;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }, [fx, side]);

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return; // primary button/touch only
    e.preventDefault();
    rallyWon(side);
  };

  return (
    <div
      className={`team-half half-${side.toLowerCase()}`}
      id={`half-${side}`} data-team={side} ref={halfRef}
    >
      <div className="team-head">
        <div className={`serve-flag${match.serving === side && !match.finished ? ' on' : ''}`}
          id={`flag-${side}`}>
          <PixelBall size="xs" /> SERVE
        </div>
        <h2 className="team-name" id={`name-${side}`}>{match.teams[side].name}</h2>
        <PlayerRows side={side} rec={rec} />
      </div>
      <div
        className="score-zone" id={`zone-${side}`}
        role="button" aria-label={`rally won by ${side === 'A' ? 'left' : 'right'} team`}
        onPointerDown={onDown}
      >
        <div className="score" id={`score-${side}`} ref={scoreRef}>{match.score[side]}</div>
        <div className="tap-hint">TAP = RALLY WON</div>
        {floats.map((f) => (
          <div key={f.at} className={`float-fx${f.gray ? ' gray' : ''}`}>{f.text}</div>
        ))}
      </div>
    </div>
  );
}

export function CourtScreen({ onOpenSettings }) {
  const { match, fx, undo } = useApp();
  const [floats, setFloats] = useState({ A: [], B: [] });
  useWakeLock(match && !match.finished);

  // spawn floating feedback when the engine reports an fx
  useEffect(() => {
    if (!fx || !FX_TEXT[fx.type]) return;
    const spec = FX_TEXT[fx.type];
    setFloats((f) => ({ ...f, [fx.side]: [{ ...spec, at: fx.at }] }));
    const t = setTimeout(() =>
      setFloats((f) => ({ ...f, [fx.side]: f[fx.side].filter((x) => x.at !== fx.at) })), 850);
    return () => clearTimeout(t);
  }, [fx]);

  const rec = rules.receiverInfo(match);

  return (
    <section id="screen-court" className="screen">
      <header className="court-top">
        <button type="button" className="px-btn icon" id="btn-undo" aria-label="undo last rally"
          onClick={undo}>↶</button>
        <div className="match-label" id="court-label">{match.stage} · GAME {match.game}</div>
        <button type="button" className="px-btn icon" id="btn-settings" aria-label="settings"
          onClick={() => { onOpenSettings(); sfx.tap(); }}>⚙</button>
      </header>

      <Timer />

      <div className="court" id="court">
        <div className="net" aria-hidden="true" />
        <TeamHalf side="A" rec={rec} floats={floats.A} />
        <TeamHalf side="B" rec={rec} floats={floats.B} />
      </div>

      <footer className="info-bar">
        <div className="serve-call" id="serve-call">
          CALL&nbsp;<b>{rules.serveCall(match)}</b>
        </div>
        <InfoMsg msg={match.msg} />
      </footer>
    </section>
  );
}

function InfoMsg({ msg }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.classList.remove('new');
    void el.offsetWidth;
    el.classList.add('new');
  }, [msg]);
  return <div className="info-msg" id="info-msg" ref={ref}>{msg}</div>;
}
