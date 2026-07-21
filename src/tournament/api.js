/* ==========================================================
   Firestore data access for tournament mode.

   Layout (see firestore.rules for enforcement):

   /tournaments/{tid}
       name, status, currentStage, config { matchTo, winBy, minutes },
       groups { A: [team × 5], … }, createdAt, updatedAt
     /secrets/passcodes        { referee, admin }   — never publicly readable
     /referees/{anonymousUid}  { name, passcode, checkedInAt }
     /admins/{anonymousUid}    { name, passcode, checkedInAt }
     /matches/{matchId}        teamA, teamB, scoreA, scoreB, status,
                               stage, group, court, order, note, winner,
                               refereeId, refereeName, startedAt, updatedAt,
                               refNote (referee's free-text note, e.g. injury sub)

   Referee/admin check-in docs carry the passcode they submitted; the
   security rules only allow the create when it matches the secret,
   so a successful write IS the validation.
   ========================================================== */
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  onSnapshot, query, orderBy, serverTimestamp, runTransaction,
} from 'firebase/firestore';
import { getDb, ensureAuth } from './firebase.js';
import { defaultStages } from './schedule.js';

const tref = (tid) => doc(getDb(), 'tournaments', tid);
const mref = (tid, mid) => doc(getDb(), 'tournaments', tid, 'matches', mid);

export const DEFAULT_CONFIG = { matchTo: 15, winBy: 1, minutes: 10, ruleset: 'rally' };

/* ---------------------------------------------------------- listeners */

export const watchTournament = (tid, cb, onErr) =>
  onSnapshot(tref(tid), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null), onErr);

export const watchMatches = (tid, cb, onErr) =>
  onSnapshot(
    query(collection(getDb(), 'tournaments', tid, 'matches'), orderBy('order')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onErr);

export const watchReferees = (tid, cb, onErr) =>
  onSnapshot(collection(getDb(), 'tournaments', tid, 'referees'),
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))), onErr);

/* ---------------------------------------------------------- check-in */

/* tournament codes are shown in caps, but tournaments created before
   that convention have lowercase ids — try the code as typed, then the
   case variants; returns the actual doc id or null */
export async function resolveTid(tid) {
  for (const v of [...new Set([tid, tid.toUpperCase(), tid.toLowerCase()])]) {
    if ((await getDoc(tref(v))).exists()) return v;
  }
  return null;
}

/* referee onboarding: anonymous sign-in, then create/update the referee
   doc. The rules reject the write unless the passcode matches, so a
   permission error here means "wrong passcode". Returns { uid, tid }
   with the resolved tournament id. */
export async function checkInReferee(tid, name, passcode) {
  const user = await ensureAuth();
  const real = await resolveTid(tid);
  if (!real) throw new Error('NOT_FOUND');
  try {
    await setDoc(doc(tref(real), 'referees', user.uid),
      { name, passcode, checkedInAt: serverTimestamp() });
  } catch (e) {
    throw e.code === 'permission-denied' ? new Error('BAD_PASSCODE') : e;
  }
  return { uid: user.uid, tid: real };
}

export async function checkInAdmin(tid, name, passcode) {
  const user = await ensureAuth();
  const real = await resolveTid(tid);
  if (!real) throw new Error('NOT_FOUND');
  try {
    await setDoc(doc(tref(real), 'admins', user.uid),
      { name, passcode, checkedInAt: serverTimestamp() });
  } catch (e) {
    throw e.code === 'permission-denied' ? new Error('BAD_PASSCODE') : e;
  }
  return { uid: user.uid, tid: real };
}

/* is the current device already an admin of this tournament? Lets a
   returning admin reopen the panel without retyping the passcode. */
export async function isAdminOf(tid) {
  try {
    const user = await ensureAuth();
    const snap = await getDoc(doc(tref(tid), 'admins', user.uid));
    return snap.exists() ? { uid: user.uid } : null;
  } catch {
    return null;
  }
}

/* the passcodes doc (admin-only read, for the referee QR / display) */
export async function getSecrets(tid) {
  const snap = await getDoc(doc(tref(tid), 'secrets', 'passcodes'));
  return snap.exists() ? snap.data() : null;
}

/* ---------------------------------------------------------- admin ops */

/* two sequential writes on purpose: the tournament + secrets land
   first so the admin check-in's rules get() can see the passcode */
export async function createTournament({ tid, name, refereePasscode, adminPasscode, adminName }) {
  await ensureAuth();
  if ((await getDoc(tref(tid))).exists()) throw new Error('EXISTS');
  const batch = writeBatch(getDb());
  const stages = defaultStages();
  batch.set(tref(tid), {
    name, status: 'upcoming', currentStage: stages[0].id,
    config: DEFAULT_CONFIG, stages,
    groups: {},
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(tref(tid), 'secrets', 'passcodes'),
    { referee: refereePasscode, admin: adminPasscode });
  await batch.commit();
  return checkInAdmin(tid, adminName, adminPasscode);
}

export const updateTournament = (tid, patch) =>
  updateDoc(tref(tid), { ...patch, updatedAt: serverTimestamp() });

/* write a stage's fixtures in one batch (id comes from the fixture) */
export async function writeFixtures(tid, fixtures) {
  const batch = writeBatch(getDb());
  for (const { id, ...data } of fixtures) {
    batch.set(mref(tid, id), { ...data, updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function deleteStageMatches(tid, stage, matches) {
  const batch = writeBatch(getDb());
  for (const m of matches.filter((m) => m.stage === stage)) batch.delete(mref(tid, m.id));
  await batch.commit();
}

export const adminUpdateMatch = (tid, mid, patch) =>
  updateDoc(mref(tid, mid), { ...patch, updatedAt: serverTimestamp() });

/* ---------------------------------------------------------- referee ops */

export const claimMatch = (tid, mid, uid, name) =>
  updateDoc(mref(tid, mid), {
    refereeId: uid, refereeName: name, status: 'live',
    startedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

export const releaseMatch = (tid, mid) =>
  updateDoc(mref(tid, mid), {
    refereeId: null, refereeName: null, status: 'scheduled',
    startedAt: null, updatedAt: serverTimestamp(),
  });

export const pushScore = (tid, mid, scoreA, scoreB) =>
  updateDoc(mref(tid, mid), { scoreA, scoreB, updatedAt: serverTimestamp() });

/* referee note on the match (e.g. "player change — injury"), shown live
   on the dashboard; empty string clears it */
export const setMatchNote = (tid, mid, refNote) =>
  updateDoc(mref(tid, mid), { refNote, updatedAt: serverTimestamp() });

/* winner is stored explicitly (a retirement can leave the loser ahead
   on points); callers without one fall back to the score */
export const completeMatch = (tid, mid, scoreA, scoreB, winner = null, finishHow = null) =>
  updateDoc(mref(tid, mid), {
    scoreA, scoreB, status: 'completed',
    winner: winner || (scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw'),
    finishHow, updatedAt: serverTimestamp(),
  });

/* undo after a saved result puts the match back on court */
export const reopenMatch = (tid, mid, scoreA, scoreB) =>
  updateDoc(mref(tid, mid), {
    scoreA, scoreB, status: 'live', winner: null, updatedAt: serverTimestamp(),
  });

export const deleteMatchDoc = (tid, mid) => deleteDoc(mref(tid, mid));

/* ---------------------------------------------------------- MVP vote */

const mvpConfigRef = (tid) => doc(tref(tid), 'meta', 'mvpVote');
const mvpVotesCol = (tid) => collection(getDb(), 'tournaments', tid, 'mvpVotes');

export const watchMvpConfig = (tid, cb, onErr) =>
  onSnapshot(mvpConfigRef(tid), (snap) => cb(snap.exists() ? snap.data() : { open: false }), onErr);

export const setMvpVoteOpen = (tid, open) =>
  setDoc(mvpConfigRef(tid), { open, updatedAt: serverTimestamp() }, { merge: true });

export const watchMvpVotes = (tid, cb, onErr) =>
  onSnapshot(mvpVotesCol(tid), (snap) => cb(snap.docs.map((d) => d.data())), onErr);

export const MAX_MVP_VOTES = 3;

export const watchMyMvpVotes = (tid, uid, cb, onErr) =>
  onSnapshot(doc(tref(tid), 'mvpVoters', uid),
    (snap) => cb(snap.exists() ? (snap.data().teams || []) : []), onErr);

/* cast one MVP vote for a team. A device may back up to MAX_MVP_VOTES
   different teams, but once a team is one of its picks it can be voted
   for again any number of times — mashing the button just keeps
   stacking votes on that team. Picking a NEW (4th+) team once the cap
   is spent throws VOTE_LIMIT_REACHED.

   Every vote lands as a brand-new document — never an increment on a
   shared counter — so there is nothing for concurrent votes to contend
   on: a burst of devices (or one device being mashed rapidly) each just
   creates their own doc, and none of those writes can collide or get
   lost. The one read+write that IS shared per device (the
   mvpVoters/{uid} doc, which tracks which teams count toward that
   device's cap) is wrapped in a transaction, so Firestore automatically
   serializes and retries concurrent taps instead of racing them — a
   flurry of taps for a brand-new team can never sneak past the cap. */
export async function castMvpVote(tid, team) {
  const user = await ensureAuth();
  const db = getDb();
  const voterRef = doc(tref(tid), 'mvpVoters', user.uid);
  const voteRef = doc(mvpVotesCol(tid));
  await runTransaction(db, async (trx) => {
    const voterSnap = await trx.get(voterRef);
    const teams = voterSnap.exists() ? (voterSnap.data().teams || []) : [];
    const isNewTeam = !teams.includes(team);
    if (isNewTeam) {
      if (teams.length >= MAX_MVP_VOTES) throw new Error('VOTE_LIMIT_REACHED');
      trx.set(voterRef, { teams: [...teams, team], uid: user.uid, updatedAt: serverTimestamp() });
    }
    trx.set(voteRef, { team, uid: user.uid, votedAt: serverTimestamp() });
  });
  return team;
}

/* delete the whole tournament: every subcollection doc, then the
   tournament doc itself (Firestore doesn't cascade deletes) */
export async function deleteTournament(tid) {
  const subs = ['matches', 'referees', 'admins', 'secrets', 'meta', 'mvpVoters', 'mvpVotes'];
  const refs = [];
  for (const sub of subs) {
    const snap = await getDocs(collection(getDb(), 'tournaments', tid, sub));
    snap.forEach((d) => refs.push(d.ref));
  }
  refs.push(tref(tid));
  for (let i = 0; i < refs.length; i += 400) {   // batch limit is 500 writes
    const batch = writeBatch(getDb());
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}
