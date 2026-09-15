#!/bin/sh
# Container entrypoint.
#
# The image, not the deployment, pins how much heap each Node process may take:
# a job that exceeds its ceiling has to die inside its own process group rather
# than push the container into the OOM killer. The value is only passed through
# when it is plausibly a number, so a typo produces the service's own
# configuration error instead of a confusing Node failure.
#
# Everything else here is a fail-fast check of the writable volumes the run
# command mounts. The service would fail on the same paths a moment later, but
# with a stack trace instead of a sentence.
set -eu

heap="${AZEWEB_NODE_HEAP_MB:-}"
case "$heap" in
  '' | *[!0-9]*) ;;
  *) export NODE_OPTIONS="--max-old-space-size=$heap ${NODE_OPTIONS:-}" ;;
esac

scratch="${AZEWEB_SCRATCH_DIR:-/scratch}"
if ! mkdir -p "$scratch"; then
  echo "azeweb: ${scratch} is not writable; mount the scratch tmpfs there (README.md, Deployment)." >&2
  exit 1
fi
if ! mkdir -p "${TMPDIR:-/tmp}/azeweb-entrypoint-check" 2>/dev/null; then
  echo "azeweb: ${TMPDIR:-/tmp} is not writable; mount a small tmpfs there (README.md, Deployment)." >&2
  exit 1
fi
rmdir "${TMPDIR:-/tmp}/azeweb-entrypoint-check"

exec node /app/src/service/main.mjs "$@"
