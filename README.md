# 🏓 PICKLE POINT — Pickleball Tournament Scorer

A retro pixel-art web app for judging **doubles pickleball** tournament games.
Zero dependencies, zero build step — just open `index.html` (or host the folder
on GitHub Pages / any static host).

## Features

- **International doubles rules built in** (side-out scoring)
  - Games start at **0-0-2** — the first serving team gets only one server
  - Server keeps serving while scoring; partners **swap courts** on each point
  - Fault on server #1 → second server; fault on #2 → **side out**
  - After a side out, the **right-court player** serves first
  - Live **score call** (e.g. `10-8-2`) shown at all times
- **Serve tracking** — the app highlights **who serves and who receives**
  on every rally, based on the score and court positions
- **One-tap judging** — tap the half of the court belonging to the team that
  **won the rally**; the rules engine decides point / second server / side out
- **Undo** any number of rallies (the game clock never rewinds)
- **Game modes** — first to 11 / 15 / 21 (win by 2), or **timed mode**
  (highest score when time runs out; tie → sudden death point)
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
