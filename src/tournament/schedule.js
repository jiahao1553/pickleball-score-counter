/* ==========================================================
   Tournament format engine (pure — no Firebase, no React).

   A tournament is a configurable list of STAGES stored on the
   tournament doc. Each stage:

     { id, name, type, config: { ruleset, scoring, matchTo, winBy, minutes },
       // type 'groups':   numGroups, advancePerGroup
       // type 'knockout': byes, pairing ('random-cross'|'seeded'|'split') }

   Stage types:
   - groups     — round robin inside each group; standings rank by
                  points won, ties break by points against (asc),
                  head-to-head (2-way), most wins, then coin toss;
                  top `advancePerGroup` per group advance.
   - knockout   — entrants paired 1v1, winners advance. The top
                  `byes` entrants (by their ranking coming in) skip
                  the stage and advance directly. Winners are ranked
                  by the points they scored (then margin).
   - roundrobin — everyone plays everyone; ranked by wins, then
                  points won, then points against.

   Entrants of a stage = advancers of the previous stage (the first
   stage takes the registered teams). The default stage list below
   reproduces the original 25-team format: 5 groups → Round of 10
   (random cross-group) → Semi Finals (#1 bye, #2v#4 / #3v#5) →
   Finals (3-team round robin).
   ========================================================== */

export const STAGE_TYPES = [
  { id: 'groups', label: 'Group stage (round robin per group)' },
  { id: 'knockout', label: 'Knockout (1v1, winners advance)' },
  { id: 'roundrobin', label: 'Round robin (everyone plays everyone)' },
];

export const PAIRINGS = [
  { id: 'random-cross', label: 'Random draw (avoid same group)' },
  { id: 'split', label: 'Split halves (#1vN/2+1, #2vN/2+2…)' },
  { id: 'seeded', label: 'Seeded (#1 v last, #2 v 2nd-last…)' },
];

const CFG = { ruleset: 'rally', scoring: 'timed', matchTo: 15, winBy: 1, minutes: 10 };

export const newStageId = () =>
  's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/* the original hardcoded format, now just the default template */
export const defaultStages = () => ([
  { id: 'qualifiers1', name: 'Qualifiers 1 · Group Stage', type: 'groups',
    numGroups: 5, advancePerGroup: 2, config: { ...CFG } },
  { id: 'round-of-10', name: 'Round of 10 · Knockout', type: 'knockout',
    byes: 0, pairing: 'random-cross', config: { ...CFG } },
  { id: 'semifinals', name: 'Semi Finals', type: 'knockout',
    byes: 1, pairing: 'split', config: { ...CFG } },
  { id: 'finals', name: 'Finals', type: 'roundrobin', config: { ...CFG } },
]);

export const stagesOf = (t) =>
  (t && Array.isArray(t.stages) && t.stages.length ? t.stages : defaultStages());

export const stageById = (t, id) => stagesOf(t).find((s) => s.id === id) || null;

export const stageName = (t, id) => (stageById(t, id) || { name: id }).name;

export const stageConfig = (t, id) =>
  ({ ...CFG, ...(t && t.config), ...((stageById(t, id) || {}).config) });

/* group letters A, B, C… for an n-group stage */
export const groupKeys = (n) =>
  Array.from({ length: Math.min(26, Math.max(1, n | 0)) }, (_, i) => String.fromCharCode(65 + i));

/* every registered team as { team, group } (first-stage entrants) */
export const allTeams = (t) => {
  const g = (t && t.groups) || {};
  return Object.keys(g).sort().flatMap((k) => (g[k] || []).map((team) => ({ team, group: k })));
};

/* winner side of a match doc — trusts the stored winner field
   (retirements can make the loser lead on points), falls back to score */
export const winnerSide = (m) =>
  m.winner === 'A' || m.winner === 'B' ? m.winner
    : m.scoreA === m.scoreB ? null : m.scoreA > m.scoreB ? 'A' : 'B';

/* circle-method round robin for n teams; returns rounds of [i, j]
   index pairs (odd n gets a silent bye each round) */
export function roundRobin(n) {
  const t = [...Array(n).keys()];
  if (n % 2) t.push(-1);
  const m = t.length;
  const rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let i = 0; i < m / 2; i++) {
      const a = t[i], b = t[m - 1 - i];
      if (a !== -1 && b !== -1) pairs.push([a, b]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop());
  }
  return rounds;
}

function matchDoc({ id, stage, group = null, court, order, teamA, teamB, note = null }) {
  return {
    id, stage, group, court, order, note,
    teamA, teamB,
    scoreA: 0, scoreB: 0,
    status: 'scheduled',        // 'scheduled' | 'live' | 'completed'
    winner: null,               // 'A' | 'B' | 'draw'
    finishHow: null,            // e.g. 'FIRST TO 15', 'X RETIRED'
    refereeId: null, refereeName: null,
  };
}

/* ---------------------------------------------------------- queries */

export const stageMatchesOf = (matches, sid) => matches.filter((m) => m.stage === sid);

const doneOf = (matches, sid) =>
  matches.filter((m) => m.stage === sid && m.status === 'completed');

export function stageComplete(matches, stage) {
  const ms = stageMatchesOf(matches, stage.id);
  return ms.length > 0 && ms.every((m) => m.status === 'completed');
}

/* ---------------------------------------------------------- standings */

/* accumulate P/W/PF/PA over completed matches for the given team names */
function table(teams, done) {
  const rows = teams.map((name) => ({
    team: name, played: 0, wins: 0, pf: 0, pa: 0, coinToss: false,
  }));
  const row = (name) => rows.find((r) => r.team === name);
  for (const m of done) {
    const a = row(m.teamA), b = row(m.teamB);
    if (!a || !b) continue;
    a.played++; b.played++;
    a.pf += m.scoreA; a.pa += m.scoreB;
    b.pf += m.scoreB; b.pa += m.scoreA;
    const w = winnerSide(m);
    if (w === 'A') a.wins++;
    else if (w === 'B') b.wins++;
  }
  return rows;
}

/* head-to-head winner for a 2-way tie: -1 if `x` beat `y` */
const h2hOf = (done) => (x, y) => {
  const m = done.find((d) =>
    (d.teamA === x.team && d.teamB === y.team) || (d.teamA === y.team && d.teamB === x.team));
  if (!m) return 0;
  const w = winnerSide(m);
  if (!w) return 0;
  const winner = w === 'A' ? m.teamA : m.teamB;
  return winner === x.team ? -1 : 1;
};

/* one group's standings: PF, then PA asc, head-to-head, wins, coin toss */
export function groupTable(t, matches, stage, g) {
  const teams = ((t && t.groups) || {})[g] || [];
  const done = doneOf(matches, stage.id).filter((m) => m.group === g);
  const rows = table(teams, done);
  const h2h = h2hOf(done);
  rows.sort((x, y) =>
    y.pf - x.pf ||          // 1. accumulated points won
    x.pa - y.pa ||          // 2. points scored against (fewer is better)
    h2h(x, y) ||            // 3. head-to-head
    y.wins - x.wins);       // 4. most wins
  for (let i = 1; i < rows.length; i++) {
    const x = rows[i - 1], y = rows[i];
    if (y.pf === x.pf && y.pa === x.pa && h2h(x, y) === 0 && y.wins === x.wins) {
      x.coinToss = y.coinToss = true;
    }
  }
  return rows;
}

/* round-robin stage table: wins, then points won, then points against */
export function rrTable(t, matches, stage) {
  const games = stageMatchesOf(matches, stage.id);
  const teams = [...new Set(games.flatMap((m) => [m.teamA, m.teamB]))];
  const rows = table(teams, games.filter((m) => m.status === 'completed'));
  return rows.sort((x, y) => y.wins - x.wins || y.pf - x.pf || x.pa - y.pa);
}

/* knockout winners ranked by the points they scored (then margin) */
export function knockoutRanking(matches, stage) {
  return doneOf(matches, stage.id)
    .map((m) => {
      const s = winnerSide(m);
      if (!s) return null;
      return {
        team: s === 'A' ? m.teamA : m.teamB,
        pf: s === 'A' ? m.scoreA : m.scoreB,
        margin: Math.abs(m.scoreA - m.scoreB),
      };
    })
    .filter(Boolean)
    .sort((x, y) => y.pf - x.pf || y.margin - x.margin);
}

/* ---------------------------------------------------------- advancement */

/* ranked list of who comes OUT of a stage (feeds the next stage) */
export function stageAdvancers(t, matches, stage) {
  if (stage.type === 'groups') {
    const per = Math.max(1, stage.advancePerGroup || 1);
    const out = [];
    for (const g of groupKeys(stage.numGroups || 1)) {
      groupTable(t, matches, stage, g).slice(0, per)
        .forEach((r, i) => out.push({ team: r.team, group: g, rank: i, pf: r.pf }));
    }
    // seed order across groups: group winners first, then by points won
    return out.sort((x, y) => x.rank - y.rank || y.pf - x.pf);
  }
  if (stage.type === 'knockout') {
    const entrants = stageEntrants(t, matches, stage);
    const byGroup = new Map(entrants.map((e) => [e.team, e.group]));
    const byes = entrants.slice(0, stage.byes || 0);
    const winners = knockoutRanking(matches, stage)
      .map((w) => ({ ...w, group: byGroup.get(w.team) || null }));
    return [...byes, ...winners];
  }
  return rrTable(t, matches, stage).map((r) => ({ team: r.team, group: null, pf: r.pf }));
}

/* ranked list of who comes INTO a stage */
export function stageEntrants(t, matches, stage) {
  const stages = stagesOf(t);
  const i = stages.findIndex((s) => s.id === stage.id);
  if (i <= 0) return allTeams(t);
  return stageAdvancers(t, matches, stages[i - 1]);
}

/* is a stage ready to have its fixtures generated? */
export function stageReady(t, matches, stage) {
  const stages = stagesOf(t);
  const i = stages.findIndex((s) => s.id === stage.id);
  if (i < 0) return false;
  if (i === 0) {
    if (stage.type !== 'groups') return allTeams(t).length >= 2;
    return groupKeys(stage.numGroups || 1)
      .every((g) => (((t && t.groups) || {})[g] || []).length >= 2);
  }
  return stageComplete(matches, stages[i - 1]);
}

/* ---------------------------------------------------------- fixtures */

const orderBase = (t, stage) =>
  Math.max(0, stagesOf(t).findIndex((s) => s.id === stage.id)) * 100000;

export function buildFixtures(t, matches, stage, rand = Math.random) {
  if (stage.type === 'groups') return buildGroupFixtures(t, stage);
  const entrants = stageEntrants(t, matches, stage);
  if (stage.type === 'knockout') return buildKnockout(t, stage, entrants, rand);
  return buildRoundRobin(t, stage, entrants);
}

/* groups: round robin per group, group g on court index(g)+1 */
function buildGroupFixtures(t, stage) {
  const out = [];
  const groups = (t && t.groups) || {};
  const base = orderBase(t, stage);
  groupKeys(stage.numGroups || 1).forEach((g, gi) => {
    const teams = groups[g] || [];
    let seq = 0;
    for (const pairs of roundRobin(teams.length)) {
      for (const [a, b] of pairs) {
        seq += 1;
        out.push(matchDoc({
          id: `${stage.id}-${g}-${seq}`,
          stage: stage.id, group: g, court: gi + 1,
          order: base + gi * 1000 + seq,
          teamA: teams[a], teamB: teams[b],
        }));
      }
    }
  });
  return out;
}

/* knockout: pair the field (entrants minus byes) per the stage's pairing */
function buildKnockout(t, stage, entrants, rand) {
  const field = entrants.slice(stage.byes || 0);
  const pairs = [];
  if (stage.pairing === 'seeded') {
    for (let i = 0; i < Math.floor(field.length / 2); i++) {
      pairs.push([field[i], field[field.length - 1 - i]]);
    }
  } else if (stage.pairing === 'split') {
    const half = Math.floor(field.length / 2);
    for (let i = 0; i < half; i++) pairs.push([field[i], field[i + half]]);
  } else {
    // random draw, avoiding same-group pairings when possible
    const pool = [...field].sort(() => rand() - 0.5);
    while (pool.length >= 2) {
      const a = pool.shift();
      let j = pool.findIndex((x) => !a.group || x.group !== a.group);
      if (j < 0) j = 0;
      pairs.push([a, pool.splice(j, 1)[0]]);
    }
  }
  const base = orderBase(t, stage);
  return pairs.map(([a, b], i) => matchDoc({
    id: `${stage.id}-${i + 1}`, stage: stage.id, court: i + 1, order: base + i + 1,
    teamA: a.team, teamB: b.team,
    note: a.group && b.group && a.group !== b.group
      ? `Group ${a.group} v Group ${b.group}` : `Game ${i + 1}`,
  }));
}

/* round robin among all entrants, sequential on court 1 */
function buildRoundRobin(t, stage, entrants) {
  const teams = entrants.map((e) => e.team);
  const base = orderBase(t, stage);
  const out = [];
  let seq = 0;
  for (const pairs of roundRobin(teams.length)) {
    for (const [a, b] of pairs) {
      seq += 1;
      out.push(matchDoc({
        id: `${stage.id}-${seq}`, stage: stage.id, court: 1, order: base + seq,
        teamA: teams[a], teamB: teams[b], note: `Game ${seq}`,
      }));
    }
  }
  return out;
}
