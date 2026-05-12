#!/usr/bin/env bash
# Opt-in local secret-scan pre-commit hook.
#
# Usage:  ./scripts/install-hooks.sh
# Removes itself with:  rm .git/hooks/pre-commit
#
# Requires gitleaks installed locally. Install on macOS:  brew install gitleaks
# Other platforms:  https://github.com/gitleaks/gitleaks#installing
#
# This is intentionally not auto-installed by `npm install` — keeps the
# hook explicit. CI (.github/workflows/secret-scan.yml) catches anything
# that slips past, but the local hook saves you a force-push.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-commit"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not found on PATH." >&2
  echo "Install:  brew install gitleaks  (or see https://github.com/gitleaks/gitleaks)" >&2
  exit 1
fi

cat > "$HOOK_PATH" <<'HOOK'
#!/usr/bin/env bash
# Auto-installed by scripts/install-hooks.sh — runs gitleaks against
# staged changes. To bypass for a single commit:  git commit --no-verify
# (use sparingly; CI will still block).
set -e
exec gitleaks protect --staged --redact --no-banner --verbose --config "$(git rev-parse --show-toplevel)/.gitleaks.toml"
HOOK

chmod +x "$HOOK_PATH"
echo "Installed pre-commit hook at $HOOK_PATH"
echo "Test it:  gitleaks protect --staged --no-banner --config .gitleaks.toml"
