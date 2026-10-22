#!/usr/bin/env bash
# Fresh installations never put their build cache in the shared default builder.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
compose_help="$(docker compose build --help 2>/dev/null || true)"
if ! docker buildx version >/dev/null 2>&1 || ! grep -q -- '--builder' <<< "$compose_help"; then
  echo '安装需要支持独立构建器的 Docker Buildx 和 Compose，请更新 Docker 后重试；未使用共享构建缓存。' >&2
  exit 1
fi
# Let Buildx allocate a new name: never adopt or remove an existing builder.
builder=''
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$builder" ]]; then
    if ! docker buildx rm --force "$builder"; then
      echo "安装构建器清理失败，请重试：docker buildx rm --force $builder" >&2
      [[ "$status" != 0 ]] || status=1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
builder="$(docker buildx create --driver docker-container)"
# Do not proceed or pass malformed output to a removal command.
[[ "$builder" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]] || {
  echo 'Docker 未返回有效的独立构建器名称，已停止安装。' >&2
  builder=''
  exit 1
}
echo '使用临时独立构建器；构建完成后清理本次缓存…'
docker compose -f compose.yaml build --builder "$builder" certificate-helper
