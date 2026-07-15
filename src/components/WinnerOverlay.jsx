import { useEffect, useState } from 'react';
import { useApp } from '../store/AppStore.jsx';
import * as rules from '../lib/rules.js';

const CONFETTI_COLORS = ['#d7f205', '#33e0ff', '#ff9d3c', '#ff4d5e', '#e8f1ff'];

function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: 90 }, (_, i) => ({
      left: Math.random() * 100,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      dur: 1.6 + Math.random() * 2,
      delay: Math.random() * 0.8,
      size: 5 + Math.floor(Math.random() * 6),
    })));
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 4600);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div id="confetti-layer" aria-hidden="true">
      {pieces.map((p, i) => (
        <div key={i} className="confetto" style={{
          left: `${p.left}vw`, background: p.color,
          animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`,
          width: p.size, height: p.size,
        }} />
      ))}
    </div>
  );
}

export function WinnerOverlay({ onNextMatch }) {
  const { match, rematch } = useApp();
  const w = match.winner, l = rules.otherSide(w);

  return (
    <>
      <div className="modal" id="overlay-winner">
        <div className="winner-box">
          <div className="winner-banner">🏆 GAME!</div>
          <div className="winner-team" id="winner-team">{rules.teamOf(match, w)} WINS!</div>
          <div className="winner-score" id="winner-score">
            {match.score[w]} – {match.score[l]}
          </div>
          <div className="winner-sub" id="winner-sub">
            {match.teams[w].players.join(' + ')}<br />
            DEF. {match.teams[l].players.join(' + ')}<br />
            {match.finishHow} · {rules.fmtClock(match.elapsed)}
          </div>
          <div className="toggle-row center">
            <button type="button" className="px-btn accent" id="btn-rematch" onClick={rematch}>
              ↺ REMATCH
            </button>
            <button type="button" className="px-btn" id="btn-new-match" onClick={onNextMatch}>
              ▶ NEXT MATCH
            </button>
          </div>
        </div>
      </div>
      <Confetti />
    </>
  );
}
