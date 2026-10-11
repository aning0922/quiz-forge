#!/usr/bin/env bash
set -euo pipefail
umask 077
# Run from the independent repository/worktree root. No daemon setup or DB job.
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || { printf '%s\n' '{"outcome":"failed","code":"UNSUPPORTED_PLATFORM"}'; exit 1; }
[[ -f scripts/quizpack-media-preflight/linux/base.json && -f pnpm-lock.yaml ]] || exit 1
node --import tsx scripts/quizpack-media-preflight/linux/setup.mjs
node --import tsx scripts/quizpack-media-preflight/linux/harness.mjs
node --import tsx scripts/quizpack-media-preflight/linux/lifecycle-harness.mjs
