import { useState } from 'react';
import { useApp } from '../store/AppStore.jsx';
import { sfx } from '../lib/audio.js';
import { buzz } from '../lib/haptics.js';

export function TeamsModal({ onClose }) {
  const { teams, saveTeam, deleteTeam } = useApp();
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');

  const reset = () => { setEditingId(null); setName(''); setP1(''); setP2(''); };

  const submit = () => {
    const n = name.trim().toUpperCase();
    const a = p1.trim().toUpperCase();
    const b = p2.trim().toUpperCase();
    if (!n || !a || !b) { sfx.error(); buzz(60); return; }
    saveTeam(editingId, n, [a, b]);
    reset();
  };

  const edit = (t) => {
    setEditingId(t.id);
    setName(t.name);
    setP1(t.players[0]);
    setP2(t.players[1]);
    sfx.tap();
  };

  return (
    <div className="modal" id="modal-teams" role="dialog" aria-modal="true" aria-label="manage teams"
      onClick={(e) => { if (e.target.id === 'modal-teams') onClose(); }}>
      <div className="modal-box">
        <header className="modal-head">
          <h3>⊞ TEAMS</h3>
          <button type="button" className="px-btn icon" data-close="true" aria-label="close"
            onClick={() => { onClose(); sfx.tap(); }}>✕</button>
        </header>
        <div className="modal-body">
          <fieldset className="panel">
            <legend id="team-form-legend">{editingId ? 'EDIT TEAM' : 'NEW TEAM'}</legend>
            <label className="field">
              <span className="field-label">TEAM NAME</span>
              <input id="tf-name" type="text" maxLength={16} placeholder="DINK DYNASTY" autoComplete="off"
                value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field grow">
                <span className="field-label">PLAYER 1 <span className="micro">(e.g. TAN W.L.)</span></span>
                <input id="tf-p1" type="text" maxLength={12} placeholder="TAN W.L." autoComplete="off"
                  value={p1} onChange={(e) => setP1(e.target.value)} />
              </label>
              <label className="field grow">
                <span className="field-label">PLAYER 2</span>
                <input id="tf-p2" type="text" maxLength={12} placeholder="LIM J.H." autoComplete="off"
                  value={p2} onChange={(e) => setP2(e.target.value)} />
              </label>
            </div>
            <p className="micro dim">USE OLYMPIC SHORT FORM — SURNAME + INITIALS</p>
            <div className="toggle-row">
              <button type="button" className="px-btn accent" id="tf-save" onClick={submit}>
                ✔ SAVE TEAM
              </button>
              {editingId && (
                <button type="button" className="px-btn ghost" id="tf-cancel"
                  onClick={() => { reset(); sfx.tap(); }}>CANCEL</button>
              )}
            </div>
          </fieldset>
          <div id="team-list" className="team-list">
            {!teams.length && (
              <p className="empty">NO TEAMS REGISTERED YET.<br />ADD YOUR FIRST TEAM ABOVE ▲</p>
            )}
            {teams.map((t) => (
              <div className="team-row" key={t.id}>
                <div className="t-info">
                  <div className="t-name">{t.name}</div>
                  <div className="t-roster">{t.players.join(' + ')}</div>
                </div>
                <button type="button" className="px-btn sm" aria-label="edit team"
                  onClick={() => edit(t)}>✎</button>
                <button type="button" className="px-btn sm danger" aria-label="delete team"
                  onClick={() => { deleteTeam(t.id); if (editingId === t.id) reset(); }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
