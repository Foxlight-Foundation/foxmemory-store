# Health Version Rollout (R720)

## Goal
Expose immutable runtime build identity at `GET /health.version` so replay/readiness gates are authoritative.

## Why this matters
- Without runtime identity, idempotency/replay smoke results are **unattributed**.
- Provenance-first checks avoid false confidence from testing an unknown build.

## Preconditions
- `foxmemory-store` image built from commit containing `/health.version` chain:
  - `HEALTH_VERSION`
  - `SERVICE_VERSION`
  - `IMAGE_DIGEST`
  - `GIT_SHA`
- R720 SSH access available (`SSH_TARGET=r720-vm` or equivalent).

## Rollout steps
1. Build and tag image from current `foxmemory-store` main.
2. Push image to registry with immutable tag or digest.
3. Update R720 deployment to use that immutable image reference.
4. Recreate container on R720.
5. Verify:
   - `curl -fsS http://<r720-host>:8082/health.version | jq .`
   - `curl -fsS http://<r720-host>:8082/health.version | jq -e '.version and .build and .build.imageDigest' >/dev/null`
   - `bash scripts/check-r720-image-digest.sh` (from workspace with `SSH_TARGET` set)
6. Run replay readiness gate:
   - `BASE_URL=http://<r720-host>:8082 SSH_TARGET=<r720-ssh> bash scripts/gate-v2-replay-readiness.sh`

## Exit criteria
- `/health.version` returns non-empty version identity.
- Digest check is no longer `BLOCKED`.
- Replay gate produces authoritative `PASS` or actionable `BLOCKED` tied to known build identity.
