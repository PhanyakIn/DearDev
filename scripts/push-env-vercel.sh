#!/usr/bin/env bash
# Push the server/frontend environment variables from .env.local to Vercel.
#
#   ./scripts/push-env-vercel.sh              # interactive, asks before writing
#   ./scripts/push-env-vercel.sh --dry-run    # show what would happen, write nothing
#
# Values are piped straight from .env.local into the Vercel CLI on stdin.
# They are never echoed, never logged, and never printed on screen.
#
# Prerequisites:
#   1. npx vercel login        (browser approval — the token stays on your machine)
#   2. a Vercel project linked to this repo (the script can run `vercel link` for you)
#
# After a successful run, REDEPLOY. Environment changes do not apply to
# deployments that already exist.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env.local"
DRY_RUN=0
ASSUME_YES=0
SITE_URL_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --site-url) SITE_URL_ARG="${2:-}"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
  shift
done

cyan()  { printf '\033[36m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

# Keys that the app actually reads. Everything else in .env.local is ignored.
KEYS=(
  REACT_APP_SUPABASE_URL
  REACT_APP_SUPABASE_ANON_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  PROMPTPAY_PROXY
  SLIPOK_API_KEY
  SLIPOK_BRANCH_ID
  RESEND_API_KEY
  EMAIL_FROM
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASS
)

# Stored as "secret": the value can never be viewed again in the dashboard.
SECRET_KEYS=("SUPABASE_SERVICE_ROLE_KEY" "SLIPOK_API_KEY" "SMTP_PASS")

ENVIRONMENTS="production,preview"

echo
cyan "DearDev → Vercel environment variables"
echo

# ---------------------------------------------------------------- preflight
if [[ ! -f "$ENV_FILE" ]]; then
  red "✗ $ENV_FILE not found — run this from the repo root."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  red "✗ npx not found — install Node.js first."
  exit 1
fi

dim "  checking Vercel login…"
if ! npx --yes vercel@latest whoami >/dev/null 2>&1; then
  red "✗ Not logged in."
  echo
  echo "  Run this once, approve in the browser, then run this script again:"
  echo
  echo "      npx vercel login"
  echo
  exit 1
fi
green "✓ Logged in to Vercel"

if [[ ! -f ".vercel/project.json" && ! -f ".vercel/repo.json" ]]; then
  echo
  dim "  this repo is not linked to a Vercel project yet"
  if [[ "$DRY_RUN" == "1" ]]; then
    dim "  (dry run) would run: npx vercel link"
  else
    echo "  running: npx vercel link"
    echo
    npx --yes vercel@latest link
  fi
fi
green "✓ Project linked"

# Keys that may be empty: the app treats email as optional and runs fine
# without it (the success page is always the source of truth).
#   RESEND_API_KEY — only useful once a real domain is verified there.
#   EMAIL_FROM / SMTP_* — Gmail SMTP; missing keys simply disable email.
# The consistency checks below still refuse a half-configured transport.
OPTIONAL_KEYS=("RESEND_API_KEY" "EMAIL_FROM" "SMTP_HOST" "SMTP_PORT" "SMTP_USER" "SMTP_PASS")

is_optional() {
  local candidate
  for candidate in "${OPTIONAL_KEYS[@]}"; do
    [[ "$candidate" == "$1" ]] && return 0
  done
  return 1
}

# --------------------------------------------------------------- read values
read_env() {
  # last matching line wins; everything after the first '=' is the value.
  # Whitespace around the value is trimmed — a stray space would be pushed to
  # Vercel verbatim and break the links the app builds from SITE_URL.
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' || true
}

declare -a MISSING=()
echo
cyan "Variables found in $ENV_FILE"
for key in "${KEYS[@]}"; do
  value="$(read_env "$key")"
  if [[ -z "$value" ]]; then
    if is_optional "$key"; then
      printf '  %-34s %s\n' "$key" "MISSING (optional)"
    else
      MISSING+=("$key")
      printf '  %-34s %s\n' "$key" "MISSING"
    fi
  else
    # length only — never the value itself
    printf '  %-34s %s\n' "$key" "set (${#value} chars)"
  fi
done

# Email consistency: a half-configured transport silently disables email in
# the app (isEmailConfigured), which surprises nobody until a buyer says they
# never received a link. Fail loudly instead.
env_set() { [[ -n "$(read_env "$1")" ]]; }
if env_set SMTP_HOST || env_set SMTP_USER || env_set SMTP_PASS; then
  if ! (env_set SMTP_HOST && env_set SMTP_USER && env_set SMTP_PASS); then
    red "✗ SMTP is half configured — SMTP_HOST, SMTP_USER and SMTP_PASS must all be set (SMTP_PORT defaults to 465)."
    exit 1
  fi
  if ! env_set EMAIL_FROM; then
    red "✗ EMAIL_FROM is required when SMTP is configured, and it must be the same Gmail account as SMTP_USER."
    exit 1
  fi
fi

# SITE_URL must point at the deployed site, not localhost.
SITE_URL_VALUE="$(read_env SITE_URL)"
if [[ -n "$SITE_URL_ARG" ]]; then
  SITE_URL_VALUE="$SITE_URL_ARG"
elif [[ -z "$SITE_URL_VALUE" || "$SITE_URL_VALUE" == http://localhost* ]]; then
  echo
  echo "  SITE_URL in $ENV_FILE is ${SITE_URL_VALUE:-empty}"
  echo "  It must be the public URL or links in emails will be wrong."
  if [[ "$DRY_RUN" == "1" ]]; then
    SITE_URL_VALUE="(would ask)"
  else
    read -r -p "  Production URL (https://…): " SITE_URL_VALUE
  fi
fi
SITE_URL_VALUE="${SITE_URL_VALUE%/}"
if [[ "$SITE_URL_VALUE" != https://* && "$DRY_RUN" != "1" ]]; then
  red "✗ SITE_URL must start with https://"
  exit 1
fi

# ---------------------------------------------------------------- confirm
echo
if [[ "${#MISSING[@]}" -gt 0 ]]; then
  red "✗ These are missing in $ENV_FILE: ${MISSING[*]}"
  red "  Fill them in first — pushing a partial config will break checkout."
  exit 1
fi

echo "  Target environments : $ENVIRONMENTS"
echo "  SITE_URL            : $SITE_URL_VALUE"
echo
if [[ "$DRY_RUN" == "1" ]]; then
  dim "  dry run — nothing was written"
  exit 0
fi

if [[ "$ASSUME_YES" != "1" ]]; then
  read -r -p "Write these to Vercel now? [y/N] " answer
  if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
    echo "  cancelled."
    exit 0
  fi
fi

# ------------------------------------------------------------------- push
echo
for key in "${KEYS[@]}"; do
  value="$(read_env "$key")"
  flags=(--environment "$ENVIRONMENTS" --force --yes)
  for secret in "${SECRET_KEYS[@]}"; do
    [[ "$key" == "$secret" ]] && flags+=(--sensitive)
  done
  # REACT_APP_* values are baked into the public browser bundle on purpose.
  # Vercel CLI 65+ refuses to add such a name without an explicit type.
  [[ "$key" == REACT_APP_* ]] && flags+=(--type config)

  if printf '%s' "$value" | npx --yes vercel@latest env add "$key" "${flags[@]}" >/dev/null 2>&1; then
    green "✓ $key"
  else
    red "✗ $key — failed (run: npx vercel env add $key --environment $ENVIRONMENTS --force)"
  fi
done

if printf '%s' "$SITE_URL_VALUE" | npx --yes vercel@latest env add SITE_URL \
     --environment "$ENVIRONMENTS" --force --yes >/dev/null 2>&1; then
  green "✓ SITE_URL"
else
  red "✗ SITE_URL — failed"
fi

# Optional keys. Push only when they have a value; email and a custom link
# secret are not required for checkout to work.
for key in ORDER_TOKEN_SECRET RESEND_API_KEY EMAIL_FROM SUPABASE_ANON_KEY; do
  value="$(read_env "$key")"
  if [[ "$key" == "SUPABASE_ANON_KEY" && -z "$value" ]]; then
    value="$(read_env REACT_APP_SUPABASE_ANON_KEY)"
  fi
  [[ -z "$value" ]] && continue

  flags=(--environment "$ENVIRONMENTS" --force --yes)
  [[ "$key" == "ORDER_TOKEN_SECRET" || "$key" == "RESEND_API_KEY" || "$key" == "SUPABASE_ANON_KEY" ]] && flags+=(--sensitive)
  if printf '%s' "$value" | npx --yes vercel@latest env add "$key" "${flags[@]}" >/dev/null 2>&1; then
    green "✓ $key (optional)"
  else
    red "✗ $key — failed (run: npx vercel env add $key --environment $ENVIRONMENTS --force)"
  fi
done

echo
cyan "Current Vercel variables (names only, values are never shown)"
npx --yes vercel@latest env ls || true

echo
echo "──────────────────────────────────────────────────────────────"
echo "Next: REDEPLOY, or the old build keeps the old (empty) values."
echo
echo "    npx vercel --prod          # deploy the current folder"
echo "  or commit + push and let Vercel build it"
echo
echo "Then verify:  https://<your-domain>/api/health"
echo "              → {\"ok\":true,\"db\":\"up\"}"
echo "──────────────────────────────────────────────────────────────"
echo
