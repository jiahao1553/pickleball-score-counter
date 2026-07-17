import { useState } from 'react';
import { useApp } from '../store/AppStore.jsx';
import { PixelBall } from './PixelBall.jsx';
import { sfx } from '../lib/audio.js';
import { hap, buzz } from '../lib/haptics.js';

function Seg({ id, options, value, onPick, btnClass = () => '' }) {
  return (
    <div className="seg" id={id}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={`seg-btn ${btnClass(o.value)} ${value === o.value ? 'on' : ''}`}
          {...{ [`data-${o.data}`]: o.value }}
          onClick={() => { onPick(o.value); sfx.select(); hap.tap(); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function modeHint(setup) {
  const rules = setup.ruleset === 'rally'
    ? 'EVERY RALLY SCORES — RECEIVERS SCORE + TAKE SERVE'
    : 'SIDE-OUT SCORING — ONLY THE SERVING SIDE SCORES';
  const win = setup.scoring === 'timed'
    ? `HIGHEST SCORE IN ${setup.minutes} MIN · TIE = SUDDEN DEATH`
    : `FIRST TO ${setup.target} · WIN BY 2`;
  return `${rules} · ${win}`;
}

export function SetupScreen({ onStart, onManageTeams, onOpenHistory }) {
  const { teams, players, setup, setSetup, startMatch } = useApp();
  const [error, setError] = useState(null);
  const singles = setup.format === 'singles';

  const teamById = (id) => teams.find((t) => t.id === id);
  const svId = setup.firstServe === 'A' ? setup.teamA : setup.teamB;
  const rcId = setup.firstServe === 'A' ? setup.teamB : setup.teamA;

  const start = () => {
    setError(null);
    const s = { ...setup, stage: (setup.stage.trim() || 'MATCH').toUpperCase() };
    if (singles) {
      s.p1 = s.p1.trim().toUpperCase();
      s.p2 = s.p2.trim().toUpperCase();
      if (!s.p1 || !s.p2) {
        setError('⚠ ENTER BOTH PLAYER NAMES!');
        sfx.error(); buzz([60, 40, 60]);
        return;
      }
    } else if (!s.teamA || !s.teamB) {
      setError('⚠ SELECT A TEAM FOR EACH SIDE!');
      sfx.error(); buzz([60, 40, 60]);
      return;
    }
    setSetup(s);
    startMatch(s);
    onStart();
  };

  const pickTeam = (side, t, taken) => {
    if (taken) { sfx.error(); return; }
    setSetup(side === 'A'
      ? { teamA: t.id, server: 0, receiver: 0 }
      : { teamB: t.id, server: 0, receiver: 0 });
    sfx.select(); hap.tap();
  };

  const chips = (side) => {
    if (!teams.length) {
      return <p className="empty">NO TEAMS YET —<br />REGISTER BELOW ▼</p>;
    }
    return teams.map((t) => {
      const mine = (side === 'A' ? setup.teamA : setup.teamB) === t.id;
      const taken = (side === 'A' ? setup.teamB : setup.teamA) === t.id;
      const cls = ['team-chip', mine ? (side === 'A' ? 'on-a' : 'on-b') : '',
        taken ? 'dim-out' : ''].join(' ').trim();
      return (
        <button key={t.id} type="button" className={cls} onClick={() => pickTeam(side, t, taken)}>
          {t.name}<span className="roster">{t.players.join(' + ')}</span>
        </button>
      );
    });
  };

  const playerPick = (team, sel, key) => {
    if (!team) return <p className="empty micro dim">PICK TEAMS FIRST</p>;
    return team.players.map((p, i) => (
      <button
        key={i} type="button" className={`pp-btn${sel === i ? ' on' : ''}`}
        onClick={() => { setSetup({ [key]: i }); sfx.select(); hap.tap(); }}
      >
        {p}
      </button>
    ));
  };

  return (
    <section id="screen-setup" className="screen">
      <header className="setup-header">
        <div className="logo-row">
          <PixelBall size="lg" />
          <h1>PICKLE&nbsp;POINT</h1>
          <PixelBall size="lg" flip />
        </div>
        <p className="tagline">TOURNAMENT SCORER · SINGLES &amp; DOUBLES</p>
        <div className="net-divider" aria-hidden="true" />
      </header>

      <div className="setup-body">
        {/* match label */}
        <fieldset className="panel">
          <legend>MATCH</legend>
          <div className="field-row">
            <label className="field grow">
              <span className="field-label">STAGE</span>
              <input
                id="in-stage" type="text" maxLength={14} autoComplete="off"
                value={setup.stage}
                onChange={(e) => setSetup({ stage: e.target.value.toUpperCase() })}
              />
            </label>
            <div className="field">
              <span className="field-label">GAME #</span>
              <div className="stepper">
                <button type="button" className="px-btn sm" id="game-minus" aria-label="decrease game number"
                  onClick={() => { setSetup({ game: Math.max(1, setup.game - 1) }); sfx.tap(); }}>−</button>
                <output id="out-game">{setup.game}</output>
                <button type="button" className="px-btn sm" id="game-plus" aria-label="increase game number"
                  onClick={() => { setSetup({ game: setup.game + 1 }); sfx.tap(); }}>+</button>
              </div>
            </div>
          </div>
        </fieldset>

        {/* roster: teams (doubles) / players (singles) */}
        <fieldset className="panel">
          <legend id="roster-legend">{singles ? 'PLAYERS' : 'TEAMS'}</legend>
          {!singles && (
            <div id="doubles-roster">
              <div className="side-pick">
                <div className="side-col" data-side="A">
                  <span className="side-tag side-a">◀ LEFT&nbsp;SIDE</span>
                  <div className="team-chips" id="chips-A">{chips('A')}</div>
                </div>
                <div className="vs-badge">VS</div>
                <div className="side-col" data-side="B">
                  <span className="side-tag side-b">RIGHT&nbsp;SIDE ▶</span>
                  <div className="team-chips" id="chips-B">{chips('B')}</div>
                </div>
              </div>
              <button type="button" className="px-btn wide ghost" id="btn-manage-teams"
                onClick={() => { onManageTeams(); sfx.tap(); }}>
                ⊞ REGISTER / MANAGE TEAMS
              </button>
            </div>
          )}
          {singles && (
            <div id="singles-roster">
              <div className="field-row">
                <label className="field grow">
                  <span className="field-label">◀ LEFT PLAYER</span>
                  <input id="in-p1" list="players-list" type="text" maxLength={12} placeholder="TAN W.L." autoComplete="off"
                    value={setup.p1}
                    onChange={(e) => setSetup({ p1: e.target.value.toUpperCase() })} />
                </label>
                <label className="field grow">
                  <span className="field-label">RIGHT PLAYER ▶</span>
                  <input id="in-p2" list="players-list" type="text" maxLength={12} placeholder="LEE M." autoComplete="off"
                    value={setup.p2}
                    onChange={(e) => setSetup({ p2: e.target.value.toUpperCase() })} />
                </label>
              </div>
              <datalist id="players-list">
                {players.map((p) => <option key={p} value={p} />)}
              </datalist>
              <p className="micro dim">PICK A SAVED NAME OR TYPE A NEW ONE · OLYMPIC SHORT FORM</p>
            </div>
          )}
        </fieldset>

        {/* game mode */}
        <fieldset className="panel">
          <legend>GAME MODE</legend>
          <span className="mode-lbl">RULES</span>
          <Seg id="seg-ruleset" value={setup.ruleset}
            options={[
              { value: 'traditional', label: 'TRADITIONAL', data: 'ruleset' },
              { value: 'rally', label: 'RALLY', data: 'ruleset' },
            ]}
            onPick={(v) => setSetup({ ruleset: v })} />
          <span className="mode-lbl">FORMAT</span>
          <Seg id="seg-format" value={setup.format}
            options={[
              { value: 'doubles', label: 'DOUBLES', data: 'format' },
              { value: 'singles', label: 'SINGLES', data: 'format' },
            ]}
            onPick={(v) => setSetup({ format: v })} />
          <span className="mode-lbl">SCORING</span>
          <Seg id="seg-scoring" value={setup.scoring}
            options={[
              { value: 'points', label: 'POINTS', data: 'scoring' },
              { value: 'timed', label: '⏱ TIMED', data: 'scoring' },
            ]}
            onPick={(v) => setSetup({ scoring: v })} />
          {setup.scoring === 'points' && (
            <div id="target-row">
              <span className="mode-lbl">PLAY TO</span>
              <Seg id="seg-target" value={setup.target}
                options={[11, 15, 21].map((n) => ({ value: n, label: String(n), data: 'target' }))}
                onPick={(v) => setSetup({ target: v })} />
            </div>
          )}
          {setup.scoring === 'timed' && (
            <div className="field-row" id="timed-row">
              <div className="field">
                <span className="field-label">MINUTES</span>
                <div className="stepper">
                  <button type="button" className="px-btn sm" id="min-minus" aria-label="decrease minutes"
                    onClick={() => { setSetup({ minutes: Math.max(1, setup.minutes - 1) }); sfx.tap(); }}>−</button>
                  <output id="out-min">{setup.minutes}</output>
                  <button type="button" className="px-btn sm" id="min-plus" aria-label="increase minutes"
                    onClick={() => { setSetup({ minutes: Math.min(60, setup.minutes + 1) }); sfx.tap(); }}>+</button>
                </div>
              </div>
            </div>
          )}
          <p className="mode-hint" id="mode-hint">{modeHint(setup)}</p>
        </fieldset>

        {/* first serve */}
        <fieldset className="panel" id="panel-serve">
          <legend>FIRST SERVE</legend>
          <Seg id="seg-firstserve" value={setup.firstServe}
            options={[
              { value: 'A', label: '◀ LEFT TEAM', data: 'serve' },
              { value: 'B', label: 'RIGHT TEAM ▶', data: 'serve' },
            ]}
            btnClass={(v) => (v === 'A' ? 'team-a-btn' : 'team-b-btn')}
            onPick={(v) => setSetup({ firstServe: v, server: 0, receiver: 0 })} />
          {!singles && (
            <div className="serve-pickers" id="serve-pickers">
              <div className="serve-picker">
                <span className="field-label">SERVER <span className="micro">(starts right court)</span></span>
                <div className="player-pick" id="pick-server">
                  {playerPick(teamById(svId), setup.server, 'server')}
                </div>
              </div>
              <div className="serve-picker">
                <span className="field-label">RECEIVER <span className="micro">(diagonal court)</span></span>
                <div className="player-pick" id="pick-receiver">
                  {playerPick(teamById(rcId), setup.receiver, 'receiver')}
                </div>
              </div>
            </div>
          )}
        </fieldset>

        <button type="button" className="px-btn start-btn" id="btn-start" onClick={start}>
          <PixelBall size="sm" /> START GAME <PixelBall size="sm" flip />
        </button>
        {error && <p className="setup-error" id="setup-error">{error}</p>}

        <button type="button" className="px-btn wide ghost" id="btn-history"
          onClick={() => { onOpenHistory(); sfx.tap(); }}>
          🏆 MATCH HISTORY
        </button>
      </div>
    </section>
  );
}
