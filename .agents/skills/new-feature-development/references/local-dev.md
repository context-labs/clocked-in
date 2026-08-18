# Local development loop

Everything is driven by the root `Taskfile.yml`. Run `task --list` to browse.

## Run the stack

```bash
task start-pc          # full stack via process-compose, detached (-D),
                       # dependency-ordered, readiness probes, restart-on-failure.
                       # Per-service logs land in ./logs/. Depends on infisical:check.
task start-pc -- relay air-traffic-control inference-api   # subset (deps pulled in)
task status-pc         # process list (JSON)
task stop-pc           # process-compose down
```

`task start` is the interactive TUI equivalent (`mprocs`), not detached. Attach to
a running detached stack with `process-compose attach`. `process-compose` must be
on PATH (https://github.com/F1bonacc1/process-compose).

## Reset & seed the database

```bash
task reset-database -- -y
```

This is an alias to `reset-docker-all`: it tears everything down **and destroys
volumes**, brings the base compose up with `--wait`, runs migrations
(`db-migrate`), then seeds (`seed-local-data` → `seed-traces` + `seed-test-resources`).
The `-- -y` skips the "this will destroy all data" confirmation. Use it whenever
you need a clean, freshly-seeded DB.

### Logging in after a reset

The seed creates a test user (`apps/relay/src/scripts/seed-test-resources.ts`,
from constants in `packages/api/src/lib/const.ts`):

- **Email:** `test@inference.net`
- **Password:** `t`

(Also seeded: `test2@inference.net` / `t`, and a `nonadmin@example.com` / `t` for
payment-gate flows; project id `test-project-id`.)

`seeding.md` covers the full picture — what data the seed creates, where it
lands (Postgres / ClickHouse / Stripe test mode), the well-known IDs, and the
pattern for extending the seed so a new feature is tryable after a reset.

## The `task check` gate

**`task check`** — the fast, branch-scoped gate that CI mirrors. Runs, scoped to
the diff vs `origin/development`: `format:changed`, `lint:changed`,
`db-check:scoped`, dependency-version + package-command validation (concurrently),
then `tsc` (full `tsc --build`) and `test:affected` (only affected packages). This
must be green before a feature is "done."

**`task check-fix`** — the autofix variant. First regenerates Cloudflare Worker
types for changed workers (`cf:typegen:changed`), then applies Oxfmt + lint fixes
over the branch diff (`fix:changed`), then runs the scoped non-formatting checks.
Run this to clear formatting/lint noise and to refresh Worker types after binding
changes.

**`task check:all`** — the exhaustive whole-repo pass (slower; the true CI mirror)
when you want maximum confidence before handing off.

Run `task check` / `check-fix` throughout the writing loop, not just at the end —
a tight fix loop is cheaper than a big red pile at PR time. Note: the repo Stop
hook may report already-fixed lint; when in doubt, re-run the check directly on
the file.
