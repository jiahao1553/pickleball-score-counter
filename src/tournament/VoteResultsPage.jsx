/* ==========================================================
   MVP VOTE RESULTS — public, read-only, professional styling
   (same "pro" look as the live match dashboard). Meant for one
   device projected at the venue: live bars re-sort and grow as
   votes stream in from Firestore.
   ========================================================== */
import { useEffect, useState } from 'react';
import { firebaseConfigured } from './firebase.js';
import * as api from './api.js';
import { allTeams } from './schedule.js';
import './pro.css';

export default function VoteResultsPage({ tid }) {
  if (!firebaseConfigured()) return <ProNotice title="Firebase not configured" body="Copy .env.example to .env, fill in your Firebase web app config and rebuild." />;
  if (!tid) return <PickTournament />;
  return <Results tid={tid} />;
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
      </div>
    </ProShell>
  );
}

function PickTournament() {
  const [code, setCode] = useState('');
  return (
    <ProShell>
      <div className="pro-card pro-notice">
        <h2>MVP Vote — Live Results</h2>
        <p>Enter the tournament code to follow the vote live.</p>
        <form
          className="pro-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) window.location.hash = `#/vote-results/${encodeURIComponent(code.trim().toUpperCase())}`;
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

function Results({ tid }) {
  const [t, setT] = useState(undefined);
  const [config, setConfig] = useState(null);
  const [votes, setVotes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const off1 = api.watchTournament(tid, setT, (e) => setError(e.message));
    const off2 = api.watchMvpConfig(tid, setConfig, (e) => setError(e.message));
    const off3 = api.watchMvpVotes(tid, setVotes, (e) => setError(e.message));
    return () => { off1(); off2(); off3(); };
  }, [tid]);

  useEffect(() => {
    if (t !== null) return;
    api.resolveTid(tid).then((real) => {
      if (real && real !== tid) window.location.hash = `#/vote-results/${encodeURIComponent(real)}`;
    }).catch(() => {});
  }, [t, tid]);

  if (error) return <ProNotice title="Connection problem" body={error} />;
  if (t === null) return <ProNotice title="Tournament not found" body={`No tournament with code “${tid}”.`} />;
  if (!t || !votes || !config) return <ProShell><p className="pro-loading">Connecting…</p></ProShell>;

  const teams = [...new Set(allTeams(t).map((x) => x.team))];
  const tally = new Map(teams.map((team) => [team, 0]));
  for (const v of votes) tally.set(v.team, (tally.get(v.team) || 0) + 1);
  const rows = [...tally.entries()]
    .map(([team, count]) => ({ team, count }))
    .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
  const total = votes.length;
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <ProShell>
      <header className="pro-header">
        <div>
          <h1>{t.name || tid} <span className="pro-muted">· MVP team vote</span></h1>
          <p className="pro-sub">
            <span className="pro-pill">{total} vote{total === 1 ? '' : 's'} cast</span>
            <span className={`pro-pill ${config.open ? 'stage' : ''}`}>{config.open ? 'Voting open' : 'Voting closed'}</span>
          </p>
        </div>
        <div className="pro-header-actions">
          <div className="pro-live-flag"><span className="pro-dot" /> LIVE</div>
        </div>
      </header>

      <section className="pro-section">
        <div className="pro-vote-bars">
          {rows.map((r, i) => (
            <div className={`pro-vote-row${i === 0 && r.count > 0 ? ' leader' : ''}`} key={r.team}>
              <div className="pro-vote-label">
                {i === 0 && r.count > 0 && <span className="pro-vote-crown">🏆</span>}
                <span className="pro-vote-team">{r.team}</span>
                <span className="pro-vote-count">{r.count}</span>
              </div>
              <div className="pro-vote-track">
                <div className="pro-vote-fill" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
          {!rows.length && <p className="pro-muted">No teams entered yet.</p>}
        </div>
      </section>

      <footer className="pro-footer">Updates in real time · pickle point</footer>
    </ProShell>
  );
}
