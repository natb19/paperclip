#!/usr/bin/env bash
# paperclip-company-transfer.sh — guarded wrapper around `paperclipai company export/import`.
#
# Design rules:
#   * Import is DRY RUN by default. Applying requires an explicit --apply.
#   * Secrets are never accepted on the command line. Export PAPERCLIP_API_KEY in
#     your shell; the CLI reads it from the environment (cli/src/commands/client/common.ts).
#   * The source instance is never modified or deleted.
#   * Flag names are verified against cli/src/commands/client/company.ts. Both
#     `company export` and `company import` DO accept --json (they get it from
#     addCommonClientOptions), so --json is passed through here as well.
#
# Environment (names verified in cli/src/commands/client/common.ts):
#   PAPERCLIP_API_KEY   optional bearer token (or use a stored board credential)
#   PAPERCLIP_API_URL   optional API base override (equivalent to --api-base)
#   PAPERCLIP_COMPANY_ID optional default company id
#
# Usage:
#   # export from the source instance
#   scripts/paperclip-company-transfer.sh export <companyId> <outDir> \
#       [--include LIST] [--expand-referenced-skills] [--force] [--json]
#
#   # preview the import (default: no writes to the destination)
#   scripts/paperclip-company-transfer.sh import <pkgDir> --target new|existing \
#       [--company-id ID] [--new-company-name NAME] [--include LIST] \
#       [--agents LIST] [--collision rename|skip|replace] [--json]
#
#   # actually apply (requires --apply, plus a typed confirmation on a TTY)
#   scripts/paperclip-company-transfer.sh import <pkgDir> --target new --apply
#
# Exit codes:
#   0  success
#   2  usage / validation error (nothing was run)
#   3  operator aborted at the confirmation prompt
#   *  any other code is propagated from paperclipai itself

set -uo pipefail

readonly PROG="$(basename "$0")"

die() { printf 'error: %s\n' "$1" >&2; exit 2; }
usage() { sed -n '3,40p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

command -v paperclipai >/dev/null 2>&1 \
  || die "paperclipai not on PATH. Run this from the host that owns the instance."

# Run paperclipai, forwarding credentials through the environment only.
run_cli() {
  if [ "${#CLI_ENV[@]}" -gt 0 ]; then
    env "${CLI_ENV[@]}" paperclipai "$@"
  else
    paperclipai "$@"
  fi
}

CLI_ENV=()
[ -n "${PAPERCLIP_API_KEY:-}" ] && CLI_ENV+=("PAPERCLIP_API_KEY=$PAPERCLIP_API_KEY")
[ -n "${PAPERCLIP_API_URL:-}" ] && CLI_ENV+=("PAPERCLIP_API_URL=$PAPERCLIP_API_URL")

CMD="${1:-}"
[ -n "$CMD" ] || usage
shift

case "$CMD" in
  export)
    COMPANY="${1:-}"; OUT="${2:-}"
    [ -n "$COMPANY" ] || usage
    [ -n "$OUT" ] || usage
    shift 2
    INCLUDE="company,agents"
    ARGS=(--out "$OUT")
    while [ $# -gt 0 ]; do
      case "$1" in
        --include) [ $# -ge 2 ] || die "--include needs a value"; INCLUDE="$2"; shift 2 ;;
        --expand-referenced-skills) ARGS+=(--expand-referenced-skills); shift ;;
        --force) ARGS+=(--force); shift ;;
        --json) ARGS+=(--json); shift ;;
        *) die "unknown export arg: $1" ;;
      esac
    done
    ARGS+=(--include "$INCLUDE")
    printf '[export] company=%s out=%s\n' "$COMPANY" "$OUT"
    printf '[export] include=%s\n' "$INCLUDE"
    printf '[export] note: packages carry no secret values; review before moving.\n'
    printf '[export] note: a non-empty out dir requires --force in a non-TTY shell.\n'
    run_cli company export "$COMPANY" "${ARGS[@]}"
    exit $?
    ;;

  import)
    PKG="${1:-}"
    [ -n "$PKG" ] || usage
    shift
    [ -d "$PKG" ] || die "package dir not found: $PKG"
    [ -f "$PKG/.paperclip.yaml" ] || [ -f "$PKG/.paperclip.yml" ] \
      || printf '[import] warn: no .paperclip.yaml at the package root; continuing.\n' >&2

    TARGET=""; APPLY=0; NONINTERACTIVE=0
    COMPANY_ID=""; NEW_NAME=""; INCLUDE=""; AGENTS=""; COLLISION=""; JSON=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --target) [ $# -ge 2 ] || die "--target needs a value"; TARGET="$2"; shift 2 ;;
        --company-id) [ $# -ge 2 ] || die "--company-id needs a value"; COMPANY_ID="$2"; shift 2 ;;
        --new-company-name) [ $# -ge 2 ] || die "--new-company-name needs a value"; NEW_NAME="$2"; shift 2 ;;
        --include) [ $# -ge 2 ] || die "--include needs a value"; INCLUDE="$2"; shift 2 ;;
        --agents) [ $# -ge 2 ] || die "--agents needs a value"; AGENTS="$2"; shift 2 ;;
        --collision) [ $# -ge 2 ] || die "--collision needs a value"; COLLISION="$2"; shift 2 ;;
        --json) JSON=1; shift ;;
        --apply) APPLY=1; shift ;;
        --non-interactive-yes) NONINTERACTIVE=1; shift ;;
        *) die "unknown import arg: $1" ;;
      esac
    done

    case "$TARGET" in
      new) [ -z "$COMPANY_ID" ] || die "--target new must not be combined with --company-id" ;;
      existing)
        [ -n "$COMPANY_ID" ] || die "--target existing requires --company-id <id>"
        [ -z "$NEW_NAME" ] || die "--new-company-name only applies to --target new"
        ;;
      *) die "--target new|existing is required" ;;
    esac
    case "$COLLISION" in
      ""|rename|skip|replace) ;;
      *) die "--collision must be one of: rename, skip, replace" ;;
    esac

    ARGS=("$PKG" --target "$TARGET")
    [ -n "$COMPANY_ID" ] && ARGS+=(--company-id "$COMPANY_ID")
    [ -n "$NEW_NAME" ] && ARGS+=(--new-company-name "$NEW_NAME")
    [ -n "$INCLUDE" ] && ARGS+=(--include "$INCLUDE")
    [ -n "$AGENTS" ] && ARGS+=(--agents "$AGENTS")
    [ -n "$COLLISION" ] && ARGS+=(--collision "$COLLISION")

    if [ "$APPLY" -eq 0 ]; then
      ARGS+=(--dry-run)
      [ "$JSON" -eq 1 ] && ARGS+=(--json)
      printf '[import] DRY RUN — nothing will be written to the destination.\n'
      printf '[import] pkg=%s target=%s company-id=%s new-name=%s\n' \
        "$PKG" "$TARGET" "${COMPANY_ID:-<none>}" "${NEW_NAME:-<none>}"
      run_cli company import "${ARGS[@]}"
      exit $?
    fi

    if [ "$NONINTERACTIVE" -ne 1 ]; then
      [ -t 0 ] || die "refusing to apply without a TTY. Re-run with --non-interactive-yes if you are certain."
      printf '[import] APPLYING to target=%s. Imported agents land PAUSED by default.\n' "$TARGET"
      printf '[import] This writes to the live destination instance. Type APPLY to continue: '
      read -r confirm
      if [ "$confirm" != "APPLY" ]; then
        printf '[import] aborted by operator\n' >&2
        exit 3
      fi
    fi

    # --yes is required by the CLI for any non-interactive apply, and it also
    # suppresses the pre-import selection prompt (defaults are used).
    ARGS+=(--yes)
    [ "$JSON" -eq 1 ] && ARGS+=(--json)
    run_cli company import "${ARGS[@]}"
    exit $?
    ;;

  -h|--help) usage ;;
  *) usage ;;
esac
