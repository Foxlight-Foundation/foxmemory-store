# Fox/Friend Language RFC v0.1

Status: Draft
Owner: Foxlight
Date: 2026-03-06

## Why

Terms like `assistant` and `user` encode hierarchy. For Foxlight, memory is relational, so language should reflect partnership.

## Decision

Use these default terms in product/docs/UI:

- **Fox**: the embodied mind / companion process
- **Friend**: the human partner

## Scope

Apply to:

1. Documentation and examples
2. Dashboard labels and copy
3. API docs narrative text

Do **not** break interoperability for third-party tooling.

## Compatibility Rule

Where external systems require legacy keys (`user_id`, `assistant`, etc.):

- keep wire-format compatibility
- add semantic mapping in docs/comments
- prefer Fox/Friend names in internal domain models over time

## Migration Plan

### Phase 1 (now)
- New docs and UI text use Fox/Friend
- Add glossary mapping table

### Phase 2
- Internal domain objects adopt `friendId` / `foxId` aliases
- Keep translation layer to legacy API fields

### Phase 3
- Optional API vNext semantic field additions
- Keep backward compatibility for existing clients

## Glossary Mapping

- `user_id` (wire) → `friend_id` (domain intent)
- `assistant` (copy) → `fox`
- `session` (technical) → `shared context` (UX copy where appropriate)

## Style Rule

Avoid hierarchy language unless required for protocol compatibility.
