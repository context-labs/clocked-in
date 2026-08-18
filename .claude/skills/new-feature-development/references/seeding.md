# Local data seeding

Every feature and bug fix should be **tryable on a freshly-seeded local stack**.
Seeded data is how a reviewer, QA, or the next agent exercises your work without
hand-crafting rows: they run one reset command, log in as a well-known user, and
the feature is right there with realistic data behind it. When you build
something new, ask: *after `task reset-database -- -y`, can someone see and use
this feature?* If the answer is no, extend the seed.

## The commands

```bash
task reset-database -- -y   # the full QA path: tear down ALL compose stacks
                            # (destroys volumes), bring up docker-compose-base.yaml
                            # with --wait, run migrations (task db-migrate), then
                            # seed everything (task seed-local-data)

task seed-local-data        # just the seeding: seed-traces + seed-test-resources
task seed-test-resources    # the main Postgres/ClickHouse/Stripe seeder (idempotent —
                            # safe to re-run without a reset while iterating)
task seed-traces            # gzipped OTLP span fixture → ClickHouse `spans`
```

Defined in the root `Taskfile.yml`. `seed-test-resources` runs
`apps/relay/src/scripts/seed-test-resources.ts` under
`infisical run --env=local --path=/relay`, so an Infisical session is required
(as is `STRIPE_SECRET_KEY_V2` — a test key — in that path for payment-method
seeding; the script hard-fails on a live key). Migrations must be applied first;
the seeder checks schema readiness and tells you to `task reset-docker-all -- -y`
on stale state.

Tuning env vars:

- `LOCAL_DEVELOPMENT_SEED_INFERENCE_COUNT` — inference row volume (Taskfile
  default `1000`).
- `E2E_FAST_SEED=true` — early-exit after users/orgs/models; used by fast e2e
  shards.

## What gets seeded, and where

**The main seeder — `apps/relay/src/scripts/seed-test-resources.ts`.** One large,
idempotent script that builds the whole local product world:

- **Users/teams/auth** — three users created through the real BetterAuth
  sign-up flow (DB hooks force deterministic IDs). Each gets a 1:1 team
  (team id == user id), a default project, a project API key, an initial
  balance, a subscription-tier row, and an approved worker.
- **Models & catalog** — seed models + engine configs, plus the
  model-normalization catalog and system rubrics (see "catalog seeds" below).
- **Product domains** — the Nubank demo org/project, payment-gate teams,
  deployments (+ instances/aliases/inferences), control tower, GitHub + Slack
  integrations, halo data, datasets, training jobs, eval runs, auto-train
  configs, inference-analysis insights, signals + signal alerts.

**Where the data lands:**

- **Postgres** (`localhost:5432`) — all the relational entities above.
- **ClickHouse** (`localhost:8123`) — `inferences`, `spans`, `training_metrics`,
  `signal_labels`, `task_status`; plus the `external_telemetry` DB
  (`otel_logs`/`otel_traces`/`otel_metrics`) for training/eval logs.
- **Stripe (test mode)** — real test customers with a `tok_visa` default
  payment method for the users configured with one.

**Migration-time catalog seeds — `packages/db/src/seed/`** (exported via
`@kuzco/db/seed`, invoked from `apps/migrations/src/migrate.ts` after
migrations). These run in **every environment**, not just local: the
`inf-public` platform team/project, providers, models, alias mappings, provider
routes, built-in recipes, and system rubrics. Put data here only if production
needs it too.

**ClickHouse helpers** — `packages/llm-ops-db-clickhouse/src/seeding/seed-inferences.ts`
(shared inference-batch generator with OpenAI/Anthropic plain/structured/image/tool
scenarios), `tooling/seed-traces/seed-traces.ts` (span fixture, timestamps
rebased to ~5 min ago), and `docker/llm-ops/clickhouse-init/seed.sql`
(container-init `task_status` fixtures).

## The well-known identities

All fixed test identities live in `packages/api/src/lib/const.ts` — **never
invent new emails/IDs inline in a seeder; add new well-known values there.**

| What | Value |
| --- | --- |
| Primary user | `test@inference.net` / password `t`, id `test-user-id` (also its team id), project `test-project-id`, API key `sk-inference-test-api-key`; has a default payment method |
| Second user | `test2@inference.net` / `t`, id `test-user-2-id`, API key `sk-inference-test-api-key-2` — multi-user scenarios |
| Non-admin user | `nonadmin@example.com` / `t`, FREE tier, no payment method, project `test-nonadmin-project-id`, API key `sk-inference-test-nonadmin-api-key` — payment-gate/limit flows |
| Nubank demo org | slug `nubank`, API keys `sk-nubanknubank` / `sk-nubank-e2e-test` — multi-member org scenarios |

Log in at the dashboard with `test@inference.net` / `t` after any reset.

## Extending the seed for your feature

Follow the established pattern in `seed-test-resources.ts`:

1. **Fixture config first.** Define a typed config interface and a top-level
   `const XXX_SEEDS: XxxSeedConfig[]` array of literal fixtures (see
   `TRAINING_JOB_SEEDS`, `SEED_MODELS`, `SEED_DEPLOYMENTS`,
   `AUTO_TRAIN_CONFIG_SEEDS` in that file). Data lives in the array; logic lives
   in the seeder function.
2. **Write an idempotent `seedX()`.** Check-then-insert or
   `onConflictDoUpdate`; the whole script must be safe to re-run without a
   reset. Use **deterministic IDs** derived from a stable prefix or hash (e.g.
   the `seedId(projectId, slug)` pattern in
   `packages/services/inference-analysis-service/src/seeding/seed-insights.ts`)
   so e2e tests and docs can reference them.
3. **Attach to the well-known identities.** Seed under `TEST_USER_1`'s
   team/project (or the identity whose scenario you're modeling — nonadmin for
   gated flows, Nubank for org flows) so the data is visible on first login.
4. **Call it from `main()` in FK order** — users → org/project → models/catalog
   → deployments/datasets → training → analysis → signals. Independent seeders
   go inside the existing `Promise.all` groups; anything ClickHouse-based takes
   the shared client as a parameter. Place it **after** the `E2E_FAST_SEED`
   early return unless fast e2e shards genuinely need it.
5. **Gate heavy volume** behind an env count like
   `LOCAL_DEVELOPMENT_SEED_INFERENCE_COUNT` instead of hard-coding thousands of
   rows.
6. **Catalog data goes elsewhere.** If the rows must exist in *all*
   environments (platform catalog, system rubrics), add a module under
   `packages/db/src/seed/`, export it from the barrel, and wire it into the
   catalog-seeding step in `apps/migrations/src/migrate.ts` — not into the
   local-only script.

Then verify: `task reset-database -- -y`, log in as `test@inference.net` / `t`,
and walk the feature end to end on nothing but seeded data. Mention the seeded
entry point (which user/project/IDs to look at) in the PR description.
