#!/usr/bin/env bash
# Build and publish the static game; nginx and the Nostr relay are managed separately.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ${EUID} -eq 0 ]]; then
  echo 'Run this script as the normal project user, not with sudo.' >&2
  exit 1
fi

npm test
SELF_HOSTED=true npm run build

# Keep old hashed assets so clients with a cached page can finish loading.
sudo mkdir -p /var/www/nongkrong
sudo cp -a dist/. /var/www/nongkrong/
if command -v restorecon >/dev/null 2>&1; then
  sudo restorecon -RF /var/www/nongkrong
fi

echo 'Deployed to /var/www/nongkrong/ (https://denizakya.xyz/nongkrong/)'
echo 'This script does not change nginx or restart the Nostr relay.'
