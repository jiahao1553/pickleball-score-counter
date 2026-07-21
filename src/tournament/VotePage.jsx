/* ==========================================================
   MVP TEAM VOTE — spectator flow (pixel-styled like local mode).

   One big button per team. Tap casts the vote instantly with the same
   sound + haptic feedback as the local scorer's score zones (reused
   from ../lib/audio.js and ../lib/haptics.js, not reimplemented), then
   locks the device out of voting again. Every vote is its own Firestore
   document rather than an increment on a shared counter — see
   api.castMvpVote for why that's what makes a burst of devices voting
   at once safe.
   ========================================================== */
import { useEffect, useState } from 'react';
import { firebaseConfigured, ensureAuth } from './firebase.js';
import * as api from './api.js';
import { allTeams } from './schedule.js';
import { sfx } from '../lib/audio.js';
import { hap, buzz } from '../lib/haptics.js';
import { PixelBall } from '../components/PixelBall.jsx';

function Shell({ children, title = 'MVP TEAM VOTE' }) {
  return (
    <div id="app">
      <section className="screen t-screen">
        <header className="setup-header">
          <div className="logo-row">
            <PixelBall size="lg" />
            <h1>PICKLE&nbsp;POINT</h1>
            <PixelBall size="lg" flip />
          </div>
          <p className="tagline">{title}</p>
          <div className="net-divider" aria-hidden="true" />
        </header>
        <div className="setup-body">{children}</div>
      </section>
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

function NotConfigured() {
  return (
    <Shell>
      <fieldset className="panel">
        <legend>SETUP NEEDED</legend>
        <p className="t-copy">
          MVP VOTING NEEDS A FIREBASE PROJECT. COPY <b>.env.example</b> TO{' '}
          <b>.env</b>, FILL IN YOUR FIREBASE WEB APP CONFIG, THEN REBUILD.
        </p>
      </fieldset>
    </Shell>
  );
}

export default function VotePage({ tid: tidProp }) {
  const [tid, setTid] = useState(tidProp ? tidProp.toUpperCase() : null);
  if (!firebaseConfigured()) return <NotConfigured />;
  if (!tid) return <PickTournament onPicked={setTid} />;
  return <Voter tid={tid} />;
}

function PickTournament({ onPicked }) {
  const [code, setCode] = useState('');
  return (
    <Shell title="MVP TEAM VOTE">
      <fieldset className="panel">
        <legend>ENTER TOURNAMENT CODE</legend>
        <label className="field">
          <span className="field-label">TOURNAMENT CODE</span>
          <input type="text" autoComplete="off" placeholder="CITY-OPEN-2026"
            autoCapitalize="characters" style={{ textTransform: 'uppercase' }}
            value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
        <button type="button" className="px-btn wide start-btn" disabled={!code.trim()}
          onClick={() => onPicked(code.trim().toUpperCase())}>
          ▶ CONTINUE
        </button>
      </fieldset>
    </Shell>
  );
}

const errMsg = (e) =>
  e.message === 'VOTE_LIMIT_REACHED' ? `⚠ YOU'VE USED ALL ${api.MAX_MVP_VOTES} VOTES` :
  '⚠ ' + (e.message || 'SOMETHING WENT WRONG');

function Voter({ tid }) {
  const [uid, setUid] = useState(null);
  const [tournament, setTournament] = useState(undefined);
  const [config, setConfig] = useState(null);
  const [myVotes, setMyVotes] = useState(undefined);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { ensureAuth().then((u) => setUid(u.uid)); }, []);

  useEffect(() => {
    const off1 = api.watchTournament(tid, setTournament, (e) => setError(e.message));
    const off2 = api.watchMvpConfig(tid, setConfig, (e) => setError(e.message));
    return () => { off1(); off2(); };
  }, [tid]);

  useEffect(() => {
    if (!uid) return;
    return api.watchMyMvpVotes(tid, uid, setMyVotes, (e) => setError(e.message));
  }, [tid, uid]);

  const vote = async (team) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.castMvpVote(tid, team);
      sfx.win(); hap.win();
    } catch (e) {
      sfx.error(); buzz([60, 40, 60]);
      if (e.message !== 'ALREADY_VOTED_TEAM') setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Shell>
        <fieldset className="panel"><legend>ERROR</legend>
          <p className="setup-error">⚠ {error}</p>
        </fieldset>
      </Shell>
    );
  }
  if (tournament === null) {
    return (
      <Shell>
        <fieldset className="panel"><legend>NOT FOUND</legend>
          <p className="t-copy">NO TOURNAMENT WITH CODE “{tid}”.</p>
        </fieldset>
      </Shell>
    );
  }
  if (tournament === undefined || myVotes === undefined || !config) {
    return <Shell><p className="t-copy dim">CONNECTING…</p></Shell>;
  }

  const teams = [...new Set(allTeams(tournament).map((t) => t.team))].sort();
  const open = !!config.open;
  const remaining = api.MAX_MVP_VOTES - myVotes.length;

  return (
    <Shell title={`${(tournament.name || tid).toUpperCase()} · VOTE FOR MVP TEAM`}>
      {myVotes.length > 0 && (
        <fieldset className="panel">
          <legend>YOUR VOTES</legend>
          <p className="t-copy" style={{ color: 'var(--ball)' }}>{myVotes.join(' · ')}</p>
          <p className="micro dim t-copy">
            {remaining > 0
              ? `${remaining} VOTE${remaining === 1 ? '' : 'S'} LEFT — UP TO ${api.MAX_MVP_VOTES} TEAMS TOTAL`
              : `ALL ${api.MAX_MVP_VOTES} VOTES USED — THANKS FOR VOTING!`}
          </p>
        </fieldset>
      )}
      {!open && (
        <fieldset className="panel">
          <legend>VOTING CLOSED</legend>
          <p className="t-copy">{myVotes.length ? 'VOTING HAS CLOSED.' : "VOTING ISN'T OPEN YET — CHECK BACK SOON."}</p>
        </fieldset>
      )}
      {open && remaining > 0 && (
        <fieldset className="panel">
          <legend>PICK YOUR MVP TEAM{remaining > 1 ? 'S' : ''}</legend>
          <p className="micro dim t-copy">
            VOTE FOR SKILL, POPULARITY OR JUST TO SHOW SUPPORT — YOUR CALL. UP TO {api.MAX_MVP_VOTES} TEAMS PER DEVICE, ONE VOTE EACH.
          </p>
          <div className="vote-grid">
            {teams.filter((team) => !myVotes.includes(team)).map((team) => (
              <button key={team} type="button" className="px-btn wide vote-btn" disabled={busy}
                onClick={() => vote(team)}>
                {team}
              </button>
            ))}
          </div>
          {!teams.length && <p className="t-copy dim">NO TEAMS ENTERED YET.</p>}
        </fieldset>
      )}
    </Shell>
  );
}
