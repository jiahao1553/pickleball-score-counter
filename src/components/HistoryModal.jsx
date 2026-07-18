import { useState } from 'react';
import { loadHistory, loadRallies, deleteMatch, clearHistory } from '../lib/storage.js';
import * as rules from '../lib/rules.js';
import { sfx } from '../lib/audio.js';
import { hap, buzz } from '../lib/haptics.js';

const fmtDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const secs = (ms) => `${Math.max(0, Math.round(ms / 1000))}s`;

/* the per-rally breakdown for one game (score updates only, not the opening row) */
function RallyLog({ game }) {
  const [rows] = useState(() => loadRallies(game.id).filter((r) => r.wonBy));
  if (!rows.length) return <p className="micro dim">NO RALLY DETAIL RECORDED.</p>;
  return (
    <div className="rally-log">
      {rows.map((r) => (
        <div className="rally-row" key={r.seq}>
          <span className="rally-seq">{r.seq}</span>
          <span className="rally-desc">
            <span className={`side-${r.servedBy.side.toLowerCase()}`}>{r.servedBy.name}</span>
            {r.serveCall ? ` (${r.serveCall})` : ''} ▸ {r.receivedBy.name}
            {' · '}<span className={`side-${r.wonBy.toLowerCase()}`}>{game.teams[r.wonBy].name}</span> +1
            {' → '}{r.score.A}–{r.score.B}
          </span>
          <span className="rally-dur">{secs(r.dur)}</span>
        </div>
      ))}
    </div>
  );
}

export function HistoryModal({ onClose }) {
  // completed games are read once when the modal opens
  const [games, setGames] = useState(() => loadHistory());
  const [confirmClear, setConfirmClear] = useState(false);
  const [openId, setOpenId] = useState(null);

  const removeOne = (id) => {
    deleteMatch(id);
    setGames((g) => g.filter((x) => x.id !== id));
    if (openId === id) setOpenId(null);
    sfx.sideout(); hap.tap();
  };

  const clearAll = () => {
    if (!confirmClear) { setConfirmClear(true); sfx.tap(); return; }
    clearHistory();
    setGames([]);
    setConfirmClear(false);
    sfx.sideout(); buzz(60);
  };

  return (
    <div className="modal" id="modal-history" role="dialog" aria-modal="true" aria-label="match history"
      onClick={(e) => { if (e.target.id === 'modal-history') onClose(); }}>
      <div className="modal-box">
        <header className="modal-head">
          <h3>🏆 HISTORY</h3>
          <button type="button" className="px-btn icon" data-close="true" aria-label="close"
            onClick={() => { onClose(); sfx.tap(); }}>✕</button>
        </header>
        <div className="modal-body">
          {!games.length && (
            <p className="empty">NO COMPLETED GAMES YET.<br />FINISH A MATCH TO SEE IT HERE ▼</p>
          )}
          <div className="history-list">
            {games.map((g) => (
              <div className="hist-row" key={g.id}>
                <div className="hist-head">
                  <span className="hist-stage">{g.stage} · GAME {g.game}</span>
                  <span className="hist-date">{fmtDate(g.at)}</span>
                  <button type="button" className="px-btn sm danger" aria-label="delete game"
                    onClick={() => removeOne(g.id)}>✕</button>
                </div>
                <div className="hist-teams">
                  {['A', 'B'].map((side) => (
                    <div key={side}
                      className={`hist-team side-${side.toLowerCase()}${g.winner === side ? ' win' : ''}`}>
                      <span className="hist-tname">{g.winner === side ? '🏆 ' : ''}{g.teams[side].name}</span>
                      <span className="hist-roster">{g.teams[side].players.join(' + ')}</span>
                      <span className="hist-pts">{g.score[side]}</span>
                    </div>
                  ))}
                </div>
                <div className="hist-meta">
                  {rules.modeName({ ruleset: g.ruleset, scoring: g.scoring, minutes: g.minutes, target: g.target })}
                  {' · '}{g.format.toUpperCase()}{' · '}{g.finishHow} · {rules.fmtClock(g.elapsed)}
                </div>
                <button type="button" className="px-btn sm ghost hist-toggle"
                  aria-expanded={openId === g.id}
                  onClick={() => { setOpenId((id) => (id === g.id ? null : g.id)); sfx.tap(); }}>
                  {openId === g.id ? '▲ HIDE RALLIES' : `▼ ${g.rallies} RALLIES`}
                </button>
                {openId === g.id && <RallyLog game={g} />}
              </div>
            ))}
          </div>

          {!!games.length && (
            <button type="button" className={`px-btn wide ${confirmClear ? 'danger' : 'ghost'}`} id="btn-clear-history"
              onClick={clearAll} onMouseLeave={() => setConfirmClear(false)}>
              {confirmClear ? '⚠ TAP AGAIN TO CLEAR ALL' : '🗑 CLEAR HISTORY'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
