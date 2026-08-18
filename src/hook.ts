import { insertEvent } from "./db.ts";
import { KIND, type Event, type Kind } from "./events.ts";

// Read stdin JSON if the agent piped any. Never throws, never hangs on a TTY.
async function readStdin(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  try {
    const text = await Bun.stdin.text();
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/**
 * Pure: turn a hook's inputs into an Event. Robust to every agent's shape —
 * Claude/Codex send snake_case (`session_id`), Grok sends camelCase
 * (`sessionId`) plus env vars. Precedence: explicit flag > stdin > env > default.
 */
export function resolveEvent(
  kind: Kind,
  opts: { agent?: string; session?: string },
  input: Record<string, unknown>,
  env: Record<string, string | undefined>,
  now: number,
): Event {
  return {
    ts: now,
    kind,
    agent: opts.agent || str(input.agent) || "claude-code",
    session:
      opts.session ||
      str(input.session_id) ||
      str(input.sessionId) ||
      env.CLAUDE_SESSION_ID ||
      env.GROK_SESSION_ID ||
      env.CODEX_SESSION_ID ||
      "unknown",
    cwd: str(input.cwd) || env.PWD,
  };
}

// A hook must never disrupt the agent, so this always resolves and swallows errors.
export async function runHook(
  kind: Kind,
  opts: { agent?: string; session?: string },
): Promise<void> {
  try {
    const input = await readStdin();
    insertEvent(resolveEvent(kind, opts, input, process.env, Date.now()));
  } catch {
    // best-effort
  }
}

export const HOOK_KINDS = KIND;
