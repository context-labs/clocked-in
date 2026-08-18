import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENTS, type Agent } from "./events.ts";

// Identify our hook commands for idempotent re-install and clean uninstall —
// WITHOUT matching a user's own hook that merely mentions `--agent <name>`.
// A command is ours only if it invokes one of our entrypoints AND targets one of
// our agents. Entrypoints cover every form we've ever written: the current fast
// bin (`clocked-in-hook`, `hook-cli.ts/js`) and legacy ones (`clocked-in hook`,
// `cli.tsx/js hook`). Derived from AGENTS so the agent list can't drift.
const OUR_ENTRY = /clocked-in-hook|hook-cli\.[tj]s|clocked-in hook|cli\.[tj]sx? hook/;
const OUR_AGENT = new RegExp(`--agent (?:${AGENTS.join("|")})\\b`);
const isOurCommand = (c: string) => OUR_ENTRY.test(c) && OUR_AGENT.test(c);

export type AgentInstaller = {
  name: Agent;
  /** File we create/modify, for display. */
  path: (home: string) => string;
  /** Is this agent present on the machine? */
  detected: (home: string) => boolean;
  /** Idempotent: installing twice leaves exactly one set of hooks. */
  install: (base: string, home: string) => void;
  /** Remove only our entries; preserve everything else. */
  uninstall: (home: string) => void;
  /** Written from docs, not runtime-verified on a real install. */
  unverified?: boolean;
};

type CliKind = "start" | "stop" | "tool-start" | "tool-end";
const cmd = (base: string, kind: CliKind, agent: Agent) => `${base} ${kind} --agent ${agent}`;

function readJson(file: string): Record<string, any> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

type HookEntry = { hooks: { type: string; command: string }[] };
const isOurs = (e: HookEntry) =>
  e.hooks?.some((h) => typeof h.command === "string" && isOurCommand(h.command));

// Claude Code / Codex / Grok event names ↔ our CLI kinds.
const JSON_EVENTS: [string, CliKind][] = [
  ["UserPromptSubmit", "start"],
  ["Stop", "stop"],
  ["PreToolUse", "tool-start"],
  ["PostToolUse", "tool-end"],
];

// --- JSON-merge agents (Claude Code, Codex): a JSON file with a `.hooks` map ---
function mergeJsonHooks(file: string, base: string, agent: Agent): void {
  const data = readJson(file);
  const hooks = (data.hooks ??= {});
  for (const [event, kind] of JSON_EVENTS) {
    const arr: HookEntry[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    const others = arr.filter((e) => !isOurs(e)); // drop our old entry -> idempotent
    others.push({ hooks: [{ type: "command", command: cmd(base, kind, agent) }] });
    hooks[event] = others;
  }
  writeJson(file, data);
}

function unmergeJsonHooks(file: string): void {
  if (!existsSync(file)) return;
  const data = readJson(file);
  if (!data.hooks) return;
  for (const event of Object.keys(data.hooks)) {
    if (!Array.isArray(data.hooks[event])) continue;
    data.hooks[event] = data.hooks[event].filter((e: HookEntry) => !isOurs(e));
    if (data.hooks[event].length === 0) delete data.hooks[event];
  }
  if (Object.keys(data.hooks).length === 0) delete data.hooks;
  writeJson(file, data);
}

// --- own-file agents (Grok): a dedicated JSON file we fully own ---
function grokConfig(base: string): unknown {
  const hooks: Record<string, unknown> = {};
  for (const [event, kind] of JSON_EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: cmd(base, kind, "grok") }] }];
  }
  return { hooks };
}

// --- Cursor (desktop IDE + cursor-agent CLI): ~/.cursor/hooks.json ---
// Distinct shape from Claude: top-level `version`, events beforeSubmitPrompt/stop,
// and entries are bare { command } objects (no nested hooks array).
type CursorEntry = { command: string };
function mergeCursorHooks(file: string, base: string): void {
  const data = readJson(file);
  data.version ??= 1;
  const hooks = (data.hooks ??= {});
  for (const [event, kind] of [
    ["beforeSubmitPrompt", "start"],
    ["stop", "stop"],
    ["preToolUse", "tool-start"],
    ["postToolUse", "tool-end"],
  ] as const) {
    const arr: CursorEntry[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    const others = arr.filter((e) => !(typeof e.command === "string" && isOurCommand(e.command)));
    others.push({ command: cmd(base, kind, "cursor") });
    hooks[event] = others;
  }
  writeJson(file, data);
}

function unmergeCursorHooks(file: string): void {
  if (!existsSync(file)) return;
  const data = readJson(file);
  if (!data.hooks) return;
  for (const event of Object.keys(data.hooks)) {
    if (!Array.isArray(data.hooks[event])) continue;
    data.hooks[event] = data.hooks[event].filter(
      (e: CursorEntry) => !(typeof e.command === "string" && isOurCommand(e.command)),
    );
    if (data.hooks[event].length === 0) delete data.hooks[event];
  }
  writeJson(file, data);
}

// --- plugin-module agents (opencode, pi): a TS file that shells out ---
function opencodePlugin(base: string): string {
  return `// clocked-in — auto-generated. Records how long you wait for opencode,
// including per-tool time. Delete this file or run \`clocked-in uninstall\` to remove.
export const ClockedIn = async ({ $ }) => {
  const run = (...a) => $\`${base} \${a}\`.quiet().nothrow();
  return {
    event: async ({ event }) => {
      if (event.type === "message.updated" && event.properties?.info?.role === "user")
        await run("start", "--agent", "opencode", "--session", event.properties.info.sessionID || "unknown");
      else if (event.type === "session.idle")
        await run("stop", "--agent", "opencode", "--session", event.properties?.sessionID || "unknown");
    },
    "tool.execute.before": async (input) =>
      run("tool-start", "--agent", "opencode", "--session", input.sessionID || "unknown", "--tool", input.tool || "unknown", "--tool-id", input.callID || ""),
    "tool.execute.after": async (input) =>
      run("tool-end", "--agent", "opencode", "--session", input.sessionID || "unknown", "--tool", input.tool || "unknown", "--tool-id", input.callID || ""),
  };
};
`;
}

function piExtension(base: string): string {
  return `// clocked-in — auto-generated pi extension. Records how long you wait for pi.
// NOTE: written from pi's docs, not runtime-verified — adjust event names if pi differs.
// Delete this file or run \`clocked-in uninstall\` to remove.
import { $ } from "bun";
const run = (...a) => $\`${base} \${a}\`.quiet().nothrow();
export default {
  events: {
    "prompt.submit": ({ sessionId }) => run("start", "--agent", "pi", "--session", sessionId || "unknown"),
    "turn.end":      ({ sessionId }) => run("stop", "--agent", "pi", "--session", sessionId || "unknown"),
    "tool.before":   ({ sessionId, tool, callId }) => run("tool-start", "--agent", "pi", "--session", sessionId || "unknown", "--tool", tool || "unknown", "--tool-id", callId || ""),
    "tool.after":    ({ sessionId, tool, callId }) => run("tool-end", "--agent", "pi", "--session", sessionId || "unknown", "--tool", tool || "unknown", "--tool-id", callId || ""),
  },
};
`;
}

function writeOwnFile(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function removeFile(file: string): void {
  if (existsSync(file)) rmSync(file);
}

export const INSTALLERS: AgentInstaller[] = [
  {
    name: "claude-code",
    path: (h) => join(h, ".claude", "settings.json"),
    detected: (h) => existsSync(join(h, ".claude")),
    install: (base, h) => mergeJsonHooks(join(h, ".claude", "settings.json"), base, "claude-code"),
    uninstall: (h) => unmergeJsonHooks(join(h, ".claude", "settings.json")),
  },
  {
    name: "codex",
    path: (h) => join(h, ".codex", "hooks.json"),
    detected: (h) => existsSync(join(h, ".codex")),
    install: (base, h) => mergeJsonHooks(join(h, ".codex", "hooks.json"), base, "codex"),
    uninstall: (h) => unmergeJsonHooks(join(h, ".codex", "hooks.json")),
  },
  {
    name: "grok",
    path: (h) => join(h, ".grok", "hooks", "clocked-in.json"),
    detected: (h) => existsSync(join(h, ".grok")),
    install: (base, h) => writeJson(join(h, ".grok", "hooks", "clocked-in.json"), grokConfig(base)),
    uninstall: (h) => removeFile(join(h, ".grok", "hooks", "clocked-in.json")),
  },
  {
    name: "cursor",
    path: (h) => join(h, ".cursor", "hooks.json"),
    detected: (h) => existsSync(join(h, ".cursor")),
    install: (base, h) => mergeCursorHooks(join(h, ".cursor", "hooks.json"), base),
    uninstall: (h) => unmergeCursorHooks(join(h, ".cursor", "hooks.json")),
  },
  {
    name: "opencode",
    path: (h) => join(h, ".config", "opencode", "plugin", "clocked-in.ts"),
    detected: (h) => existsSync(join(h, ".config", "opencode")),
    install: (base, h) =>
      writeOwnFile(join(h, ".config", "opencode", "plugin", "clocked-in.ts"), opencodePlugin(base)),
    uninstall: (h) => removeFile(join(h, ".config", "opencode", "plugin", "clocked-in.ts")),
  },
  {
    name: "pi",
    path: (h) => join(h, ".config", "pi", "extensions", "clocked-in.ts"),
    detected: (h) => existsSync(join(h, ".config", "pi")) || existsSync(join(h, ".pi")),
    install: (base, h) =>
      writeOwnFile(join(h, ".config", "pi", "extensions", "clocked-in.ts"), piExtension(base)),
    uninstall: (h) => removeFile(join(h, ".config", "pi", "extensions", "clocked-in.ts")),
    unverified: true,
  },
];

export function installerFor(name: string): AgentInstaller | undefined {
  return INSTALLERS.find((a) => a.name === name);
}

export { AGENTS };
export type { Agent };
