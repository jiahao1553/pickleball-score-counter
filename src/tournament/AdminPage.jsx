/* ==========================================================
   ADMIN PANEL — professional styling (no pixel art).

   Create / open a tournament, design the STAGES (how many, each
   stage's type, game mode and advancement rules), enter the teams,
   publish fixtures stage by stage, drive currentStage (streams live
   to every referee device), and correct any match by hand. Admin
   rights come from an admin check-in doc validated against the
   admin passcode by the security rules.
   ========================================================== */
import { useEffect, useState } from 'react';
import { firebaseConfigured, ensureAuth } from './firebase.js';
import * as api from './api.js';
import {
  STAGE_TYPES, PAIRINGS, stagesOf, stageName, groupKeys, newStageId,
  allTeams, buildFixtures, stageReady, stageComplete, stageMatchesOf,
} from './schedule.js';
import { load, save, remove } from '../lib/storage.js';
import qrcode from 'qrcode-generator';
import './pro.css';

const SESSION_KEY = 'pkl.tourney.admin';

/* tournaments this device has administered, newest first */
const RECENT_KEY = 'pkl.tourney.admin.recent';
const recentList = () => load(RECENT_KEY, []);
const rememberRecent = (tid, name) => {
  const list = recentList().filter((x) => x.tid !== tid);
  list.unshift({ tid, name: name || tid });
  save(RECENT_KEY, list.slice(0, 10));
};
const forgetRecent = (tid) => save(RECENT_KEY, recentList().filter((x) => x.tid !== tid));

const errText = (e) =>
  e.message === 'NOT_FOUND' ? 'Tournament not found.' :
  e.message === 'BAD_PASSCODE' ? 'Wrong admin passcode.' :
  e.message === 'EXISTS' ? 'That tournament code is already taken.' :
  e.message || 'Something went wrong.';

export default function AdminPage() {
  const [session, setSession] = useState(() => load(SESSION_KEY, null));
  if (!firebaseConfigured()) {
    return (
      <div className="pro"><div className="pro-wrap">
        <div className="pro-card pro-notice">
          <h2>Firebase not configured</h2>
          <p>Copy <code>.env.example</code> to <code>.env</code>, fill in your Firebase web app config and rebuild.</p>
        </div>
      </div></div>
    );
  }
  return (
    <div className="pro"><div className="pro-wrap">
      {session
        ? <Panel session={session} onLeave={() => { remove(SESSION_KEY); setSession(null); }} />
        : <Connect onReady={(s) => { save(SESSION_KEY, s); setSession(s); }} />}
    </div></div>
  );
}

/* ---------------------------------------------------------- connect */
function Connect({ onReady }) {
  const [mode, setMode] = useState('open');       // 'open' | 'create'
  const [form, setForm] = useState({ tid: '', name: '', adminName: '', adminPass: '', refPass: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const tid = form.tid.trim().toUpperCase().replace(/\s+/g, '-');
    setBusy(true); setError(null);
    try {
      let r;
      if (mode === 'create') {
        r = await api.createTournament({
          tid, name: form.name.trim() || tid,
          refereePasscode: form.refPass.trim(),
          adminPasscode: form.adminPass.trim(),
          adminName: form.adminName.trim() || 'Organizer',
        });
      } else {
        r = await api.checkInAdmin(tid, form.adminName.trim() || 'Organizer', form.adminPass.trim());
      }
      rememberRecent(r.tid, mode === 'create' ? form.name.trim() || r.tid : r.tid);
      onReady({ tid: r.tid, uid: r.uid, name: form.adminName.trim() || 'Organizer' });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  /* a device that is already admin of a recent tournament re-opens it
     without retyping the passcode; otherwise fall back to the form */
  const openRecent = async (r) => {
    setBusy(true); setError(null);
    const ok = await api.isAdminOf(r.tid);
    setBusy(false);
    if (ok) {
      onReady({ tid: r.tid, uid: ok.uid, name: form.adminName.trim() || 'Organizer' });
    } else {
      setMode('open');
      setForm((f) => ({ ...f, tid: r.tid }));
      setError(`Enter the admin passcode for ${r.tid}.`);
    }
  };

  return (
    <div className="pro-card pro-notice pro-connect">
      <h2>Tournament Admin</h2>
      <div className="pro-tabs">
        <button type="button" className={mode === 'open' ? 'on' : ''} onClick={() => setMode('open')}>Open existing</button>
        <button type="button" className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>Create new</button>
      </div>
      <form className="pro-form" onSubmit={submit}>
        <label>Tournament code <span className="pro-muted">(always CAPS)</span>
          <input value={form.tid} style={{ textTransform: 'uppercase' }} autoCapitalize="characters"
            onChange={(e) => setForm((f) => ({ ...f, tid: e.target.value.toUpperCase() }))}
            placeholder="CITY-OPEN-2026" required />
        </label>
        {mode === 'create' && (
          <label>Tournament name
            <input value={form.name} onChange={set('name')} placeholder="City Pickleball Open" />
          </label>
        )}
        <label>Your name
          <input value={form.adminName} onChange={set('adminName')} placeholder="Organizer" />
        </label>
        <label>Admin passcode <span className="pro-muted">(case sensitive)</span>
          <input value={form.adminPass} onChange={set('adminPass')}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
        </label>
        {mode === 'create' && (
          <label>Referee passcode <span className="pro-muted">(case sensitive — share with referees)</span>
            <input value={form.refPass} onChange={set('refPass')}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          </label>
        )}
        <button type="submit" className="pro-btn primary" disabled={busy}>
          {busy ? 'Working…' : mode === 'create' ? 'Create tournament' : 'Open admin panel'}
        </button>
        {error && <p className="pro-error">{error}</p>}
      </form>
      {recentList().length > 0 && (
        <div className="pro-recent">
          <p className="pro-muted">Your tournaments on this device</p>
          {recentList().map((r) => (
            <button key={r.tid} type="button" className="pro-btn ghost" disabled={busy}
              onClick={() => openRecent(r)}>
              {r.name && r.name !== r.tid ? `${r.name} · ` : ''}{r.tid}
            </button>
          ))}
        </div>
      )}
      <a href="#/">← Back to scorer</a>
    </div>
  );
}

/* ---------------------------------------------------------- panel */
function Panel({ session, onLeave }) {
  const { tid } = session;
  const [t, setT] = useState(null);
  const [matches, setMatches] = useState(null);
  const [referees, setReferees] = useState([]);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  // a reload restores the session from localStorage but not the Firebase
  // Auth SDK itself — without this, writes go out unauthenticated and the
  // security rules reject them with "missing or insufficient permissions"
  useEffect(() => { ensureAuth(); }, []);

  useEffect(() => {
    const off1 = api.watchTournament(tid, setT, (e) => setError(e.message));
    const off2 = api.watchMatches(tid, setMatches, (e) => setError(e.message));
    const off3 = api.watchReferees(tid, setReferees, () => {});
    return () => { off1(); off2(); off3(); };
  }, [tid]);

  const note = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 3000); };
  const run = (fn, ok) => fn().then(() => ok && note(ok)).catch((e) => note('⚠ ' + errText(e)));

  // keep the device's tournament list labelled with the real name
  useEffect(() => { if (t) rememberRecent(tid, t.name); }, [tid, t && t.name]);

  if (error) return <div className="pro-card pro-notice"><h2>Error</h2><p>{error}</p><button className="pro-btn" onClick={onLeave}>Sign out</button></div>;
  if (!t || !matches) return <p className="pro-loading">Connecting…</p>;

  return (
    <>
      <header className="pro-header">
        <div>
          <h1>{t.name || tid} <span className="pro-muted">· admin</span></h1>
          <p className="pro-sub">
            <span className="pro-pill">code: {tid}</span>
            <a className="pro-pill link" href={`#/dashboard/${encodeURIComponent(tid)}`}
              target="_blank" rel="noopener noreferrer">open dashboard ↗</a>
            <a className="pro-pill link" href="#/tournament"
              target="_blank" rel="noopener noreferrer">referee app ↗</a>
          </p>
        </div>
        <button className="pro-btn ghost" onClick={onLeave}>Switch tournament</button>
      </header>
      {flash && <div className="pro-flash">{flash}</div>}

      <RefereeAccess tid={tid} />
      <MvpVoteControl tid={tid} run={run} />
      <StageControl t={t} tid={tid} run={run} />
      <StagesEditor t={t} tid={tid} matches={matches} run={run} />
      <GroupsEditor t={t} tid={tid} run={run} />
      <FixtureButtons t={t} tid={tid} matches={matches} run={run} />
      <MatchesTable tid={tid} t={t} matches={matches} run={run} />
      <RefereesCard referees={referees} />
      <DangerZone tid={tid} note={note} onDeleted={onLeave} />
    </>
  );
}

/* ------------------------------------------------ referee access (QR) */
function RefereeAccess({ tid }) {
  const [secrets, setSecrets] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.getSecrets(tid).then(setSecrets).catch(() => setSecrets(null)); }, [tid]);
  if (!secrets || !secrets.referee) return null;

  const joinUrl = `${window.location.origin}${window.location.pathname}` +
    `#/tournament/join/${encodeURIComponent(tid)}/${encodeURIComponent(secrets.referee)}`;
  let svg = '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    svg = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  } catch { /* too much data for a QR — link + passcode still shown */ }

  const copy = () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="pro-card pro-section">
      <div className="pro-card-head"><h3>Referee access</h3><span className="pro-muted">scan to check in — only a name is asked</span></div>
      <div className="pro-qr-row">
        {svg && <div className="pro-qr" dangerouslySetInnerHTML={{ __html: svg }} />}
        <div className="pro-qr-info">
          <p>Tournament code: <code>{tid}</code></p>
          <p>Referee passcode: <code>{secrets.referee}</code> <span className="pro-muted">(case sensitive)</span></p>
          <p className="pro-muted">Referees scan the QR (or open the link) and just type their name.
            Entering by hand on the webpage needs the code + passcode above.</p>
          <button className="pro-btn sm" onClick={copy}>{copied ? '✔ Copied' : 'Copy join link'}</button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------ MVP vote control */
function MvpVoteControl({ tid, run }) {
  const [config, setConfig] = useState(null);
  const [votes, setVotes] = useState([]);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    const off1 = api.watchMvpConfig(tid, setConfig, () => {});
    const off2 = api.watchMvpVotes(tid, setVotes, () => {});
    return () => { off1(); off2(); };
  }, [tid]);

  const voteUrl = `${window.location.origin}${window.location.pathname}#/vote/${encodeURIComponent(tid)}`;
  const resultsUrl = `${window.location.origin}${window.location.pathname}#/vote-results/${encodeURIComponent(tid)}`;

  let voteQrSvg = '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(voteUrl);
    qr.make();
    voteQrSvg = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  } catch { /* too much data for a QR — link still shown */ }

  const copy = (url, which) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const open = !!(config && config.open);

  return (
    <section className="pro-card pro-section">
      <div className="pro-card-head">
        <h3>MVP team vote</h3>
        <span className="pro-muted">{votes.length} vote{votes.length === 1 ? '' : 's'} cast</span>
      </div>
      <div className="pro-row">
        <button className={`pro-btn ${open ? 'danger' : 'primary'}`}
          onClick={() => run(() => api.setMvpVoteOpen(tid, !open), open ? 'Voting closed' : 'Voting opened')}>
          {open ? 'Close voting' : 'Open voting'}
        </button>
        <span className="pro-muted">{open ? 'Spectators can vote now.' : 'Voting is closed to spectators.'}</span>
      </div>
      <div className="pro-qr-row" style={{ marginTop: 12 }}>
        {voteQrSvg && <div className="pro-qr" dangerouslySetInnerHTML={{ __html: voteQrSvg }} />}
        <div className="pro-qr-info">
          <p>Spectators scan to vote — no sign-in needed beyond the tap.</p>
          <div className="pro-row">
            <a className="pro-pill link" href={`#/vote/${encodeURIComponent(tid)}`} target="_blank" rel="noopener noreferrer">
              Open vote page ↗
            </a>
            <button className="pro-btn sm" onClick={() => copy(voteUrl, 'vote')}>
              {copied === 'vote' ? '✔ Copied' : 'Copy vote link'}
            </button>
          </div>
        </div>
      </div>
      <div className="pro-row" style={{ marginTop: 10 }}>
        <a className="pro-pill link" href={`#/vote-results/${encodeURIComponent(tid)}`} target="_blank" rel="noopener noreferrer">
          Open live results ↗
        </a>
        <button className="pro-btn sm" onClick={() => copy(resultsUrl, 'results')}>
          {copied === 'results' ? '✔ Copied' : 'Copy results link'}
        </button>
      </div>
      <p className="pro-muted" style={{ marginTop: 10 }}>
        Project the live results link on a screen — it updates in real time as votes come in.
      </p>
    </section>
  );
}

/* ------------------------------------------------ danger zone */
function DangerZone({ tid, note, onDeleted }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try {
      await api.deleteTournament(tid);
      forgetRecent(tid);
      onDeleted();
    } catch (e) {
      setBusy(false); setConfirm(false);
      note('⚠ ' + errText(e));
    }
  };
  return (
    <section className="pro-card pro-section pro-danger">
      <div className="pro-card-head"><h3>Danger zone</h3></div>
      {!confirm ? (
        <button className="pro-btn danger" onClick={() => setConfirm(true)}>Delete this tournament…</button>
      ) : (
        <div className="pro-row">
          <span className="pro-muted">Permanently deletes <b>{tid}</b> — every match, referee and passcode. This cannot be undone.</span>
          <button className="pro-btn danger" disabled={busy} onClick={del}>
            {busy ? 'Deleting…' : `Yes, delete ${tid}`}
          </button>
          <button className="pro-btn ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      )}
    </section>
  );
}

function StageControl({ t, tid, run }) {
  return (
    <section className="pro-card pro-section">
      <div className="pro-card-head"><h3>Current stage & status</h3><span className="pro-muted">streams live to every referee</span></div>
      <div className="pro-row">
        <label>Current stage
          <select value={t.currentStage}
            onChange={(e) => run(() => api.updateTournament(tid, { currentStage: e.target.value }), `Stage → ${stageName(t, e.target.value)}`)}>
            {stagesOf(t).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Tournament status
          <select value={t.status}
            onChange={(e) => run(() => api.updateTournament(tid, { status: e.target.value }), 'Status updated')}>
            {['upcoming', 'active', 'completed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}

/* ------------------------------------------------ stage designer */
const num = (v, fb) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fb; };

function StagesEditor({ t, tid, matches, run }) {
  const [draft, setDraft] = useState(null);
  const stages = draft || stagesOf(t);
  const patch = (i, p) => setDraft(stages.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const patchCfg = (i, p) => patch(i, { config: { ...stages[i].config, ...p } });

  const addStage = () => setDraft([...stages, {
    id: newStageId(), name: `Stage ${stages.length + 1}`, type: 'knockout',
    byes: 0, pairing: 'random-cross',
    config: { ...(stages[stages.length - 1]?.config || {}) },
  }]);
  const removeStage = (i) => setDraft(stages.filter((_, j) => j !== i));
  const move = (i, d) => {
    const next = [...stages];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setDraft(next);
  };

  const saveStages = () => run(
    () => api.updateTournament(tid, { stages }).then(() => setDraft(null)),
    'Stages saved');

  return (
    <section className="pro-card pro-section">
      <div className="pro-card-head">
        <h3>Stages · {stages.length}</h3>
        <span className="pro-muted">type, game mode and advancement per stage — the first stage takes the registered teams</span>
      </div>
      {stages.map((s, i) => {
        const published = stageMatchesOf(matches, s.id).length;
        const c = s.config || {};
        return (
          <div className="pro-stage" key={s.id}>
            <div className="pro-row pro-stage-head">
              <span className="pro-stage-n">{i + 1}</span>
              <label className="grow">Name
                <input value={s.name} onChange={(e) => patch(i, { name: e.target.value })} />
              </label>
              <label>Type
                <select value={s.type} onChange={(e) => patch(i, { type: e.target.value })}>
                  {STAGE_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <span className="pro-actions">
                <button className="pro-btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="pro-btn sm ghost" disabled={i === stages.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="pro-btn sm danger" disabled={published > 0}
                  title={published ? `${published} matches already published` : 'remove stage'}
                  onClick={() => removeStage(i)}>✕</button>
              </span>
            </div>
            <div className="pro-row">
              {s.type === 'groups' && (
                <>
                  <label>Groups
                    <input type="number" min="1" max="26" value={s.numGroups || 1}
                      onChange={(e) => patch(i, { numGroups: num(e.target.value, 1) })} />
                  </label>
                  <label>Advance per group
                    <input type="number" min="1" value={s.advancePerGroup || 1}
                      onChange={(e) => patch(i, { advancePerGroup: num(e.target.value, 1) })} />
                  </label>
                </>
              )}
              {s.type === 'knockout' && (
                <>
                  <label>Byes <span className="pro-muted">(top seeds skip this stage)</span>
                    <input type="number" min="0" value={s.byes || 0}
                      onChange={(e) => patch(i, { byes: Math.max(0, Number(e.target.value) || 0) })} />
                  </label>
                  <label>Pairing
                    <select value={s.pairing || 'random-cross'} onChange={(e) => patch(i, { pairing: e.target.value })}>
                      {PAIRINGS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </label>
                </>
              )}
              {s.type === 'roundrobin' && (
                <span className="pro-muted">everyone plays everyone · ranked by wins, points won, points against</span>
              )}
            </div>
            <div className="pro-row">
              <label>Rules
                <select value={c.ruleset || 'rally'} onChange={(e) => patchCfg(i, { ruleset: e.target.value })}>
                  <option value="rally">Rally (every rally scores)</option>
                  <option value="traditional">Traditional (side-out)</option>
                </select>
              </label>
              <label>Scoring
                <select value={c.scoring || 'timed'} onChange={(e) => patchCfg(i, { scoring: e.target.value })}>
                  <option value="timed">Timed + points cap</option>
                  <option value="points">Points only (no clock)</option>
                </select>
              </label>
              <label>Play to
                <input type="number" min="1" value={c.matchTo || 15} onChange={(e) => patchCfg(i, { matchTo: num(e.target.value, 15) })} />
              </label>
              <label>Win by
                <input type="number" min="1" value={c.winBy || 1} onChange={(e) => patchCfg(i, { winBy: num(e.target.value, 1) })} />
              </label>
              {(c.scoring || 'timed') === 'timed' && (
                <label>Minutes cap
                  <input type="number" min="1" value={c.minutes || 10} onChange={(e) => patchCfg(i, { minutes: num(e.target.value, 10) })} />
                </label>
              )}
            </div>
          </div>
        );
      })}
      <div className="pro-row">
        <button className="pro-btn" onClick={addStage}>+ Add stage</button>
        <button className="pro-btn primary" disabled={!draft} onClick={saveStages}>Save stages</button>
        {draft && <button className="pro-btn ghost" onClick={() => setDraft(null)}>Discard changes</button>}
      </div>
      <p className="pro-muted" style={{ marginTop: 8 }}>
        Advancement: group stages send their top N per group onward; knockouts send the winners
        (ranked by points scored) plus any byes; a round robin ranks by wins. Each stage's entrants
        are the previous stage's advancers.
      </p>
    </section>
  );
}

/* ------------------------------------------------ team entry */
function GroupsEditor({ t, tid, run }) {
  const first = stagesOf(t)[0];
  const keys = first.type === 'groups' ? groupKeys(first.numGroups || 1) : ['A'];
  const flat = keys.length === 1;
  const [draft, setDraft] = useState(null);
  const groups = draft || Object.fromEntries(keys.map((g) => [g, ((t.groups || {})[g] || []).join('\n')]));

  const saveGroups = () => {
    const parsed = Object.fromEntries(keys.map((g) =>
      [g, (groups[g] || '').split('\n').map((s) => s.trim()).filter(Boolean)]));
    run(() => api.updateTournament(tid, { groups: parsed }).then(() => setDraft(null)), 'Teams saved');
  };

  return (
    <section className="pro-card pro-section">
      <div className="pro-card-head">
        <h3>Teams{!flat && ` · ${keys.length} groups`}</h3>
        <span className="pro-muted">one team per line · doubles pairs as “Smith/Jones”</span>
      </div>
      <div className="pro-groups-edit">
        {keys.map((g) => (
          <label key={g}>{flat ? 'All teams' : `Group ${g}`}
            <textarea rows={5} value={groups[g] || ''} placeholder={'Smith/Jones\nMiller/Davis\n…'}
              onChange={(e) => setDraft({ ...groups, [g]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="pro-row">
        <button className="pro-btn primary" disabled={!draft} onClick={saveGroups}>Save teams</button>
        <span className="pro-muted">each {flat ? 'list' : 'group'} needs at least 2 teams before fixtures can be generated</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------ fixtures */
function FixtureButtons({ t, tid, matches, run }) {
  const [confirm, setConfirm] = useState(null);
  const stages = stagesOf(t);

  const hint = (s) => {
    if (s.type === 'groups') {
      return `${s.numGroups || 1} groups · round robin · top ${s.advancePerGroup || 1} per group advance`;
    }
    if (s.type === 'knockout') {
      const p = (PAIRINGS.find((x) => x.id === (s.pairing || 'random-cross')) || {}).label;
      return `${s.byes ? `${s.byes} bye(s) · ` : ''}${p}`;
    }
    return 'round robin · everyone plays everyone';
  };

  const doGen = (s, replace) =>
    run(async () => {
      if (replace) await api.deleteStageMatches(tid, s.id, matches);
      await api.writeFixtures(tid, buildFixtures(t, matches, s));
    }, `${s.name} fixtures published`);

  return (
    <section className="pro-card pro-section">
      <div className="pro-card-head"><h3>Fixtures</h3><span className="pro-muted">publish each stage when the previous one completes</span></div>
      {stages.map((s) => {
        const exists = stageMatchesOf(matches, s.id).length;
        const ready = stageReady(t, matches, s);
        return (
          <div className="pro-gen" key={s.id}>
            <div>
              <strong>{s.name}</strong>
              <span className="pro-muted"> · {hint(s)}</span>
              {exists > 0 && <span className="pro-muted"> · {exists} matches published</span>}
            </div>
            {confirm !== s.id ? (
              <button className="pro-btn" disabled={!ready}
                onClick={() => (exists ? setConfirm(s.id) : doGen(s, false))}>
                {exists ? 'Regenerate' : 'Generate fixtures'}
              </button>
            ) : (
              <button className="pro-btn danger"
                onClick={() => { setConfirm(null); doGen(s, true); }}>
                Confirm — replaces {exists} matches
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------ matches */
function MatchesTable({ tid, t, matches, run }) {
  const stages = stagesOf(t);
  const [filter, setFilter] = useState(t.currentStage);
  const [edit, setEdit] = useState(null);          // { id, a, b }
  useEffect(() => setFilter(t.currentStage), [t.currentStage]);
  const rows = matches.filter((m) => m.stage === filter);

  const saveEdit = (m, complete) => {
    const patch = { scoreA: Number(edit.a) || 0, scoreB: Number(edit.b) || 0 };
    if (complete) {
      patch.status = 'completed';
      patch.winner = patch.scoreA > patch.scoreB ? 'A' : patch.scoreB > patch.scoreA ? 'B' : 'draw';
    }
    run(() => api.adminUpdateMatch(tid, m.id, patch).then(() => setEdit(null)), 'Match updated');
  };

  return (
    <section className="pro-card pro-section">
      <div className="pro-card-head">
        <h3>Matches</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {!rows.length && <p className="pro-muted">No matches in this stage yet.</p>}
      {rows.length > 0 && (
        <div className="pro-table-scroll">
          <table className="pro-table admin">
            <thead>
              <tr><th className="left">Match</th><th>Court</th><th className="left">Teams</th><th>Score</th><th>Status</th><th>Referee</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="left">{m.group ? `Grp ${m.group}` : ''} {m.note || m.id}</td>
                  <td>{m.court}</td>
                  <td className="left">{m.teamA} v {m.teamB}</td>
                  <td>
                    {edit?.id === m.id ? (
                      <span className="pro-score-edit">
                        <input type="number" min="0" value={edit.a} onChange={(e) => setEdit({ ...edit, a: e.target.value })} />
                        –
                        <input type="number" min="0" value={edit.b} onChange={(e) => setEdit({ ...edit, b: e.target.value })} />
                      </span>
                    ) : `${m.scoreA}–${m.scoreB}`}
                  </td>
                  <td>
                    <span className={`pro-status ${m.status}`}>{m.status}</span>
                    {m.finishHow && /RETIRED/i.test(m.finishHow) && <span className="pro-muted"> · walkover</span>}
                  </td>
                  <td>{m.refereeName || '—'}</td>
                  <td className="pro-actions">
                    {edit?.id === m.id ? (
                      <>
                        <button className="pro-btn sm primary" onClick={() => saveEdit(m, m.status === 'completed')}>Save</button>
                        {m.status !== 'completed' && <button className="pro-btn sm" onClick={() => saveEdit(m, true)}>Save + complete</button>}
                        <button className="pro-btn sm ghost" onClick={() => setEdit(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="pro-btn sm ghost" onClick={() => setEdit({ id: m.id, a: m.scoreA, b: m.scoreB })}>Edit</button>
                        {m.status === 'completed' && (
                          <button className="pro-btn sm ghost"
                            onClick={() => run(() => api.adminUpdateMatch(tid, m.id, { status: 'live', winner: null, finishHow: null }), 'Match reopened')}>
                            Reopen
                          </button>
                        )}
                        {m.status === 'live' && (
                          <button className="pro-btn sm ghost"
                            onClick={() => run(() => api.adminUpdateMatch(tid, m.id, { status: 'scheduled', refereeId: null, refereeName: null, startedAt: null }), 'Match reset')}>
                            Reset
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RefereesCard({ referees }) {
  return (
    <section className="pro-card pro-section">
      <div className="pro-card-head"><h3>Checked-in referees</h3><span className="pro-muted">{referees.length} total</span></div>
      {!referees.length && <p className="pro-muted">No referees yet — share the tournament code + referee passcode.</p>}
      <div className="pro-ref-list">
        {referees.map((r) => <span className="pro-pill" key={r.uid}>{r.name}</span>)}
      </div>
    </section>
  );
}
