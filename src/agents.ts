import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENTS, type Agent } from "./events.ts";

// Our hook commands match this signature in both forms — global (`clocked-in
// hook …`) and `--local` (`bun /path/cli.tsx hook …`). Uninstall uses it to find
// and remove only our entries without touching the user's own hooks.
const OUR_CMD = /\bhook (?:start|stop) --agent (?:claude-code|codex|grok|opencode|pi)\b/;

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

const cmd = (base: string, kind: "start" | "stop", agent: Agent) =>
  `${base} hook ${kind} --agent ${agent}`;

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
  e.hooks?.some((h) => typeof h.command === "string" && OUR_CMD.test(h.command));

// --- JSON-merge agents (Claude Code, Codex): a JSON file with a `.hooks` map ---
function mergeJsonHooks(file: string, base: string, agent: Agent): void {
  const data = readJson(file);
  const hooks = (data.hooks ??= {});
  for (const [event, kind] of [
    ["UserPromptSubmit", "start"],
    ["Stop", "stop"],
  ] as const) {
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
  return {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd(base, "start", "grok") }] }],
      Stop: [{ hooks: [{ type: "command", command: cmd(base, "stop", "grok") }] }],
    },
  };
}

// --- plugin-module agents (opencode, pi): a TS file that shells out ---
function opencodePlugin(base: string): string {
  return `// clocked-in — auto-generated. Records how long you wait for opencode.
// Delete this file or run \`clocked-in uninstall\` to remove.
export const ClockedIn = async ({ $ }) => ({
  event: async ({ event }) => {
    const hook = (kind, id) => $\`${base} hook \${kind} --agent opencode --session \${id || "unknown"}\`.quiet().nothrow();
    if (event.type === "message.updated" && event.properties?.info?.role === "user") {
      await hook("start", event.properties.info.sessionID);
    } else if (event.type === "session.idle") {
      await hook("stop", event.properties?.sessionID);
    }
  },
});
`;
}

function piExtension(base: string): string {
  return `// clocked-in — auto-generated pi extension. Records how long you wait for pi.
// NOTE: written from pi's docs, not runtime-verified — adjust event names if pi differs.
// Delete this file or run \`clocked-in uninstall\` to remove.
import { $ } from "bun";
export default {
  events: {
    "prompt.submit": ({ sessionId }) => $\`${base} hook start --agent pi --session \${sessionId || "unknown"}\`.quiet().nothrow(),
    "turn.end":      ({ sessionId }) => $\`${base} hook stop --agent pi --session \${sessionId || "unknown"}\`.quiet().nothrow(),
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
    name: "opencode",
    path: (h) => join(h, ".config", "opencode", "plugin", "clocked-in.ts"),
    detected: (h) => existsSync(join(h, ".config", "opencode")),
    install: (base, h) =>
      writeOwnFile(join(h, ".config", "opencode", "plugin", "clocked-in.ts"), opencodePlugin(base)),
    uninstall: (h) => removeFile(join(h, ".config", "opencode", "plugin", "clocked-in.ts")),
    unverified: true,
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
