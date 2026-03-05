#!/usr/bin/env bash
set -euo pipefail

SSH_TARGET="${SSH_TARGET:-r720-vm}"
CONTAINER="${CONTAINER:-}"
EXPECTED_DIGEST="${EXPECTED_DIGEST:-}"

if [[ -z "${CONTAINER}" ]]; then
  CONTAINER=$(ssh "${SSH_TARGET}" "docker ps --format '{{.Names}}' | egrep 'foxmemory.*store|store' | head -n1" 2>/dev/null || true)
fi

if [[ -z "${CONTAINER}" ]]; then
  echo "BLOCKED: could not auto-detect foxmemory store container on '${SSH_TARGET}'"
  echo "hint: set CONTAINER=<name> explicitly"
  exit 2
fi

echo "[info] ssh_target=${SSH_TARGET} container=${CONTAINER}"

inspect=$(ssh "${SSH_TARGET}" "docker inspect --format='{{index .RepoDigests 0}}|{{.Image}}' '${CONTAINER}'" 2>/dev/null || true)
if [[ -z "${inspect}" || "${inspect}" == "${CONTAINER}" ]]; then
  echo "BLOCKED: container '${CONTAINER}' not found on '${SSH_TARGET}'"
  exit 2
fi

digest="${inspect%%|*}"
image_id="${inspect#*|}"
if [[ -z "${digest}" || "${digest}" == "<no value>" ]]; then
  echo "BLOCKED: no repo digest for container '${CONTAINER}' on '${SSH_TARGET}'"
  echo "hint: container appears tag-based; redeploy with digest-pinned image for provenance certainty"
  if [[ -n "${image_id}" && "${image_id}" != "${inspect}" ]]; then
    echo "live_image_id=${image_id}"
  fi
  exit 2
fi

echo "live_digest=${digest}"
if [[ -n "${image_id}" && "${image_id}" != "${inspect}" ]]; then
  echo "live_image_id=${image_id}"
fi

if [[ -n "${EXPECTED_DIGEST}" ]]; then
  if [[ "${digest}" != *"${EXPECTED_DIGEST}"* ]]; then
    echo "FAIL: live digest does not match expected digest"
    echo "expected_contains=${EXPECTED_DIGEST}"
    exit 1
  fi
  echo "PASS: live digest matches expected digest"
fi
