import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAgents, uninstallAgents } from "./install.ts";

let home: string;
beforeEach(() => (home = mkdtempSync(join(tmpdir(), "clocked-home-"))));
afterEach(() => rmSync(home, { recursive: true, force: true }));

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

test("claude-code: merges hooks, preserves existing config, idempotent, clean uninstall", () => {
  const settings = join(home, ".claude", "settings.json");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(
    settings,
    JSON.stringify({
      model: "opus",
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "my-own-thing" }] }] },
    }),
  );

  installAgents(["claude-code"], { home });
  let cfg = readJson(settings);
  expect(cfg.model).toBe("opus"); // untouched
  expect(cfg.hooks.UserPromptSubmit).toHaveLength(2); // user's + ours
  expect(cfg.hooks.Stop).toHaveLength(1);
  expect(JSON.stringify(cfg)).toContain("clocked-in hook start --agent claude-code");

  installAgents(["claude-code"], { home }); // idempotent
  cfg = readJson(settings);
  expect(cfg.hooks.UserPromptSubmit).toHaveLength(2);

  uninstallAgents(["claude-code"], { home });
  cfg = readJson(settings);
  expect(cfg.model).toBe("opus");
  expect(cfg.hooks.UserPromptSubmit).toEqual([
    { hooks: [{ type: "command", command: "my-own-thing" }] },
  ]);
  expect(cfg.hooks.Stop).toBeUndefined(); // our-only array removed
  expect(JSON.stringify(cfg)).not.toContain("clocked-in");
});

test("grok: writes own file, uninstall deletes it", () => {
  mkdirSync(join(home, ".grok"), { recursive: true });
  const file = join(home, ".grok", "hooks", "clocked-in.json");
  installAgents(["grok"], { home });
  expect(readJson(file).hooks.Stop[0].hooks[0].command).toContain("--agent grok");
  uninstallAgents(["grok"], { home });
  expect(existsSync(file)).toBe(false);
});

test("cursor: version + beforeSubmitPrompt/stop entries, clean uninstall", () => {
  mkdirSync(join(home, ".cursor"), { recursive: true });
  const file = join(home, ".cursor", "hooks.json");
  writeFileSync(
    file,
    JSON.stringify({ version: 1, hooks: { stop: [{ command: "user-audit.sh" }] } }),
  );

  installAgents(["cursor"], { home });
  let cfg = readJson(file);
  expect(cfg.version).toBe(1);
  expect(cfg.hooks.beforeSubmitPrompt[0].command).toContain("hook start --agent cursor");
  expect(cfg.hooks.stop).toHaveLength(2); // user's + ours
  expect(cfg.hooks.stop.map((e: { command: string }) => e.command)).toContain("user-audit.sh");

  installAgents(["cursor"], { home }); // idempotent
  cfg = readJson(file);
  expect(cfg.hooks.stop).toHaveLength(2);

  uninstallAgents(["cursor"], { home });
  cfg = readJson(file);
  expect(cfg.hooks.beforeSubmitPrompt).toBeUndefined();
  expect(cfg.hooks.stop).toEqual([{ command: "user-audit.sh" }]);
  expect(JSON.stringify(cfg)).not.toContain("clocked-in");
});

test("--all only touches detected agents", () => {
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  const results = installAgents([], { all: true, home });
  expect(results.map((r) => r.name).sort()).toEqual(["claude-code", "codex"]);
});

test("uninstall removes --local (bun path) hooks too — regression", () => {
  mkdirSync(join(home, ".claude"), { recursive: true });
  installAgents(["claude-code"], { home, local: true });
  uninstallAgents(["claude-code"], { home });
  const cfg = readJson(join(home, ".claude", "settings.json"));
  expect(JSON.stringify(cfg)).not.toContain("cli.tsx hook");
});

test("--local embeds absolute bun + script paths instead of the global bin", () => {
  mkdirSync(join(home, ".grok"), { recursive: true });
  installAgents(["grok"], { home, local: true });
  const cmd = readJson(join(home, ".grok", "hooks", "clocked-in.json")).hooks.UserPromptSubmit[0]
    .hooks[0].command;
  expect(cmd).toMatch(/^\/.*bun .*cli\.tsx hook start/); // absolute bun path, absolute script
});
