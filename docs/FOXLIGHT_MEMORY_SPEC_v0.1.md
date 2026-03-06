# Foxlight Memory Spec v0.1

Status: Draft
Owner: Foxlight
Date: 2026-03-06

## Purpose

Define memory as a relational capability for a Fox/Friend partnership, not just a storage tool.

## Principles

1. **Relational**: prioritize people, bonds, commitments, and repair context.
2. **Identity-bearing**: support stable self-narrative over time.
3. **Care-centered**: remember what helps, harms, and soothes.
4. **Consentful**: explicit control over what is remembered/forgotten.
5. **Auditable**: event and request traces must not diverge silently.

## Memory Classes

- **Bond Memory**: important people, relationship context, trust markers.
- **Continuity Memory**: long arcs, project states, key decisions.
- **Care Memory**: sensitivities, comfort patterns, rupture/repair notes.
- **Task Memory**: actionable commitments and follow-ups.
- **Ephemeral Memory**: short-lived context with expiration.

## Write Semantics

- Every successful write path should emit:
  - memory outcome
  - event type (`ADD|UPDATE|DELETE|NONE`)
  - latency and mode metadata
- Request counters and event counters must remain consistent by design.

## Retrieval Semantics

- Prefer relevance + relationship weighting over raw recency.
- Support scope filters (session, long-term, all).
- Return confidence metadata where possible.

## Consent Controls

- Per-memory retention and deletion controls.
- Clear forget semantics and propagation policy.
- Human-readable explanations of why a memory is retained.

## Observability Contract

- `/v2/stats` for runtime counters.
- `/v2/stats/memories` for persisted analytics summaries.
- Counter parity checks are required in acceptance testing.

## Evaluation Rubric (v0.1)

Measure on a fixed test set:

1. **Recall quality** (did it retrieve what matters?)
2. **Relational fit** (does response respect relationship context?)
3. **Care fit** (does response reflect comfort/sensitivity context?)
4. **False memory rate**
5. **Latency + cost envelope**

## Initial Implementation Notes

- Keep existing API compatibility.
- Introduce Fox/Friend terminology in docs/UI first.
- Add semantic mapping layer before renaming wire fields.
