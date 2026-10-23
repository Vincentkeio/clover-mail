#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/project/scripts" "$scratch/bin"
cp "$root/scripts/install-build.sh" "$scratch/project/scripts/"
cat > "$scratch/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CLOVER_TEST_CALLS"
case "$*" in
  'compose build --help') echo '--builder' ;;
  'buildx version') exit "${NO_BUILDX:-0}" ;;
  'buildx create --driver docker-container')
    [[ "${CREATE_FAILURE:-0}" = 0 ]] || exit 23
    echo isolated_install_builder ;;
  'compose -f compose.yaml build --builder isolated_install_builder certificate-helper') exit "${BUILD_FAILURE:-0}" ;;
  'buildx rm --force isolated_install_builder') exit "${CLEANUP_FAILURE:-0}" ;;
  *) echo "Unexpected Docker action: $*" >&2; exit 91 ;;
esac
MOCK
chmod +x "$scratch/bin/docker"
export PATH="$scratch/bin:$PATH" CLOVER_TEST_CALLS="$scratch/calls"
run_case() {
  local expected=$1 actual=0
  shift
  : > "$CLOVER_TEST_CALLS"
  env "$@" bash "$scratch/project/scripts/install-build.sh" || actual=$?
  [[ "$actual" = "$expected" ]] || { echo "Wrong exit: $actual, expected $expected" >&2; exit 1; }
}
run_case 0
grep -qx 'buildx rm --force isolated_install_builder' "$CLOVER_TEST_CALLS"
run_case 19 BUILD_FAILURE=19
grep -qx 'buildx rm --force isolated_install_builder' "$CLOVER_TEST_CALLS"
run_case 19 BUILD_FAILURE=19 CLEANUP_FAILURE=1
run_case 1 CLEANUP_FAILURE=1
run_case 23 CREATE_FAILURE=1
! grep -q 'buildx rm' "$CLOVER_TEST_CALLS"
! grep -q 'compose -f' "$CLOVER_TEST_CALLS"
run_case 1 NO_BUILDX=1
! grep -Eq 'buildx (rm|create)|compose -f' "$CLOVER_TEST_CALLS"

# Bootstrap must clean its own download directory before exec, and on failure.
mkdir -p "$scratch/source/pkg/scripts" "$scratch/downloads"
printf '#!/usr/bin/env bash\nexit "${INSTALL_FAILURE:-0}"\n' > "$scratch/source/pkg/install.sh"
touch "$scratch/source/pkg/scripts/placeholder.sh" "$scratch/downloads/unrelated"
tar czf "$scratch/source.tar.gz" -C "$scratch/source" pkg
cat > "$scratch/bin/curl" <<'MOCK'
#!/usr/bin/env bash
[[ "${DOWNLOAD_FAILURE:-0}" = 0 ]] || exit 7
while [[ "$1" != -o ]]; do shift; done
cp "$CLOVER_TEST_ARCHIVE" "$2"
MOCK
printf '#!/usr/bin/env bash\necho 0\n' > "$scratch/bin/id"
chmod +x "$scratch/bin/curl" "$scratch/bin/id"
export CLOVER_TEST_ARCHIVE="$scratch/source.tar.gz" TMPDIR="$scratch/downloads"
for scenario in success install-failure download-failure; do
  status=0
  case "$scenario" in
    success) expected=0; install_status=0; download_status=0 ;;
    install-failure) expected=29; install_status=29; download_status=0 ;;
    download-failure) expected=1; install_status=0; download_status=1 ;;
  esac
  CLOVER_DIR="$scratch/target-$scenario" INSTALL_FAILURE="$install_status" DOWNLOAD_FAILURE="$download_status" bash "$root/bootstrap.sh" || status=$?
  [[ "$status" = "$expected" ]]
  [[ "$(find "$TMPDIR" -mindepth 1 -maxdepth 1 | wc -l)" = 1 ]]
  test -f "$TMPDIR/unrelated"
done
# Fresh installs skip the migration hook; legacy updaters keep invoking it.
cp "$root/scripts/install-cli.sh" "$scratch/project/scripts/"
touch "$scratch/project/scripts/clover.sh"
cat > "$scratch/project/scripts/project-maintenance.sh" <<'MOCK'
#!/usr/bin/env bash
echo "$1" >> "$CLOVER_TEST_CALLS"
MOCK
: > "$CLOVER_TEST_CALLS"
CLOVER_FRESH_INSTALL=1 CLOVER_CLI_TARGET="$scratch/clover-command" bash "$scratch/project/scripts/install-cli.sh" "$scratch/project"
test ! -s "$CLOVER_TEST_CALLS"
CLOVER_CLI_TARGET="$scratch/clover-legacy-command" bash "$scratch/project/scripts/install-cli.sh" "$scratch/project"
test "$(cat "$CLOVER_TEST_CALLS")" = capture
# An optional CLI conflict must not report an otherwise successful install as failed.
cp "$root/scripts/compose-install.sh" "$scratch/project/scripts/"
cat > "$scratch/project/.env" <<'ENV'
PANEL_HOSTNAME=panel.install-test.invalid
MAIL_HOSTNAME=mail.install-test.invalid
MAIL_DOMAIN=install-test.invalid
ACME_EMAIL=admin@install-test.invalid
ENABLE_CLAMAV=0
SSL_TYPE=manual
SSL_CERT_PATH=/test/mail.crt
SSL_KEY_PATH=/test/mail.key
ENV
cat > "$scratch/bin/docker" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" != inspect ]] || exit 1
[[ "$1" = compose ]] || exit 91
exit 0
MOCK
for helper in admin-bootstrap configure-roundcube install-build; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$scratch/project/scripts/$helper.sh"
done
printf '#!/usr/bin/env bash\nexit 42\n' > "$scratch/project/scripts/install-cli.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$scratch/bin/flock"
chmod +x "$scratch/bin/flock"
CLOVER_HOME="$scratch/project" bash "$scratch/project/scripts/compose-install.sh" > "$scratch/compose-output" 2>&1 || { cat "$scratch/compose-output"; exit 1; }
grep -q '已有命令原样保留' "$scratch/compose-output"
grep -q '安装完成' "$scratch/compose-output"
printf '#!/usr/bin/env bash\nexit 43\n' > "$scratch/project/scripts/configure-roundcube.sh"
status=0
CLOVER_HOME="$scratch/project" bash "$scratch/project/scripts/compose-install.sh" > "$scratch/compose-output" 2>&1 || status=$?
test "$status" = 43
! grep -q '安装完成' "$scratch/compose-output"
echo 'Fresh install isolation, failure cleanup and bootstrap temporary directory checks passed.'
