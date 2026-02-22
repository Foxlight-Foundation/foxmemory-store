# Agent Instructions (foxmemory-store)

## Priority
1. Keep API contract stable.
2. Keep infer/store separation strict.
3. Ensure deterministic tests for search/write behavior.

## Coding rules
- No embedding inference logic here.
- Keep backend adapters replaceable.
- Document any schema changes.
