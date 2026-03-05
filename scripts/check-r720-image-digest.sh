#!/usr/bin/env bash
set -euo pipefail

SSH_TARGET="${SSH_TARGET:-r720-vm}"
CONTAINER="${CONTAINER:-foxmemory_v2-store-1}"
EXPECTED_DIGEST="${EXPECTED_DIGEST:-}"

echo "[info] ssh_target=${SSH_TARGET} container=${CONTAINER}"

digest=$(ssh "${SSH_TARGET}" "docker inspect --format='{{index .RepoDigests 0}}' '${CONTAINER}'" 2>/dev/null || true)
if [[ -z "${digest}" ]]; then
  echo "BLOCKED: unable to resolve repo digest for container '${CONTAINER}' on '${SSH_TARGET}'"
  echo "hint: ensure container name is correct and runtime has digest-pinned image metadata"
  exit 2
fi

echo "live_digest=${digest}"

if [[ -n "${EXPECTED_DIGEST}" ]]; then
  if [[ "${digest}" != *"${EXPECTED_DIGEST}"* ]]; then
    echo "FAIL: live digest does not match expected digest"
    echo "expected_contains=${EXPECTED_DIGEST}"
    exit 1
  fi
  echo "PASS: live digest matches expected digest"
fi
