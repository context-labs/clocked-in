import { expect, test } from "bun:test";
import { resolveEvent } from "./hook.ts";

const NOW = 1234;

test("snake_case (Claude/Codex) stdin", () => {
  const e = resolveEvent("start", { agent: "codex" }, { session_id: "abc", cwd: "/p" }, {}, NOW);
  expect(e).toEqual({ ts: NOW, kind: "start", agent: "codex", session: "abc", cwd: "/p" });
});

test("camelCase (Grok) stdin", () => {
  const e = resolveEvent("stop", { agent: "grok" }, { sessionId: "g1" }, {}, NOW);
  expect(e).toMatchObject({ kind: "stop", agent: "grok", session: "g1" });
});

test("env fallback for session", () => {
  const e = resolveEvent("start", {}, {}, { GROK_SESSION_ID: "envses" }, NOW);
  expect(e.session).toBe("envses");
});

test("explicit flag beats stdin", () => {
  expect(resolveEvent("start", { session: "flag" }, { session_id: "std" }, {}, NOW).session).toBe(
    "flag",
  );
});

test("empty everything → sane defaults", () => {
  const e = resolveEvent("start", {}, {}, {}, NOW);
  expect(e).toMatchObject({ agent: "claude-code", session: "unknown" });
});
