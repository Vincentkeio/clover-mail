#!/usr/bin/env bash
# Real Docker smoke test, run on the disposable CI runner, not a live mail host.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
image="clover-install-cleanup-test:$(basename "$scratch" | tr '[:upper:]' '[:lower:]')"
cleanup() {
  docker image rm --no-prune "$image" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
mkdir -p "$scratch/scripts"
cp "$root/scripts/install-build.sh" "$scratch/scripts/"
printf 'FROM scratch\nCOPY marker /marker\n' > "$scratch/Dockerfile"
echo installation-test > "$scratch/marker"
printf 'services:\n  certificate-helper:\n    image: %s\n    build: .\n' "$image" > "$scratch/compose.yaml"
before="$(docker buildx ls --format '{{.Name}}' | sort)"
volumes_before="$(docker volume ls --format '{{.Name}}' | sort)"
bash "$scratch/scripts/install-build.sh"
docker image inspect "$image" >/dev/null
after="$(docker buildx ls --format '{{.Name}}' | sort)"
[[ "$before" = "$after" ]] || { echo 'Temporary builder remained after installation' >&2; exit 1; }
[[ "$volumes_before" = "$(docker volume ls --format '{{.Name}}' | sort)" ]] || { echo 'Temporary build cache volume remained' >&2; exit 1; }
printf 'FROM scratch\nCOPY missing-file /marker\n' > "$scratch/Dockerfile"
if bash "$scratch/scripts/install-build.sh"; then
  echo 'Expected invalid build to fail' >&2; exit 1
fi
[[ "$before" = "$(docker buildx ls --format '{{.Name}}' | sort)" ]]
[[ "$volumes_before" = "$(docker volume ls --format '{{.Name}}' | sort)" ]]
echo 'Real Docker build exported its image and removed the temporary builder.'
