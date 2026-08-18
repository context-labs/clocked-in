import { readFileSync } from "node:fs";
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

export type Meta = { model?: string; effort?: string };

/**
 * Pure: turn a hook's inputs into an Event. Robust to every agent's shape —
 * Claude/Codex send snake_case (`session_id`), Grok sends camelCase
 * (`sessionId`) plus env vars. `meta` carries transcript-derived model/effort.
 * Precedence for model/effort: explicit stdin field > meta (transcript).
 */
export function resolveEvent(
  kind: Kind,
  opts: { agent?: string; session?: string },
  input: Record<string, unknown>,
  env: Record<string, string | undefined>,
  now: number,
  meta: Meta = {},
): Event {
  return {
    ts: now,
    kind,
    agent: opts.agent || str(input.agent) || "claude-code",
    session:
      opts.session ||
      str(input.session_id) ||
      str(input.sessionId) ||
      str(input.conversation_id) || // Cursor
      env.CLAUDE_SESSION_ID ||
      env.GROK_SESSION_ID ||
      env.CODEX_SESSION_ID ||
      "unknown",
    cwd: str(input.cwd) || str((input.workspace_roots as string[] | undefined)?.[0]) || env.PWD,
    model:
      str(input.model) ||
      str(input.model_slug) ||
      str(input.modelId) ||
      str(input.model_id) ||
      meta.model,
    effort:
      str(input.reasoning_effort) || str(input.effort) || str(input.reasoningEffort) || meta.effort,
  };
}

/**
 * Pure: extract the last turn's model + reasoning effort from a transcript's
 * JSONL lines. Works across harnesses that log `message.model` / `model` and
 * `effort` / `reasoning_effort` per assistant record (Claude Code does both).
 */
export function metaFromTranscript(lines: string[]): Meta {
  const meta: Meta = {};
  for (const line of lines) {
    if (!line) continue;
    try {
      const o = JSON.parse(line) as Record<string, any>;
      const model = o.message?.model ?? o.model ?? o.model_slug;
      const effort = o.effort ?? o.reasoning_effort ?? o.message?.effort;
      if (typeof model === "string" && model) meta.model = model; // last wins
      if (typeof effort === "string" && effort) meta.effort = effort;
    } catch {
      // skip non-JSON lines
    }
  }
  return meta;
}

// Read model/effort from a transcript file, bounded to the tail so a huge
// transcript doesn't stall the hook. Best-effort; returns {} on any failure.
function readTranscript(path: string | undefined): Meta {
  if (!path) return {};
  try {
    const buf = readFileSync(path);
    const tail = buf.length > 512_000 ? buf.subarray(buf.length - 512_000) : buf; // ponytail: 512KB tail is plenty for the last turn
    return metaFromTranscript(tail.toString("utf8").split("\n"));
  } catch {
    return {};
  }
}

// A hook must never disrupt the agent, so this always resolves and swallows errors.
export async function runHook(
  kind: Kind,
  opts: { agent?: string; session?: string },
): Promise<void> {
  try {
    const input = await readStdin();
    // Only the stop hook can know the model/effort — the turn has finished by then.
    const meta =
      kind === KIND.stop
        ? readTranscript(str(input.transcript_path) || str(input.transcriptPath))
        : {};
    insertEvent(resolveEvent(kind, opts, input, process.env, Date.now(), meta));
  } catch {
    // best-effort
  }
}

export const HOOK_KINDS = KIND;
