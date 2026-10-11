#!/usr/bin/env bash
# CI-only disposable service. Never connect to a developer's existing database.
set +x
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || ! -d "${RUNNER_TEMP:-}" ]]; then
  printf '%s\n' 'P2A_CI_ENVIRONMENT_REQUIRED' >&2
  exit 1
fi
umask 077
ci_service_dir=$(mktemp -d "$RUNNER_TEMP/quizforge-p2a-ci.XXXXXXXX")
ci_service_id=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')
ci_service_container=''
cleanup() {
  local original_status=$?
  trap - EXIT INT TERM
  if [[ -f "$ci_service_dir/container-id" ]]; then
    if ci_service_container=$(cat "$ci_service_dir/container-id") &&
       [[ "$ci_service_container" =~ ^[a-f0-9]{64}$ ]] &&
       [[ "$(docker inspect --format '{{ index .Config.Labels "quizforge.p2a.ci" }}' "$ci_service_container" 2>/dev/null)" == "$ci_service_id" ]]; then
      if ! docker rm --force --volumes "$ci_service_container" >/dev/null 2>&1; then
        printf '%s\n' 'P2A_CI_CLEANUP_FAILED' >&2
        original_status=1
      fi
    else
      # Unknown identity is not permission to delete, nor proof of successful cleanup.
      printf '%s\n' 'P2A_CI_CLEANUP_IDENTITY_UNVERIFIED' >&2
      original_status=1
    fi
  fi
  rm -f "$ci_service_dir/password" "$ci_service_dir/bootstrap.json" "$ci_service_dir/container-id"
  rmdir "$ci_service_dir" || original_status=1
  exit "$original_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

QUIZFORGE_P2A_CI_PASSWORD=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')
# Register masking before any subprocess receives the secret. Docker argv contains only its file path.
printf '::add-mask::%s\n' "$QUIZFORGE_P2A_CI_PASSWORD"
printf '%s' "$QUIZFORGE_P2A_CI_PASSWORD" > "$ci_service_dir/password"
docker run --detach --cidfile "$ci_service_dir/container-id" \
  --label "quizforge.p2a.ci=$ci_service_id" \
  --publish 127.0.0.1::5432 \
  --mount "type=bind,source=$ci_service_dir/password,target=/run/secrets/pg-password,readonly" \
  --env POSTGRES_PASSWORD_FILE=/run/secrets/pg-password \
  --env POSTGRES_USER=postgres --env POSTGRES_DB=postgres \
  --env POSTGRES_HOST_AUTH_METHOD=scram-sha-256 \
  --health-cmd 'pg_isready -U postgres -d postgres' \
  --health-interval 2s --health-timeout 3s --health-retries 30 \
  postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636 \
  >/dev/null
ci_service_container=$(cat "$ci_service_dir/container-id")
ci_service_healthy=false
for attempt in {1..60}; do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$ci_service_container")" == healthy ]]; then
    ci_service_healthy=true
    break
  fi
  sleep 2
done
if [[ "$ci_service_healthy" != true ]]; then
  printf '%s\n' 'P2A_CI_DATABASE_UNHEALTHY' >&2
  exit 1
fi
ci_service_endpoint=$(docker port "$ci_service_container" 5432/tcp)
if [[ ! "$ci_service_endpoint" =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
  printf '%s\n' 'P2A_CI_PORT_MAPPING_INVALID' >&2
  exit 1
fi
export QUIZFORGE_P2A_CI_HOST=127.0.0.1
export QUIZFORGE_P2A_CI_PORT="${BASH_REMATCH[1]}"
export QUIZFORGE_P2A_CI_USER=postgres
export QUIZFORGE_P2A_CI_DATABASE=postgres
export QUIZFORGE_P2A_CI_PASSWORD
pnpm --silent p2a:db:ci > "$ci_service_dir/bootstrap.json"
QUIZFORGE_P2A_CONFIG=$(node -e '
  const receipt = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (typeof receipt.runtimeConfigPath !== "string" || !receipt.runtimeConfigPath.startsWith(process.cwd() + "/.cache/p2a/")) process.exit(1);
  process.stdout.write(receipt.runtimeConfigPath);
' "$ci_service_dir/bootstrap.json")
export QUIZFORGE_P2A_CONFIG
QF_DRIVER_TEST_INSTANCE=$(node -e '
  const receipt = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (typeof receipt.instanceId !== "string" || !/^[a-f0-9]{32}$/.test(receipt.instanceId)) process.exit(1);
  process.stdout.write(receipt.instanceId);
' "$ci_service_dir/bootstrap.json")
export QF_DRIVER_TEST_INSTANCE
unset QUIZFORGE_P2A_CI_PASSWORD
pnpm test:db
pnpm test:driver
