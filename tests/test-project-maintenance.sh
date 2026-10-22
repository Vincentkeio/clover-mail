#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/project/scripts" "$scratch/bin"
cp "$root/scripts/project-maintenance.sh" "$scratch/project/scripts/"
cat > "$scratch/bin/python3" <<'PYTHON'
#!/usr/bin/env bash
printf '%s\n' "$2" >> "$CLOVER_TEST_CALLS"
exit 0
PYTHON
cat > "$scratch/project/scripts/backup.sh" <<'BACKUP'
#!/usr/bin/env bash
printf '%s\n' backup >> "$CLOVER_TEST_CALLS"
exit "${CLOVER_TEST_BACKUP_STATUS:-1}"
BACKUP
chmod +x "$scratch/bin/python3"
export PATH="$scratch/bin:$PATH"
export CLOVER_TEST_CALLS="$scratch/calls"
if bash "$scratch/project/scripts/project-maintenance.sh" finish; then
  echo 'Expected backup failure to stop cleanup' >&2
  exit 1
fi
test "$(cat "$scratch/calls")" = "$(printf 'pending\nbackup')"
: > "$scratch/calls"
CLOVER_TEST_BACKUP_STATUS=0 bash "$scratch/project/scripts/project-maintenance.sh" finish
test "$(cat "$scratch/calls")" = "$(printf 'pending\nbackup\nfinish')"
echo 'Backup failure gate and successful finalization passed.'
