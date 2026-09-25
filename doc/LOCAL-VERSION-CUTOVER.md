# Local version cutover and agent transfer

Operator runbook for moving a Paperclip instance onto a new build, and for moving
company/agent data between instances.

Every command below was verified against the CLI source at 8781f06a. Flag names are
exact, not aspirational. Two of them are commonly guessed wrong and are called out
explicitly.

## What "make the new build main" actually means

Three separate layers, easily confused:

| Layer | What it is | How it changes |
|---|---|---|
| Source checkout | The repo you are editing | git branch/commit. Not automatically what runs. |
| Managed CLI payload | ~/.paperclip/cli/current -> installs/npm/<version> | paperclipai install / update. This is what the shim runs. |
| Instance data | ~/.paperclip/instances/<id>/ | Migrations on start. Independent of which payload runs. |

The stable entrypoint is ~/.local/bin/paperclipai, a shim pointing at
~/.paperclip/cli/current. Never hand-edit that symlink. A source checkout is not the
managed main binary, and pnpm dev from a checkout is a dev server, not the main
service.

## Two different transfers — pick one

- Same host, new code version: seed a full isolated worktree from the running
  instance, verify it, then switch the managed payload. Data and agent identity are
  preserved because the database is copied, not re-imported.
- Different instance or host: use company export / company import. Portable markdown.
  Carries agent identity, instructions, adapter/env declarations, and optionally
  projects/issues/tasks/skills. Does NOT carry secret values, database IDs,
  machine-local paths, or host-local OpenCode login. Imported agents land paused.

Do not copy the instance data directory or the database between versions by hand.
Migrations are not reversible; a hand-copied database is not a supported upgrade path.

---

## Route A — same host, new version (recommended)

### 1. Baseline the current main instance

    paperclipai service status --json
    curl -fsS http://127.0.0.1:3100/api/health

Record the reported version and confirm status: ok before changing anything.

### 2. Force an explicit pre-cutover backup

Scheduled backups exist, but do not rely on the most recent one:

    paperclipai db:backup --json

Keep the filename. update also takes its own pre-update backup unless you pass
--no-backup. Do not pass --no-backup.

### 3. Get the new code into a committed branch

The new build must be in a commit before a worktree or managed install can carry it:

    git status --short
    git switch -c <your-branch>
    git add <only-the-files-you-intend>
    git commit -m "..."

Stage explicit paths. Do not use git add . A managed Git install executes build
scripts from the pushed ref, so the commit must be one you trust and have reviewed.

### 4. Create a full-seeded isolated staging instance

IMPORTANT: worktree:make and worktree init both default to --seed-mode minimal.
For a staging copy that actually contains your agents you MUST pass full explicitly.
Omitting it gives you a nearly empty instance that will look fine and be useless.

    paperclipai worktree:make <name> \
      --from-instance default \
      --seed-mode full \
      --server-port 3115

- Creates ~/paperclip-<name> as a linked git worktree, auto-prefixed if needed.
- The instance is isolated: its own data dir and its own embedded Postgres.
  Pass --db-port if 54330 is already taken by the 3110 preview.
- Copied agent work is QUARANTINED by default. Do not pass --preserve-live-work
  unless you specifically want the staging copy to resume copied assignments.

Check the seed result before trusting the instance. The marker must read verified in
the worktree seed manifest.

### 5. Verify the staging instance

    curl -fsS http://127.0.0.1:3115/api/health
    paperclipai worktree:list --json

Confirm: health ok and reporting the new build; expected companies and agents present
and matching main; a known agent opens with harness/runtime config intact; seed
manifest says verified.

### 6. Reconnect local runtimes

A full worktree seed copies Paperclip data, not host-local authentication. Your local
OpenCode login lives in the OpenCode CLI own store on the host:

- same host: the existing local login should still apply — VERIFY it on the staging
  instance before assuming it;
- different host: run opencode auth login on the destination.

Managed connections (OpenRouter etc.) are Paperclip data and do travel in a full seed.
Secret values are encrypted against the instance own key, so if the staging instance
generates a new secrets key, re-verify any secret-backed connection before cutover.

### 7. Cut over the managed payload

Only after steps 5 and 6 pass. Both of these are read-only:

    paperclipai update --check
    paperclipai update --dry-run

For a specific published version:

    paperclipai update --version <version>

update backs up the database, installs the payload, verifies the CLI, atomically
switches current, and restarts the service. Two previous payloads are retained
(manifest.previous is capped at 2 entries).

On THIS host install.json currently has previous: [], because only one managed
install has ever landed. Until a second update completes, update --rollback fails
with "No previous managed payload is available for rollback." and a database
restore is the only rollback. Check this before promising a code-only rollback.

### 8. Verify, and keep rollback ready

    paperclipai service status --json
    curl -fsS http://127.0.0.1:3100/api/health

Rollback flips the retained payload back:

    paperclipai update --rollback

ROLLBACK DOES NOT REVERSE DATABASE MIGRATIONS. If the new build applied a migration you
need to undo, restore the pre-cutover backup from step 2. Payload rollback and database
restore are separate operations.

---

## Route B — transfer to another instance or host

Use this when the destination is a separate Paperclip installation, not just a new
build on the same machine.

### Export from the source

    paperclipai company export <companyId> \
      --out ./agent-transfer \
      --include company,agents,projects,issues,tasks,skills \
      --expand-referenced-skills

- --include accepts: company,agents,projects,issues,tasks,skills. The DEFAULT is
  company,agents only — pass the rest explicitly if you want them.
- --expand-referenced-skills vendors skill contents instead of leaving upstream
  references that may not resolve on the destination.
- --out must be empty, or you must pass --force.
- --json IS supported on export. It arrives via addCommonClientOptions, the same
  place --api-base and --key come from, and switches the result to a JSON object
  (out, rootPath, filesWritten, warningCount). Do not assume the absence of a
  --json line in the export block means the flag is missing.

Review the package before moving it. It contains markdown, not secrets.

### Import into the destination — dry run first

    paperclipai company import ./agent-transfer \
      --target new \
      --dry-run

--target accepts new or existing. If omitted it infers existing when a company id is
present in context, else new.

### Apply

New company:

    paperclipai company import ./agent-transfer \
      --target new \
      --new-company-name "My Company" \
      --yes

Existing company:

    paperclipai company import ./agent-transfer \
      --target existing \
      --company-id <target-company-id> \
      --include agents \
      --collision rename \
      --yes

- --collision is rename | skip | replace (default rename). There is NO keep-both.
- --json IS supported on import, for the same reason.
- --json and --apply together still need --yes. The CLI refuses a non-interactive
  apply without it, and a selection prompt is not a substitute for review.
- Imported agents and routines are PAUSED by default. Review before activating.
- Non-interactive runs need --yes; without it the command prompts and will hang.

### Re-authenticate on the destination

- opencode auth login for local OpenCode runtimes.
- Managed connections and secret values do not travel; recreate or re-link them.

---

## Helper scripts

- scripts/paperclip-cutover-preflight.sh — read-only gate. Exits 1 on any blocking
  finding, 0 with warnings only. Checks the CLI shim, install.json source/version/
  retained payloads, the current payload symlink, the real backup dir
  (<instance>/data/backups) and backup freshness, /api/health, the systemd USER unit
  paperclipai.service, and optionally a worktree seed manifest and repo cleanliness.
  Useful flags: --repo <path>, --worktree <path>, --expected-version <v>,
  --max-backup-age-hours <n>, --skip-supervisor. It never installs, restarts, or writes.
  A dirty worktree is a BLOCKING finding: a managed build of HEAD would silently omit
  uncommitted work.
- scripts/paperclip-company-transfer.sh — thin export/import wrapper. Import is
  dry-run by default; --apply additionally needs either a TTY plus a typed APPLY, or
  an explicit --non-interactive-yes. Rejects contradictory targets (--target new with
  --company-id) and unknown --collision modes before calling the CLI. Secrets are
  read from PAPERCLIP_API_KEY in the environment, never from argv.

## Safety rules

- Never edit ~/.paperclip/cli/current or the ~/.local/bin/paperclipai shim by hand.
- Never copy an instance data directory or database to "upgrade" it.
- Never pass --no-backup to update.
- Never run update --rollback expecting it to undo migrations; it only flips code.
- Stage and verify on an isolated instance and port before touching the main service.
- The main service supervisor is not visible from every shell. If systemctl / docker /
  ss do not show the process, do not guess at service control — the switch must run
  in the host context that owns the service.
