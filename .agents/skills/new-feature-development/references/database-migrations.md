# Database migrations (Drizzle + Postgres)

Every schema change to the core Postgres database goes through Drizzle: you edit
the schema in `packages/db`, **generate** a migration with drizzle-kit, and
commit the generated folder. Migrations are never hand-written into
`apps/migrations/src/migrations/` except through the `--custom` escape hatch
below, and the generated SQL is never edited after the fact.

This document covers **Postgres only**. ClickHouse migrations are hand-written
numbered SQL applied by a different command — see `datastores.md`, which also
covers which of the two databases a given piece of data belongs in.

## The two packages

- **`packages/db`** — the schema source of truth. One table per file in
  `src/tables/<Name>Table.drizzle.ts`, re-exported from `src/schema.ts`
  (the barrel drizzle-kit reads), plus enums in `src/enums/` and relations in
  `src/relations-v1.ts`.
- **`apps/migrations`** (`@kuzco/migrations`) — the generated migration folders
  (`src/migrations/<timestamp>_<name>/{migration.sql,snapshot.json}`), the
  runtime migrator (`src/migrate.ts`, what runs on deploy), and the drizzle-kit
  configs. Its `drizzle.config.ts` points `schema` at
  `../../packages/db/src/schema.ts`.

A table that isn't exported from `src/schema.ts` is invisible to drizzle-kit —
it will generate no migration and no error. Export it.

## The `task` commands

Run these from the repo root; they wrap the package scripts (which in turn wrap
`infisical run --env=local --path=/postgres-migration-job` for DB credentials).

| Command | What it does |
| --- | --- |
| `task db-generate` | Diffs `packages/db/src/schema.ts` against the latest snapshot and writes a new `src/migrations/<timestamp>_<name>/` folder. Does **not** touch a database. |
| `task db-migrate` | Applies pending migrations to the database `DB_*` points at (local by default), then runs the catalog seeds. |
| `task db-generate-and-apply` | Both, in order. The normal local loop. |
| `task db-check` | Validates the migration DAG offline — ordering, snapshots, commutative conflicts. Turbo-cached; ~12–35s on a miss. |
| `task db-check:scoped` | Runs `db-check` only when this branch's diff actually touches `packages/db` or `apps/migrations`. What `task check` and the pre-push hook use. |
| `task reset-database -- -y` | Drops volumes, brings the stack up, runs migrations, and seeds. Use when your branch's migrations have diverged from the local DB. |

From `apps/migrations` there are two package scripts with no `task` wrapper:

- `bun run db:generate:custom --name <snake_case_name>` — emits an **empty**
  migration folder for hand-written SQL (data backfills, index builds,
  `CREATE INDEX CONCURRENTLY`, anything drizzle can't express). Still gets a
  snapshot, so it stays in the DAG.
- `bun run db:studio` — drizzle studio against the configured DB.

## The loop for a schema change

1. Edit or add the table file under `packages/db/src/tables/` and export it from
   `src/schema.ts`.
2. `task db-generate` — read the generated `migration.sql` before committing it.
   drizzle-kit will happily emit a destructive statement (a rename it inferred as
   drop + add, a `NOT NULL` on a populated table) and it never prompts twice.
3. `task db-migrate` to apply locally, then exercise the code path.
4. Commit the schema change **and** the generated migration folder in the same
   commit. CI's freshness check re-runs `drizzle-kit generate` and fails if it
   produces anything, so a schema edit without its migration is a red build.
5. `task check` — its `db-check:scoped` step validates the DAG.

## Backfills and data migrations

Use `db:generate:custom` for a data change, and keep it idempotent — the migrator
records applied migrations by SHA, but a partially-applied migration on a failed
deploy leaves the transaction rolled back, and reruns of the *logic* (via a repair
script) should converge. Comment the SQL with the ticket and the reason; see
`20260729182725_backfill_eval_model_image_modalities` for the house style.

Long-running, unbounded backfills do **not** belong in a migration — the deploy
job blocks on them. Ship them as a standalone script under `apps/migrations/src/`
with its own package script and README section (the pattern used by
`repair-credit-balance-checkpoints.ts` and `resync-lifetime-usage-counters.ts`):
dry-run by default, an explicit `*_APPLY=true` to write, scoped and batched.

## Rolling deploys: expand, migrate, contract

Migrations run **before** the new code is fully rolled out, and old pods keep
serving during it. So a single PR can never both stop writing a column and drop
it. Split it across PRs:

1. **Expand** — add the new column/table nullable-or-defaulted; deploy code that
   writes both old and new.
2. **Migrate** — backfill; switch reads to the new shape.
3. **Contract** — stop writing the old shape, then drop it in a later migration,
   once no running code references it.

The recent `..._drop_legacy_transaction_ledger_tier1/tier2/tier3` migrations are
that pattern staged out. Adding a `NOT NULL` column with no default, renaming a
column, or dropping one still referenced by the previous release will break
in-flight requests during the rollout.

## Migration conflicts after a rebase

The migration DAG must have exactly **one leaf**. Two PRs that each generate a
migration off the same parent produce two leaves; `drizzle-kit check` accepts
that (they don't conflict), but `bun run db:check-single-leaf` fails it in CI,
and `drizzle-kit generate` starts misbehaving afterward.

When you rebase onto a `development` that gained a migration:

1. Delete **your** generated migration folder(s) — the ones your branch added.
2. Re-run `task db-generate` so the new migration's `snapshot.json` records the
   rebased parent in `prevIds`.
3. `task db-check` to confirm a single leaf, then `task reset-database -- -y` (or
   `task db-migrate` against a clean DB) since your old folder may already be
   recorded locally.

Never fix a multi-leaf DAG by hand-editing `prevIds` or renaming folders.

## CI

`.github/workflows/inference--db-migrations.yml` runs on any PR touching
`inference/apps/migrations/**` or `inference/packages/db/**`:

- `drizzle-kit check` — DAG + commutative conflicts
- `db:check-single-leaf` — exactly one leaf
- freshness — re-runs `drizzle-kit generate` and fails if the working tree
  changes ("Schema is out of sync with migrations. Run `task db-generate`
  locally and commit the result.")
