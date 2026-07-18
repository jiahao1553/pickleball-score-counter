# 🏓 PICKLE POINT — Pickleball Tournament Scorer

A retro pixel-art web app for judging pickleball tournament games —
**singles and doubles**. Built with **React + Vite**; deploys as a fully
static site (GitHub Pages or any static host).

## Features

- **Two official rulesets** (per the USA Pickleball skills guides),
  each playable as **singles or doubles**:
  - **TRADITIONAL** — side-out scoring
    ([USAP level one](https://usapickleball.org/pickleball-skills/level-one/pickleball-scoring-positioning-side-out-scoring/)):
    only the serving side scores
    - Doubles: 3-number call (`10-8-2`), games start at **0-0-2**;
      server keeps serving while scoring, partners **swap courts** each
      point; fault on server #1 → second server; fault on #2 →
      **side out**, and whoever is on the right court serves first
    - Singles: 2-number call; serve from the **right when the server's
      score is even**, left when odd; a fault is an immediate side out
  - **RALLY** — rally scoring
    ([USAP level three](https://usapickleball.org/pickleball-skills/level-three/pickleball-scoring-positioning-rally-scoring/)):
    every rally scores, for whichever side wins it (win by 2, no freeze)
    - Doubles: one server per service turn; while a team holds serve the
      same player keeps serving, partners swapping sides each point;
      positions are tied to the team's score (starting server on the
      right at even score); when receivers win they score **and** take
      over serve, always initiated from the right court — so even score
      → starting server serves, odd → their partner
- **Format** — DOUBLES picks pre-registered teams; SINGLES just types the
  two player names, no team registration needed
- **Scoring** — POINTS (first to 11 / 15 / 21, win by 2) or TIMED
  (highest score when time runs out; tie → sudden death point)
- **Serve tracking** — the app highlights **who serves and who receives**
  on every rally, based on the score and court positions
- **Live court positions** — players are shown in two rows mirroring where
  they stand on court; when positions change the chips visibly slide
  between rows, and the RECEIVING marker jumps to the diagonal player
- **Mode switch = fresh game** — changing rules, scoring or target in
  settings stops the match and restarts it from 0-0 under the new rules
- **One-tap judging** — tap the half of the court belonging to the side
  that **won the rally**; the rules engine decides what happens next
- **Undo** any number of rallies (the game clock never rewinds)
- **Timer** — counts up in points mode, counts down in timed mode;
  tap it to pause/resume
- **Team registration** — pre-register teams with Olympic-style short player
  names (e.g. `TAN W.L.`), then just pick them on match setup
- **Match labels** — "GROUP A · GAME 1" header, with quick rematch
  (loser serves first) and next-match flows
- **8-bit sound effects** (Web Audio) + **haptic feedback** (vibration) —
  both can be toggled in settings
- **Resilient** — teams, preferences and the live match survive page reloads
  (localStorage); screen wake-lock keeps the display on court-side
- Fully **responsive**: phones (portrait & landscape) and desktop;
  keyboard shortcuts for desktop judges

## Keyboard shortcuts (desktop)

| Key | Action |
| --- | --- |
| `←` / `A` | Rally won by left team |
| `→` / `L` | Rally won by right team |
| `U` / `Backspace` | Undo last rally |
| `Space` | Pause / resume clock |

## Development

```sh
npm install
npm run dev        # dev server with hot reload
npm run build      # production build to dist/
npm run preview    # serve the production build locally
```

The Press Start 2P font is bundled in `src/assets/`, so the built app works
fully offline — handy for venues with bad Wi-Fi. Pushes to `main` deploy to
GitHub Pages automatically via `.github/workflows/deploy-pages.yml`.

## Tournament mode (Firebase live sync)

The app runs in two execution paths:

- **Local mode** (`#/`, the default) — the original scorer. Fully offline,
  localStorage only, the Firebase SDK is never even loaded.
- **Tournament mode** — referees check in with a name + event passcode
  (anonymous Firebase auth, validated by Firestore security rules) and
  stream every point to Cloud Firestore. Offline taps are cached locally
  and sync back the moment signal returns.

| Route | Page |
| --- | --- |
| `#/tournament` | Referee check-in, match list & live scorer — the same full court UI and rules engine as local mode (serve tracking, undo, timer), with every rally synced to Firestore |
| `#/dashboard/<code>` | Public live dashboard for all courts (professional style) |
| `#/admin` | Organizer panel: teams, fixtures, stage & config control |

### Tournament format — fully configurable stages

The admin panel lets you design the tournament as **any number of
stages**. Each stage has its own:

- **Type** — *group stage* (round robin per group, top N per group
  advance), *knockout* (1v1, winners advance; optional **byes** let top
  seeds skip the stage; pairing = random cross-group draw, split halves
  or seeded), or *round robin* (everyone plays everyone)
- **Game mode** — rally or traditional rules; *timed + points cap*
  (first to X or the minute cap, tie at time → sudden death) or *points
  only* (no clock); play-to and win-by
- **Advancement** — each stage's entrants are the previous stage's
  advancers: group stages send top N per group; knockouts send winners
  ranked by points scored (plus byes); round robins rank by wins →
  points won → points against. Group ties break by points against →
  head-to-head → most wins → coin toss.

New tournaments start from the default template (the original 25-team
format): 5 groups of 5 → Round of 10 (random cross-group) → Semi Finals
(#1 bye, #2v#4 / #3v#5) → Finals (3-team round robin).

The admin panel generates each stage's fixtures with one click once the
previous stage completes; stage & config changes stream live to every
referee device. Referees can record a mid-game **retirement / walkover**
(injury etc.) from the ⚙ menu — the other team wins with the score as it
stands, and standings honour the recorded winner.

### Firebase setup

**1. Create the project and web app**

1. Go to <https://console.firebase.google.com> → **Add project** (or
   "Create a project"), give it a name and finish the wizard (Google
   Analytics can be left off — the app doesn't use it).
2. On the project overview page, click the **`</>` (Web)** icon to add a
   web app. Give it a nickname (e.g. `pickle-point`) — do **not** tick
   "Firebase Hosting" here, `deploy.sh` handles hosting.
3. The console then shows a `firebaseConfig` snippet. Copy each value
   into `.env` (start from `cp .env.example .env`):

   | firebaseConfig key | .env variable |
   | --- | --- |
   | `apiKey` | `VITE_FIREBASE_API_KEY` |
   | `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
   | `projectId` | `VITE_FIREBASE_PROJECT_ID` |
   | `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` |
   | `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
   | `appId` | `VITE_FIREBASE_APP_ID` |

   (You can always find the snippet again under **⚙ Project settings →
   General → Your apps → SDK setup and configuration**.)

**2. Enable Anonymous authentication**

1. In the left sidebar open **Security → Authentication**.
2. Click **Get started** (first visit only).
3. Open the **Sign-in method** tab.
4. Under "Sign-in providers" click **Anonymous** (if it's not listed,
   click **Add new provider** first), flip **Enable** on, and **Save**.

   This is what lets referees check in with just a name + passcode — no
   accounts or emails involved.

**3. Create the Firestore database**

1. In the left sidebar open **Databases & Storage → Firestore**.
2. Click **Create database**.
3. Pick a location close to your venue (e.g. `asia-southeast1` for
   Singapore) — this **cannot be changed later**.
4. Choose **Start in production mode** and click **Create**. Production
   mode locks the database down; the real access rules in
   `firestore.rules` are pushed by `./deploy.sh` (don't paste rules into
   the console by hand — the deploy overwrites them).

**4. Deploy:**

```sh
npm install -g firebase-tools   # once
./deploy.sh                     # build + deploy hosting & firestore rules
./deploy.sh --rules             # rules only
./deploy.sh --hosting           # hosting only
```

Passcodes are stored in a private `secrets` subdocument (never readable
by clients); the security rules validate a referee/admin check-in against
them, so a successful check-in write *is* the passcode validation.

### Deploy to GitHub Pages (same Firebase backend)

The app is fully static — Firestore and Auth are called directly from the
browser — so GitHub Pages can host it against the **same** Firebase
project. The existing workflow (`.github/workflows/deploy-pages.yml`)
deploys every push to `main`; it just needs the Firebase config as
repository Actions secrets:

1. Copy your `.env` values into repo secrets (one-liner with the
   [gh CLI](https://cli.github.com)):

   ```sh
   grep '^VITE_' .env | while IFS='=' read -r k v; do gh secret set "$k" --body "$v"; done
   ```

   (or add each `VITE_FIREBASE_*` by hand under **Settings → Secrets and
   variables → Actions**.)
2. In the Firebase console add your Pages domain (`<user>.github.io`)
   under **Authentication → Settings → Authorized domains**.
3. Push to `main` (or run the workflow manually). Done — both hostings
   share the same tournaments, live scores and passcodes.

Firestore **security rules still deploy through Firebase** —
`./deploy.sh --rules` — regardless of where the frontend is hosted.

## Architecture

```
src/
  lib/rules.js        pure rules engine — every match transition happens
                      here (no DOM, no React), so game logic is testable
                      and portable
  lib/audio.js        8-bit Web Audio synth (iOS unlock handling included)
  lib/haptics.js      vibration patterns (detects iOS's missing support)
  lib/storage.js      localStorage persistence (same keys as the pre-React
                      app, so devices keep their teams and live match)
  store/AppStore.jsx  central store: teams, prefs, setup, live match; all
                      actions funnel through here
  components/         SetupScreen, CourtScreen, modals, overlays
  hooks/              useTicker (clock), useWakeLock (screen stays on)
  tournament/         lazy-loaded tournament mode (Firebase lives only here)
    schedule.js       pure format engine: fixtures, standings, tie-breakers
    firebase.js       SDK bootstrap: anonymous auth + offline persistence
    api.js            Firestore reads/writes/listeners
    TournamentApp.jsx referee flow (check-in → match list → live scorer)
    DashboardPage.jsx public live dashboard (professional theme)
    AdminPage.jsx     organizer panel (professional theme)
firestore.rules       passcode check-in + role-based write rules
deploy.sh             one-command Firebase build & deploy
```
