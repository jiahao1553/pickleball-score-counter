/* ==========================================================
   LIVE DASHBOARD — public, read-only, professional styling
   (no pixel art). Designed for a projector / big screen at the
   venue: live courts up top, then one section per configured
   stage — group tables, knockout results or a round-robin table —
   all streaming from Firestore.
   ========================================================== */
import { useEffect, useState } from 'react';
import { firebaseConfigured } from './firebase.js';
import * as api from './api.js';
import {
  stagesOf, stageName, stageConfig, groupKeys,
  groupTable, rrTable, knockoutRanking,
  stageComplete, stageMatchesOf, stageAdvancers, winnerSide,
} from './schedule.js';
import './pro.css';

export default function DashboardPage({ tid }) {
  if (!firebaseConfigured()) return <ProNotice title="Firebase not configured" body="Copy .env.example to .env, fill in your Firebase web app config and rebuild." />;
  if (!tid) return <PickTournament />;
  return <Dashboard tid={tid} />;
}

function ProShell({ children }) {
  return <div className="pro"><div className="pro-wrap">{children}</div></div>;
}

function ProNotice({ title, body }) {
  return (
    <ProShell>
      <div className="pro-card pro-notice">
        <h2>{title}</h2>
        <p>{body}</p>
        <a href="#/">← Back to scorer</a>
      </div>
    </ProShell>
  );
}

function PickTournament() {
  const [code, setCode] = useState('');
  return (
    <ProShell>
      <div className="pro-card pro-notice">
        <h2>Live Tournament Dashboard</h2>
        <p>Enter the tournament code to follow all courts live.</p>
        <form
          className="pro-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) window.location.hash = `#/dashboard/${encodeURIComponent(code.trim().toUpperCase())}`;
          }}
        >
          <input value={code} style={{ textTransform: 'uppercase' }} autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CITY-OPEN-2026" />
          <button type="submit">View</button>
        </form>
      </div>
    </ProShell>
  );
}

const statusLabel = { upcoming: 'Upcoming', active: 'In progress', completed: 'Completed' };

const COLS = (
  <p className="pro-muted pro-legend">
    <b>P</b> games played · <b>W</b> wins · <b>PF</b> points for (total points won) · <b>PA</b> points against (total points conceded)
  </p>
);

function Dashboard({ tid }) {
  const [t, setT] = useState(undefined);          // undefined = loading, null = missing
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const off1 = api.watchTournament(tid, setT, (e) => setError(e.message));
    const off2 = api.watchMatches(tid, setMatches, (e) => setError(e.message));
    return () => { off1(); off2(); };
  }, [tid]);

  // codes display in caps, but older tournaments have lowercase ids —
  // redirect to whichever case variant actually exists
  useEffect(() => {
    if (t !== null) return;
    api.resolveTid(tid).then((real) => {
      if (real && real !== tid) window.location.hash = `#/dashboard/${encodeURIComponent(real)}`;
    }).catch(() => {});
  }, [t, tid]);

  if (error) return <ProNotice title="Connection problem" body={error} />;
  if (t === null) return <ProNotice title="Tournament not found" body={`No tournament with code “${tid}”.`} />;
  if (!t || !matches) return <ProShell><p className="pro-loading">Connecting…</p></ProShell>;

  const stages = stagesOf(t);
  const live = matches.filter((m) => m.status === 'live');
  const cfg = stageConfig(t, t.currentStage);
  const withMatches = stages.filter((s) => stageMatchesOf(matches, s.id).length);
  const last = stages[stages.length - 1];
  const champion = last && stageComplete(matches, last)
    ? (stageAdvancers(t, matches, last)[0] || {}).team : null;

  return (
    <ProShell>
      <header className="pro-header">
        <div>
          <h1>{t.name || tid}</h1>
          <p className="pro-sub">
            <span className="pro-pill stage">{stageName(t, t.currentStage)}</span>
            <span className="pro-pill">{statusLabel[t.status] || t.status}</span>
            <span className="pro-pill">
              To {cfg.matchTo}{cfg.scoring === 'points' ? ' pts' : ` pts · ${cfg.minutes} min`}
            </span>
          </p>
        </div>
        <div className="pro-live-flag"><span className="pro-dot" /> LIVE</div>
      </header>

      {champion && (
        <div className="pro-card pro-champion">🏆 Champion — <strong>{champion}</strong></div>
      )}

      <LiveCourts live={live} t={t} />

      {withMatches.map((s, i) => (
        <StageSection key={s.id} t={t} stage={s} matches={matches}
          current={t.currentStage === s.id}
          next={stages[stages.indexOf(s) + 1] || null}
          isLast={s.id === last.id} />
      ))}

      {!matches.length && (
        <div className="pro-card pro-notice"><p>No matches scheduled yet — the draw appears here as soon as the organizer publishes it.</p></div>
      )}

      <footer className="pro-footer">Updates in real time · pickle point</footer>
    </ProShell>
  );
}

function LiveCourts({ live, t }) {
  if (!live.length) return null;
  return (
    <section className="pro-section">
      <h2 className="pro-h2"><span className="pro-dot" /> On court now</h2>
      <div className="pro-live-grid">
        {[...live].sort((a, b) => a.court - b.court).map((m) => (
          <div className="pro-card pro-live-card" key={m.id}>
            <div className="pro-live-meta">
              <span className="pro-court">Court {m.court}</span>
              <span>{m.group ? `Group ${m.group}` : m.note || stageName(t, m.stage)}</span>
            </div>
            <div className="pro-live-row">
              <span className="pro-team">{m.teamA}</span>
              <span className={`pro-score${m.scoreA >= m.scoreB ? ' lead' : ''}`}>{m.scoreA}</span>
            </div>
            <div className="pro-live-row">
              <span className="pro-team">{m.teamB}</span>
              <span className={`pro-score${m.scoreB >= m.scoreA ? ' lead' : ''}`}>{m.scoreB}</span>
            </div>
            {m.refereeName && <div className="pro-ref">Referee · {m.refereeName}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function StageSection({ t, stage, matches, current, next, isLast }) {
  return (
    <section className="pro-section">
      <h2 className="pro-h2">
        {stage.name}
        {current && <span className="pro-pill stage sm">current stage</span>}
      </h2>
      {stage.type === 'groups' && <GroupTables t={t} stage={stage} matches={matches} />}
      {stage.type === 'knockout' && <Knockout t={t} stage={stage} matches={matches} next={next} />}
      {stage.type === 'roundrobin' && <RoundRobin t={t} stage={stage} matches={matches} isLast={isLast} />}
    </section>
  );
}

/* ------------------------------------------------ group standings */
function GroupTables({ t, stage, matches }) {
  const groups = t.groups || {};
  const complete = stageComplete(matches, stage);
  const per = stage.advancePerGroup || 1;
  return (
    <div className="pro-group-grid">
      {groupKeys(stage.numGroups || 1).filter((g) => (groups[g] || []).length).map((g) => {
        const rows = groupTable(t, matches, stage, g);
        const gm = matches.filter((m) => m.stage === stage.id && m.group === g);
        const played = gm.filter((m) => m.status === 'completed').length;
        return (
          <div className="pro-card" key={g}>
            <div className="pro-card-head">
              <h3>Group {g}</h3>
              <span className="pro-muted">{played}/{gm.length} games</span>
            </div>
            <table className="pro-table">
              <thead>
                <tr><th>#</th><th className="left">Team</th><th>P</th><th>W</th><th>PF</th><th>PA</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.team} className={i < per && complete ? 'qualified' : ''}>
                    <td>{i + 1}</td>
                    <td className="left">
                      {r.team}
                      {r.coinToss && <span className="pro-coin" title="Tied on every tie-breaker — coin toss">🪙</span>}
                    </td>
                    <td>{r.played}</td><td>{r.wins}</td><td className="pf">{r.pf}</td><td>{r.pa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {COLS}
      <p className="pro-muted pro-legend">
        Ranked by PF · ties: fewest PA, head-to-head, most wins, coin toss · top {per} per group advance
      </p>
    </div>
  );
}

/* ------------------------------------------------ knockout stages */
function MatchCards({ matches }) {
  return (
    <div className="pro-ko-grid">
      {[...matches].sort((a, b) => a.order - b.order).map((m) => {
        const w = m.status === 'completed' ? winnerSide(m) : null;
        const retired = m.finishHow && /RETIRED/i.test(m.finishHow);
        return (
          <div className={`pro-card pro-ko ${m.status}`} key={m.id}>
            <div className="pro-live-meta">
              <span>{m.note || m.id}</span>
              <span className="pro-court">Court {m.court}</span>
            </div>
            <div className="pro-ko-row">
              <span className={w === 'A' ? 'winner' : ''}>{m.teamA}</span>
              <span className="pro-score">{m.status === 'scheduled' ? '–' : m.scoreA}</span>
            </div>
            <div className="pro-ko-row">
              <span className={w === 'B' ? 'winner' : ''}>{m.teamB}</span>
              <span className="pro-score">{m.status === 'scheduled' ? '–' : m.scoreB}</span>
            </div>
            <div className={`pro-status ${m.status}`}>
              {m.status === 'live' ? '● live'
                : m.status === 'completed' ? (retired ? 'final · walkover' : 'final')
                : 'scheduled'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Knockout({ t, stage, matches, next }) {
  const games = stageMatchesOf(matches, stage.id);
  const done = stageComplete(matches, stage);
  const byes = stage.byes
    ? stageAdvancers(t, matches, stage).slice(0, stage.byes) : [];
  return (
    <>
      {byes.length > 0 && (
        <p className="pro-muted pro-legend">
          Bye{byes.length > 1 ? 's' : ''}: {byes.map((b) => b.team).join(', ')} advance
          {byes.length > 1 ? '' : 's'} directly{next ? ` to ${next.name}` : ''}.
        </p>
      )}
      <MatchCards matches={games} />
      {done && (
        <div className="pro-card pro-rank">
          <h3>Winners ranked by points scored</h3>
          <ol>
            {knockoutRanking(matches, stage).map((r) => (
              <li key={r.team}>
                <span>{r.team}</span>
                <span className="pro-muted">{r.pf} pts</span>
              </li>
            ))}
          </ol>
          {next && next.byes > 0 && (
            <p className="pro-muted">Top {next.byes} skip{next.byes > 1 ? '' : 's'} {next.name} with a bye.</p>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------ round robin stage */
function RoundRobin({ t, stage, matches, isLast }) {
  const games = stageMatchesOf(matches, stage.id);
  const rows = rrTable(t, matches, stage);
  const complete = stageComplete(matches, stage);
  return (
    <>
      {rows.length > 0 && (
        <div className="pro-card">
          <div className="pro-card-head"><h3>{stage.name} table · round robin</h3></div>
          <table className="pro-table">
            <thead><tr><th>#</th><th className="left">Team</th><th>P</th><th>W</th><th>PF</th><th>PA</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.team} className={complete && isLast && i === 0 ? 'champion' : ''}>
                  <td>{complete && isLast && i === 0 ? '🏆' : i + 1}</td>
                  <td className="left">{r.team}{complete && isLast && i === 1 ? <span className="pro-muted"> · 1st runner-up</span> : ''}</td>
                  <td>{r.played}</td><td>{r.wins}</td><td className="pf">{r.pf}</td><td>{r.pa}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {COLS}
          <p className="pro-muted pro-legend">
            Ranked by wins · ties: points won (PF), then points against (PA)
          </p>
        </div>
      )}
      <MatchCards matches={games} />
    </>
  );
}
