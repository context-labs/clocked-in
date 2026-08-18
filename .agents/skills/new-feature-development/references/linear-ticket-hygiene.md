# Keeping a Linear ticket current

When the work is tied to a Linear ticket, the ticket is part of the deliverable.
A ticket that sits in `Todo` with no comments while the branch is half-built is
actively misleading: standups, cycle burndown, and anyone asking "who's on this?"
all read the ticket, not your terminal.

Use the **`linear`** skill for every read and write here — it owns the access
paths (Linear MCP tools when the session has them — the normal case on an
engineer's machine — otherwise the GraphQL helpers), auth, and the identity
callout. Do not hand-roll API calls.

## When this applies

The user handed you a ticket if any of these is true:

- they pasted an identifier (`INF-1234`, `LIN-42`) or a `linear.app/…/issue/…` URL
- they said "work on the ticket", "pick up <name>", or the branch name embeds one
- the plan folder is named after a ticket (`.ai-docs/plans/inf-1234-…/`)

If none is true, do **not** go create a ticket to have something to update. Ask
once whether the work should be tracked, and move on with the answer.

## The updates you owe

Do these as you reach each point in the work, not in a batch at the end.

1. **Starting** — move the issue to a `started`-type state and assign it to the
   user (or confirm it is already theirs). Post one comment stating what you are
   about to do: your understanding of the task, the branch name, and the plan
   doc path if there is one.
2. **Material findings** — comment when something changes the shape of the work:
   the root cause you proved, a design decision the plan didn't anticipate, a
   scope change, or a blocker you need the reporter to resolve. One substantive
   comment beats five progress pings.
3. **Ready for review** — when the PR is open, move the issue to the team's
   review state (`started` type, usually named "In Review" / "Ready for Review")
   and comment with the PR link plus a two-or-three-line summary of the change
   and how it was verified.
4. **Blocked or paused** — if you stop without finishing, say so on the ticket:
   what's done, what's left, what you're waiting on. Leave the state honest
   rather than parked in "In Progress" indefinitely.
5. **Done** — only after the change is actually merged and verified. Move to a
   `completed`-type state and comment with the merge commit / release. If you
   can't verify it landed, leave it in review and say why.

**Never mark a ticket `Done` on your own inference that the work "should be
fine."** Shipping is an observable event; wait for it or ask.

## Mechanics

States are per-team and renameable, so resolve them by `type`, never by a
hardcoded name:

```bash
# type: backlog | unstarted | started | completed | canceled
scripts/graphql.sh <<'JSON'
{"query": "query($id: String!) { issue(id: $id) { id identifier title url state { name type } assignee { name } team { id key states { nodes { id name type } } } } }",
 "variables": {"id": "INF-1234"}}
JSON
```

Pick the target state's `id` from that team's `states.nodes`, then
`issueUpdate(id, { stateId })`. A team commonly has more than one `started`
state ("In Progress", "In Review") — match on name *within* the `started` set,
and fall back to leaving the state alone and saying so in a comment if the team
has no review state. Comments go through `commentCreate` with markdown bodies;
`references/graphql.md` in the `linear` skill has the exact shapes.

Two things that bite:

- **Attribution.** If the `linear` skill reports
  `LINEAR_AUTH_ATTRIBUTION=quant`, tell the user before the first write — the
  updates will land under the `quant` app, not their name.
- **Don't narrate.** Ticket comments are for the reporter and the reviewer, not
  a transcript of your session. Skip "starting step 3 of 7"; post the decisions,
  the mechanism, the links.

## Anti-patterns

- Finishing a ticketed change with the issue still in `Todo`/`Backlog`.
- Opening the PR without moving the issue to review or linking the PR on it.
- Closing a ticket you haven't seen merge.
- Comment spam — a note per file edited, or restating the diff the PR already shows.
- Creating a duplicate ticket instead of updating the one you were given.
