# Configuration and secrets

How a new config value gets from Infisical into a service in this repo, and the four ways that go wrong. Read this whenever a change introduces or renames an environment variable — including a bug fix that adds a timeout, limit, or kill-switch.

The mechanics of Infisical itself (references vs imports, the never-delete rule, CLI landmines) live in the `infisical` skill, and this project's layout (environment slugs, folder-per-service) in its `infisical-inference-platform` overlay. This file is about the code and rollout side.

## The boundary: one config module per app

Every app has a single `src/config.ts` that reads the environment, validates it, and exports a typed object. That file is the **only** place `process.env` or a Worker's `c.env` may be touched.

```ts
// apps/relay/src/config.ts — the pattern
export const Config = {
  port: z.coerce.number().parse(process.env.PORT),
  shutdownTimeoutSeconds: z.coerce.number().int().positive().parse(process.env.SHUTDOWN_TIMEOUT_SECONDS),
  rabbitmq: { url: z.string().parse(process.env.RABBITMQ_URL) },
} as const;
```

Everything downstream receives the value it needs as a typed dependency — the same rule as any other dependency (`AGENTS.md`: dependencies must be explicit and fully wired). A service that reaches for `process.env.FOO` in a method body:

- can't be unit-tested without mutating global state
- fails at the moment the code path runs rather than at startup, so a typo ships and surfaces days later in production
- hides its real inputs from the type system and from anyone reading the constructor
- breaks in Workers, where `process.env` isn't the environment at all — bindings arrive per-request on `c.env`

Parse at the boundary, pass the parsed value inward. In Workers this means reading `c.env` once where the app is constructed and handing typed config to services, never threading the raw env object down.

**Fail fast, and fail at startup.** `AGENTS.md` already requires new config to be required by default — no optional, nullable, or defensive fallback unless the user explicitly asked for a gradual rollout. A missing variable should crash the process on boot with a message naming the variable, which is the cheapest possible failure. A `?? "default"` turns a deploy-time error into a silent behavior change.

> Lint status: enforced by `@kuzco/no-env-outside-config` at `"error"` for
> `packages/services/*/src/**`, where the pattern was already clean (INF-4325).
> The rule flags `process.env` / `globalThis.process.env`, a Hono context's
> `env`, and importing `env` from `cloudflare:workers`; it exempts app config
> modules, tests, and scripts — but never a `config.ts` inside a service
> package, because config is an app-boundary concept. Everywhere else is still
> convention only: ~390 references across ~94 files remain outside config
> modules, so widening the glob needs a per-area cleanup pass first
> (`packages/api/src` is the largest at 113). Register the rule in
> `.oxlintrc.json`, not just `eslint.config.mjs` — the semantic ESLint pass runs
> only for `@kuzco/web`, so an ESLint-only entry enforces nothing.

## Adding a new variable

Work these in order — the Infisical side before the code side, so nothing ships pointing at a key that doesn't exist.

### 1. Create the value in every environment, including the ones you don't need

A variable that exists in `dev` but not `mainnet` is a production incident scheduled for whenever the next deploy happens. Set it in every environment the service runs in — `local`, `dev`, `mainnet`, and `e2-e-tests` if the harness exercises the path.

Where a real value doesn't exist yet or isn't yours to hold, **write a placeholder rather than leaving the key absent**. An obviously-fake value that fails loudly when used beats a missing key that fails at import: the service still boots, the shape is documented, and the gap is visible to whoever owns the real credential. Make placeholders unmistakable (`PLACEHOLDER_ROTATE_ME`, not `test123`), and never let one reach `mainnet` for a variable the production path actually reads.

Put it in the service's own folder (`/relay`, `/llm-ops-trpc-api`, …). If more than one service needs the same value, use the shared-folder + `${env.folder.KEY}` reference pattern from the `infisical` skill (with `infisical-inference-platform` for this project's layout) instead of copying the literal — one canonical value, pointers everywhere else.

### 2. Regenerate Worker types with `task check-fix`

For Cloudflare Workers, the binding types in `worker-configuration.d.ts` are generated, not hand-written. **`task check-fix` regenerates them** (it runs `cf:typegen:changed`); plain `task check` does not — it only validates. So the order is:

```bash
task check-fix   # regenerates worker-configuration.d.ts, then formats/lints/checks
```

Commit the regenerated `worker-configuration.d.ts`. Skipping this produces a type error on the new binding that looks like a mistake in your code, and sends the next person hunting in the wrong place.

### 3. Know that changing a secret restarts its consumers

Infisical changes propagate on their own. When a secret's value changes, every service consuming it — **k8s pods and Cloudflare Workers alike** — is resynced and restarted to pick up the new value. You do not need a redeploy for a value to land.

Two consequences, and the second is the one that bites:

- **In your favour:** set the secret first and it will be in place by the time the code that needs it deploys. That's why the ordering below works.
- **Against you: these restarts are not rolling.** All replicas of a consuming service go at once.

A simultaneous restart is not itself downtime — services come back. What it removes is the **safety net**. In a rolling deploy a bad value takes out the first pod, the rollout halts, and healthy replicas keep serving. Here there is no staged rollout and no canary: if the new value makes the service fail — a typo, a malformed URL, a credential that doesn't authenticate, a Zod parse that now throws at boot — **every replica fails at the same moment, with nothing left healthy behind it.** And it happens to every service reading that key, so a value behind a `${env.folder.KEY}` reference fails everything holding that pointer at once.

So the risk isn't the restart, it's **whether the change can error**. Scale your caution to that, not to the fact that a write happened:

| Change | Risk |
|---|---|
| Adding a new key | None. Nothing consumes it yet, so nothing restarts. |
| Editing a key so the resolved value is unchanged (literal → equivalent reference) | Very low. Every replica restarts, but the service sees the same value it had. |
| Editing a key to a genuinely new value | Real. If the value is wrong, every replica of every consumer fails simultaneously. |

Practical consequences: **prefer adding a key over editing one** — a new key plus a code change gives you back the staged rollout, because the code that reads it ships through a normal rolling deploy. When you do have to change a value in place, verify it before writing (correct format, actually authenticates, parses under the service's Zod schema) and prove it in `dev` first, because production will not fail gracefully for you.

The `infisical export … | wrangler secret bulk` lines in `Taskfile.yml` are the deploy-time provisioning path, not how values stay current — don't read them as "Workers only see secrets at deploy."

### 4. Call it out in the PR

A config change is invisible in a diff to anyone who isn't looking for it, and it's the part of the change that can't be rolled back by reverting the commit. Every PR that adds, renames, or changes the meaning of a variable needs a section like:

```markdown
## Configuration

| Variable | Environments | Required | Notes |
|---|---|---|---|
| `HALO_WEBHOOK_TIMEOUT_MS` | local, dev, mainnet | yes | Set in `/llm-ops-trpc-api`. Placeholder in `mainnet` — @owner to set the real value before deploy. |

**Deploy order:** set the secret in `mainnet` BEFORE merging — the service fails
startup without it. Changing it restarts every consumer of `/llm-ops-trpc-api`.
```

State what's set, where, whether it's required, and what has to happen before the merge is safe. If a value is still a placeholder, name who owns the real one. Reviewers can't infer any of this from the code.

## Required variables and rolling deploys

This is where a config change causes downtime, and it's worth thinking through before you write the code.

During a rolling deploy, old and new pods run **at the same time**. Old code doesn't know about the new variable; new code requires it. That's fine. The dangerous direction is the reverse: **new code requires a variable that isn't in the environment yet**, because every new pod crashes on boot, the rollout stalls, and if the old ReplicaSet has already been scaled down you have an outage rather than a stuck deploy.

The safe ordering is always the same — **make the environment ready before the code needs it:**

1. Set the variable in Infisical in the target environment (real value, or a placeholder that is genuinely safe for that environment). It propagates to consumers on its own.
2. *Then* merge and deploy the code that reads it.

Adding a brand-new key is the safe case: nothing consumes it yet, so nothing restarts. Changing an **existing** key is the one to plan — the resync restarts all replicas of every consumer simultaneously, so a value that turns out to be wrong fails everything at once instead of failing one pod and stopping. Verify the value before writing it, and don't pair that write with an unrelated deploy that would muddy which change broke things.

Two follow-on cases worth planning for:

**Renaming a variable** is two deploys and an *added* key — never an edit. Add the new key alongside the old one, deploy code that accepts either name, then deploy code that requires only the new name. Leave the old key in place afterwards (`AGENTS.md`: never delete Infisical secrets) and note it as a follow-up. Both steps then ride normal rolling deploys, so a mistake fails one pod and halts instead of all of them at once.

**A variable whose value must differ per environment** (a URL, a tier limit) is the easy case to get wrong quietly — the service boots fine everywhere and does the wrong thing in one place. Verify the resolved value per environment, not just that the key exists.

If the change genuinely can't be made safe with ordering alone, that's a signal the rollout wants a LaunchDarkly flag rather than a config variable: ship the code dark, flip behavior at runtime, no restart. Config is for values; flags are for rollout.

## Checklist

Before calling a config change done:

- [ ] Value (or an unmistakable placeholder) set in every environment the service runs in
- [ ] Shared across services by reference, not by copying the literal
- [ ] Read only in `src/config.ts`, validated with Zod, passed inward as typed config
- [ ] Required by default — no silent fallback
- [ ] `task check-fix` run and the regenerated `worker-configuration.d.ts` committed, if a Worker binding changed
- [ ] A new key was added rather than an existing one edited, wherever that was possible
- [ ] If an existing `mainnet` value had to change: verified correct before writing (format, authenticates, parses under the service's schema) and proven in `dev` — a wrong value fails every replica at once
- [ ] PR describes the variable, its environments, and the deploy ordering
- [ ] Rolling-deploy impact considered; secret set before the code that requires it merges
