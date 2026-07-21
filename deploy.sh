#!/usr/bin/env bash
# ==========================================================
# One-command Firebase deploy for PICKLE POINT.
#
#   ./deploy.sh              build + deploy hosting & firestore rules
#   ./deploy.sh --rules      deploy firestore rules only
#   ./deploy.sh --hosting    build + deploy hosting only
#
# Needs: node/npm, firebase CLI (npm i -g firebase-tools), and a .env
# with your Firebase web config (see .env.example). The Firebase
# project id is read from VITE_FIREBASE_PROJECT_ID in .env.
# ==========================================================
set -euo pipefail
cd "$(dirname "$0")"

err()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }

command -v npm >/dev/null    || err "npm not found — install Node.js first"
command -v firebase >/dev/null || err "firebase CLI not found — run: npm install -g firebase-tools"

[ -f .env ] || err ".env not found — copy .env.example to .env and fill in your Firebase web config"

# read the project id out of .env
PROJECT="$(grep -E '^VITE_FIREBASE_PROJECT_ID=' .env | cut -d= -f2- | tr -d '[:space:]"'"'" || true)"
[ -n "$PROJECT" ] || err "VITE_FIREBASE_PROJECT_ID is empty in .env"

# make sure the CLI is logged in (no-op if already)
firebase login:list 2>/dev/null | grep -q '@' || {
  info "Firebase CLI not logged in — opening login…"
  firebase login
}

TARGET="${1:-all}"
ONLY="hosting,firestore"
case "$TARGET" in
  --rules)   ONLY="firestore" ;;
  --hosting) ONLY="hosting" ;;
  all|"")    ;;
  *) err "unknown option: $TARGET (use --rules or --hosting)" ;;
esac

if [ "$ONLY" != "firestore" ]; then
  info "Installing dependencies…"
  npm install --silent
  info "Building production bundle…"
  npm run build
  ok "Build complete (dist/)"
fi

info "Deploying [$ONLY] to Firebase project: $PROJECT"
firebase deploy --project "$PROJECT" --only "$ONLY"

ok "Deployed!"
echo
echo "  App        : https://$PROJECT.web.app/"
echo "  Referees   : https://$PROJECT.web.app/#/tournament"
echo "  Dashboard  : https://$PROJECT.web.app/#/dashboard/<tournament-code>"
echo "  Voting     : https://$PROJECT.web.app/#/vote/<tournament-code>"
echo "  Results    : https://$PROJECT.web.app/#/vote-results/<tournament-code>"
echo "  Admin      : https://$PROJECT.web.app/#/admin"
echo
echo "  First time? In the Firebase console enable Anonymous auth and"
echo "  create a Firestore database, then create your tournament from"
echo "  the admin page."
