# 🏓 PICKLE POINT — Pickleball Tournament Scorer

A retro pixel-art web app for judging **doubles pickleball** tournament games.
Zero dependencies, zero build step — just open `index.html` (or host the folder
on GitHub Pages / any static host).

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

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The Press Start 2P font is bundled in `fonts/`, so the app works fully offline
— handy for venues with bad Wi-Fi.
