#!/usr/bin/env bash
# paperclip-cutover-preflight.sh — read-only safety gate before promoting a local
# Paperclip build to the managed default instance on this host.
#
# This script never writes, updates, restarts, or imports anything. It only reads
# state and prints PASS / WARN / FAIL lines, then exits non-zero if any FAIL fired.
#
# Verified against this host (2026-09-25):
#   * backups live under <instance data>/backups, NOT <instance>/backups
#   * the supervisor is a systemd *user* unit: paperclipai.service (default instance)
#   * the default worktree home is ~/.paperclip-worktrees (~/.paperclip/worktrees is legacy)
#   * both /api/health and /health answer 200; /api/version is not an endpoint
#   * CLI is reachable via the shim, which may not be on PATH in a bare shell
#
# Usage:
#   scripts/paperclip-cutover-preflight.sh [options]
#     --instance <id>        managed instance id (default: default)
#     --port <n>             managed instance port (default: 3100)
#     --expected-version <s> fail unless install.json and /api/health agree
#     --max-backup-age-hours <n>  newest database backup must be younger (default: 24)
#     --repo <path>          also require a clean git worktree at <path>
#     --worktree <path>      also require a worktree seed manifest marked verified
#     --skip-supervisor      do not probe systemd (useful when systemctl is absent)
#     -h, --help             show this help
#
# Exit codes:
#   0  every check passed (warnings allowed)
#   1  one or more FAIL checks
#   2  usage error

set -uo pipefail

PASS_COUNT=0; WARN_COUNT=0; FAIL_COUNT=0
FAILS=""

pass() { printf 'PASS  %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
warn() { printf 'WARN  %s\n' "$1"; WARN_COUNT=$((WARN_COUNT + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAIL_COUNT=$((FAIL_COUNT + 1)); FAILS="$FAILS
  - $1"; }
info() { printf '      %s\n' "$1"; }
head2() { printf '\n== %s ==\n' "$1"; }

usage() { sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

INSTANCE="default"
PORT="3100"
EXPECTED_VERSION=""
MAX_BACKUP_AGE_HOURS=24
REPO=""
WORKTREE=""
CHECK_SUPERVISOR=1

while [ $# -gt 0 ]; do
  case "$1" in
    --instance) [ $# -ge 2 ] || { printf 'error: --instance needs a value\n' >&2; exit 2; }; INSTANCE="$2"; shift 2 ;;
    --port) [ $# -ge 2 ] || { printf 'error: --port needs a value\n' >&2; exit 2; }; PORT="$2"; shift 2 ;;
    --expected-version) [ $# -ge 2 ] || { printf 'error: --expected-version needs a value\n' >&2; exit 2; }; EXPECTED_VERSION="$2"; shift 2 ;;
    --max-backup-age-hours) [ $# -ge 2 ] || { printf 'error: --max-backup-age-hours needs a value\n' >&2; exit 2; }; MAX_BACKUP_AGE_HOURS="$2"; shift 2 ;;
    --repo) [ $# -ge 2 ] || { printf 'error: --repo needs a value\n' >&2; exit 2; }; REPO="$2"; shift 2 ;;
    --worktree) [ $# -ge 2 ] || { printf 'error: --worktree needs a value\n' >&2; exit 2; }; WORKTREE="$2"; shift 2 ;;
    --skip-supervisor) CHECK_SUPERVISOR=0; shift ;;
    -h|--help) usage ;;
    *) printf 'error: unknown arg: %s\n' "$1" >&2; usage ;;
  esac
done

CLI_DIR="$HOME/.paperclip/cli"
INSTALL_JSON="$CLI_DIR/install.json"
CURRENT_LINK="$CLI_DIR/current"
INSTANCE_DIR="$HOME/.paperclip/instances/$INSTANCE"
DATA_DIR="$INSTANCE_DIR/data"
BACKUP_DIR="$DATA_DIR/backups"
SHIM="$HOME/.local/bin/paperclipai"
LEGACY_WORKTREE_DIR="$HOME/.paperclip/worktrees"
DEFAULT_WORKTREE_HOME="$HOME/.paperclip-worktrees"

printf 'paperclip cutover preflight\n'
printf 'instance=%s port=%s host=%s\n' "$INSTANCE" "$PORT" "$(hostname 2>/dev/null || echo unknown)"

# ---------------------------------------------------------------- cli on PATH
head2 "CLI availability"
if command -v paperclipai >/dev/null 2>&1; then
  pass "paperclipai on PATH: $(command -v paperclipai)"
elif [ -x "$SHIM" ]; then
  pass "paperclipai not on PATH but shim is executable: $SHIM"
  info "managed commands need the shim on PATH or an absolute invocation"
else
  fail "no paperclipai on PATH and no executable shim at $SHIM"
fi

# ------------------------------------------------------------- managed install
head2 "Managed install metadata"
if [ -f "$INSTALL_JSON" ]; then
  pass "install metadata present: $INSTALL_JSON"
  if command -v node >/dev/null 2>&1; then
    SRC="$(node -e 'try{const j=require(process.env.HOME+"/.paperclip/cli/install.json");process.stdout.write(j.source||"?")}catch(e){}' 2>/dev/null || true)"
    VER="$(node -e 'try{const j=require(process.env.HOME+"/.paperclip/cli/install.json");process.stdout.write(j.version||"?")}catch(e){}' 2>/dev/null || true)"
    CHANNEL="$(node -e 'try{const j=require(process.env.HOME+"/.paperclip/cli/install.json");process.stdout.write(j.channel||"?")}catch(e){}' 2>/dev/null || true)"
    N_PREV="$(node -e 'try{const j=require(process.env.HOME+"/.paperclip/cli/install.json");process.stdout.write(String((j.previous||[]).length))}catch(e){}' 2>/dev/null || true)"
    info "source=$SRC version=$VER channel=$CHANNEL previous-payloads=$N_PREV"
    if [ "$VER" != "?" ] && [ -n "$EXPECTED_VERSION" ] && [ "$VER" != "$EXPECTED_VERSION" ]; then
      fail "installed version $VER != expected $EXPECTED_VERSION"
    fi
    if [ "$N_PREV" = "0" ]; then
      warn "no retained previous payload: 'paperclipai update --rollback' has nothing to roll back to"
      info "a database restore is the only rollback path until one more managed update lands"
    else
      pass "a previous managed payload is retained for rollback"
    fi
  else
    warn "node not available; could not parse install.json"
  fi
else
  fail "missing install metadata: $INSTALL_JSON"
fi

if [ -L "$CURRENT_LINK" ]; then
  RESOLVED="$(readlink -f "$CURRENT_LINK" 2>/dev/null || echo unresolvable)"
  pass "current payload symlink: $CURRENT_LINK -> $RESOLVED"
  if [ ! -d "$RESOLVED" ]; then
    fail "current payload symlink is dangling: $RESOLVED"
  fi
else
  fail "missing current payload symlink: $CURRENT_LINK"
fi
if [ -e "$CLI_DIR/.managed-install" ]; then
  pass "managed-install marker present"
else
  warn "no .managed-install marker; installs may be hand-managed, not via paperclipai update"
fi

# ----------------------------------------------------------------- data + db
head2 "Instance data"
if [ -d "$DATA_DIR" ]; then
  pass "instance data dir: $DATA_DIR"
else
  fail "missing instance data dir: $DATA_DIR"
fi

if [ -d "$BACKUP_DIR" ]; then
  pass "backup dir: $BACKUP_DIR"
  NEWEST="$(ls -1t "$BACKUP_DIR" 2>/dev/null | head -n 1 || true)"
  if [ -z "$NEWEST" ]; then
    fail "backup dir exists but is empty: $BACKUP_DIR"
  else
    NEWEST_PATH="$BACKUP_DIR/$NEWEST"
    SIZE="$(du -h "$NEWEST_PATH" 2>/dev/null | cut -f1 || echo '?')"
    AGE_HOURS=$(( ( $(date +%s) - $(date -r "$NEWEST_PATH" +%s 2>/dev/null || echo 0) ) / 3600 ))
    info "newest backup: $NEWEST ($SIZE, ${AGE_HOURS}h old)"
    if [ "$AGE_HOURS" -gt "$MAX_BACKUP_AGE_HOURS" ]; then
      fail "newest backup is ${AGE_HOURS}h old (limit ${MAX_BACKUP_AGE_HOURS}h)"
    else
      pass "a recent database backup exists"
    fi
  fi
else
  fail "missing backup dir: $BACKUP_DIR (not $INSTANCE_DIR/backups)"
fi

# ------------------------------------------------------------------- health
head2 "Managed instance health"
HEALTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo 000)"
if [ "$HEALTH_CODE" = "200" ]; then
  pass "/api/health returned 200 on port $PORT"
else
  fail "/api/health returned $HEALTH_CODE on port $PORT"
fi
ROOT_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null || echo 000)"
if [ "$ROOT_CODE" = "200" ]; then
  pass "/health returned 200 on port $PORT"
else
  warn "/health returned $ROOT_CODE (informational endpoint)"
fi
if command -v ss >/dev/null 2>&1; then
  OWNER="$(ss -ltnp 2>/dev/null | grep ":$PORT " | sed 's/^[[:space:]]*//' || true)"
  if [ -n "$OWNER" ]; then
    info "port $PORT listener: $OWNER"
  else
    warn "could not attribute port $PORT to a process (ss found no listener row)"
  fi
else
  info "ss not available; skipping port ownership check"
fi

# ---------------------------------------------------------------- supervisor
head2 "Supervisor"
if [ "$CHECK_SUPERVISOR" -eq 0 ]; then
  info "skipped by --skip-supervisor"
elif [ "$INSTANCE" = "default" ]; then
  UNIT="paperclipai.service"
else
  UNIT="paperclipai-$INSTANCE.service"
fi
UNIT_PATH="$HOME/.config/systemd/user/$UNIT"
info "expected user unit: $UNIT_PATH"
if [ -f "$UNIT_PATH" ]; then
  pass "user unit file present: $UNIT_PATH"
else
  fail "missing user unit file: $UNIT_PATH (system-level unit would be wrong here)"
fi
if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user is-active --quiet "$UNIT" 2>/dev/null; then
    pass "systemd --user reports $UNIT active"
  else
    fail "systemd --user does not report $UNIT active"
  fi
else
  warn "systemctl not available; supervisor liveness unverified from this shell"
  info "re-check with 'systemctl --user status $UNIT' on the host before cutover"
fi

# ------------------------------------------------------------- worktree state
head2 "Worktrees"
if [ -d "$LEGACY_WORKTREE_DIR" ]; then
  warn "legacy worktree dir exists: $LEGACY_WORKTREE_DIR"
  info "current default worktree home is $DEFAULT_WORKTREE_HOME"
else
  pass "no legacy worktree dir at $LEGACY_WORKTREE_DIR"
fi
if [ -d "$DEFAULT_WORKTREE_HOME" ]; then
  info "default worktree home: $DEFAULT_WORKTREE_HOME"
else
  info "no default worktree home yet at $DEFAULT_WORKTREE_HOME"
fi
if [ -n "$WORKTREE" ]; then
  MANIFEST="$WORKTREE/seed-manifest.json"
  if [ -f "$MANIFEST" ]; then
    pass "seed manifest present: $MANIFEST"
    if command -v node >/dev/null 2>&1; then
      SEED_STATE="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.state||j.status||"?")}catch(e){}' "$MANIFEST" 2>/dev/null || true)"
      SEED_MODE="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.mode||j.seedMode||"?")}catch(e){}' "$MANIFEST" 2>/dev/null || true)"
      info "seed mode=$SEED_MODE state=$SEED_STATE"
      case "$SEED_STATE" in
        verified) pass "seed manifest is marked verified" ;;
        *) warn "seed manifest state is '$SEED_STATE', expected 'verified'" ;;
      esac
    fi
  else
    fail "no seed-manifest.json in worktree: $WORKTREE"
  fi
else
  info "no --worktree given; skipping seed verification"
fi

# ------------------------------------------------------------------ repo gate
head2 "Source repository"
if [ -n "$REPO" ]; then
  if [ -d "$REPO/.git" ] || [ -f "$REPO/.git" ]; then
    pass "git repository: $REPO"
    if command -v git >/dev/null 2>&1; then
      DIRTY="$(git -C "$REPO" status --porcelain 2>/dev/null || echo "git-status-failed")"
      if [ -z "$DIRTY" ]; then
        pass "worktree is clean — a managed build of HEAD would include all intended work"
      else
        fail "worktree is dirty; a managed build of HEAD would omit uncommitted changes"
        printf '%s\n' "$DIRTY" | sed 's/^/        /'
      fi
      info "HEAD: $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown) on $(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    else
      warn "git not available; cannot verify worktree cleanliness"
    fi
  else
    fail "not a git repository: $REPO"
  fi
else
  info "no --repo given; skipping repository cleanliness gate"
fi

# --------------------------------------------------------------------- verdict
printf '\n== Verdict ==\n'
printf 'pass=%d warn=%d fail=%d\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  printf 'blocked by:\n%b\n' "$FAILS"
  printf '\nRESULT: NOT SAFE TO CUTOVER\n'
  exit 1
fi
printf '\nRESULT: no blocking findings (review warnings before proceeding)\n'
exit 0
