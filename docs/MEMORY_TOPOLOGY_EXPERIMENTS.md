# Memory Topology Experiments (non-breaking)

Status: draft experiment plan (branch-only)

## Why
We currently model memory around `user_id` and optional `run_id`/session hints. That works for basic retrieval, but FoxMind needs richer continuity boundaries and explicit ownership semantics.

This document proposes branch-safe experiments without breaking `main`.

## Current ontology (today)
- `user_id`: primary principal in API writes/search.
- `run_id`: optional execution/thread context.
- `agent_id`: appears in vector filter plumbing but is not first-class in API payloads.

## Questions to answer
1. Does `user / agent / session` reflect real FoxMind usage?
2. Should we add a `scope` dimension (e.g., `private`, `shared`, `mission`, `ephemeral`)?
3. Should memory records have explicit `owner_type` + `owner_id` rather than overloading `user_id`?
4. Should retrieval default to scoped reads with explicit cross-scope opt-in?

## Proposed target shape (candidate)
Add non-breaking metadata envelope on writes:

```json
{
  "principal": { "type": "user|agent|org", "id": "..." },
  "context": {
    "session_id": "...",
    "channel": "webchat|telegram|...",
    "project": "foxmemory",
    "scope": "private|shared|mission|ephemeral"
  },
  "tags": ["identity", "task", "decision"]
}
```

Keep existing `user_id` behavior as compatibility mode.

## Experiment matrix

### E1: metadata-only scope
- Keep API unchanged.
- Store `scope` in metadata.
- Add optional filter param `scope` in search/list.
- Success: no breaking changes; scoped retrieval works.

### E2: principal envelope (alias mode)
- Accept `principal` in request body.
- Derive `user_id` fallback from `principal.id` when `principal.type=user`.
- Success: old clients work; new clients can express agent-owned memory.

### E3: retrieval precedence profiles
- `identity-first`: prioritize identity/mission tagged memories.
- `task-first`: prioritize active project/task facts.
- `session-first`: prioritize short-horizon continuity.
- Success: measurable improvement in answer coherence by profile.

## Guardrails
- No destructive schema migrations on `main`.
- Branch-only experiments behind feature flags.
- Keep `/v1/memories` contract compatible until cutover plan is approved.

## Initial implementation sketch
1. Add optional `scope` and `tags` fields to write/search payloads.
2. Persist to metadata and pass through vector filters.
3. Add tests for default behavior parity.
4. Add integration smoke for each scope mode.

## Open mem0 compatibility notes
mem0 OSS is flexible via metadata and filters, but not opinionated on ontology. We can layer our own principal/scope semantics without forking core behavior immediately.

---
Owner: Kite (experiment branch)
