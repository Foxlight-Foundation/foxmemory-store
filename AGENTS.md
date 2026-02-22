# AGENTS.md

This is the **canonical automation guide** for this repository.

## Read order (required)
1. Read this `AGENTS.md` first.
2. Read `README.md` for product context.
3. Read `docs/*` relevant to the files you are changing.

All tool-specific instruction files (Claude/Codex/Copilot/Cursor) are thin pointers to this file.

## Core rules
- Keep changes small, testable, and documented.
- Preserve API/deploy contracts unless intentionally versioned.
- Update docs and tests whenever behavior changes.
- Never commit secrets.

## Repository-specific constraints

### foxmemory-infer
- Scope: inference only (stateless embeddings service).
- Do **not** add persistence/storage logic here.
- Keep `/health` and `/embed` stable.

### foxmemory-store
- Scope: memory write/search and persistence APIs.
- Do **not** add embedding inference logic here.
- Keep backend adapters replaceable.

### foxmemory-deploy
- Scope: reproducible deployment topology and runbooks.
- Keep one-node and split-mode examples current.
- Keep compose files explicit and copy/paste safe.

## PR checklist
- [ ] Scope boundaries respected
- [ ] Tests updated/passing
- [ ] Docs updated
- [ ] No secrets or local artifacts committed
