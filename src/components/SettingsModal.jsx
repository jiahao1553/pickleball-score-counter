import { useApp } from '../store/AppStore.jsx';
import { HAPTIC_SUPPORTED, hap, setHapticEnabled } from '../lib/haptics.js';
import { sfx, setSoundEnabled } from '../lib/audio.js';

function LiveSeg({ id, options, value, onPick }) {
  return (
    <div className="seg" id={id}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={`seg-btn ${value === o.value ? 'on' : ''}`}
          {...{ [`data-${o.data}`]: o.value }}
          onClick={() => { if (o.value !== value) onPick(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsModal({ onClose, onManageTeams, onEndMatch }) {
  const { match, prefs, setPrefs, restartWith, setMinutesLive } = useApp();

  return (
    <div className="modal" id="modal-settings" role="dialog" aria-modal="true" aria-label="settings"
      onClick={(e) => { if (e.target.id === 'modal-settings') onClose(); }}>
      <div className="modal-box">
        <header className="modal-head">
          <h3>⚙ SETTINGS</h3>
          <button type="button" className="px-btn icon" data-close="true" aria-label="close"
            onClick={() => { onClose(); sfx.tap(); }}>✕</button>
        </header>
        <div className="modal-body">
          {match && (
            <fieldset className="panel">
              <legend>GAME MODE</legend>
              <p className="micro dim" style={{ margin: '0 0 .8em' }}>
                CHANGING RULES, SCORING OR TARGET RESTARTS THE GAME FRESH
              </p>
              <span className="mode-lbl">RULES</span>
              <LiveSeg id="seg-ruleset-live" value={match.ruleset}
                options={[
                  { value: 'traditional', label: 'TRADITIONAL', data: 'ruleset' },
                  { value: 'rally', label: 'RALLY', data: 'ruleset' },
                ]}
                onPick={(v) => { restartWith({ ruleset: v }); onClose(); }} />
              <span className="mode-lbl">SCORING</span>
              <LiveSeg id="seg-scoring-live" value={match.scoring}
                options={[
                  { value: 'points', label: 'POINTS', data: 'scoring' },
                  { value: 'timed', label: '⏱ TIMED', data: 'scoring' },
                ]}
                onPick={(v) => { restartWith({ scoring: v }); onClose(); }} />
              {match.scoring === 'points' && (
                <div id="target-row-live">
                  <span className="mode-lbl">PLAY TO</span>
                  <LiveSeg id="seg-target-live" value={match.target}
                    options={[11, 15, 21].map((n) => ({ value: n, label: String(n), data: 'target' }))}
                    onPick={(v) => { restartWith({ target: v }); onClose(); }} />
                </div>
              )}
              {match.scoring === 'timed' && (
                <div className="field-row" id="timed-row-live">
                  <div className="field">
                    <span className="field-label">MINUTES</span>
                    <div className="stepper">
                      <button type="button" className="px-btn sm" id="min-minus-live"
                        onClick={() => setMinutesLive(Math.max(1, match.minutes - 1))}>−</button>
                      <output id="out-min-live">{match.minutes}</output>
                      <button type="button" className="px-btn sm" id="min-plus-live"
                        onClick={() => setMinutesLive(Math.min(60, match.minutes + 1))}>+</button>
                    </div>
                  </div>
                </div>
              )}
            </fieldset>
          )}
          <fieldset className="panel">
            <legend>FEEDBACK</legend>
            <div className="toggle-row">
              <button type="button" className={`px-btn toggle${prefs.sound ? '' : ' off'}`} id="tgl-sound"
                onClick={() => {
                  // flip the module flag before playing so turning sound
                  // ON gives its confirmation beep immediately
                  setSoundEnabled(!prefs.sound);
                  setPrefs({ sound: !prefs.sound });
                  sfx.select();
                }}>
                🔊 SOUND: {prefs.sound ? 'ON' : 'OFF'}
              </button>
              <button
                type="button" id="tgl-haptic"
                className={`px-btn toggle${prefs.haptic && HAPTIC_SUPPORTED ? '' : ' off'}`}
                disabled={!HAPTIC_SUPPORTED}
                title={HAPTIC_SUPPORTED ? undefined
                  : 'This browser (e.g. iOS Safari) does not support vibration feedback'}
                onClick={() => {
                  setHapticEnabled(!prefs.haptic);
                  setPrefs({ haptic: !prefs.haptic });
                  hap.tap();
                }}
              >
                📳 HAPTIC: {HAPTIC_SUPPORTED ? (prefs.haptic ? 'ON' : 'OFF') : 'UNSUPPORTED'}
              </button>
            </div>
          </fieldset>
          <fieldset className="panel">
            <legend>MATCH</legend>
            <div className="toggle-row">
              <button type="button" className="px-btn ghost" id="btn-teams-live"
                onClick={() => { onManageTeams(); sfx.tap(); }}>⊞ TEAMS</button>
              <button type="button" className="px-btn danger" id="btn-end-match"
                onClick={() => {
                  if (window.confirm('End this match and return to setup?')) onEndMatch();
                }}>■ END MATCH</button>
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
