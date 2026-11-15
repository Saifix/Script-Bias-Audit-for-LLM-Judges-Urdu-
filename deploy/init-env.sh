#!/bin/sh
# Create .env with random secrets and one admin user. Never overwrites an existing .env.
set -e
cd "$(dirname "$0")/.."
[ -f .env ] && { echo ".env already exists - not touching it."; exit 1; }
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
PASS=$(rand 24)
sed -e "s|^APP_USERS=.*|APP_USERS=admin:${PASS}|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand 48)|" \
    -e "s|^BACKEND_TOKEN=.*|BACKEND_TOKEN=$(rand 48)|" .env.example > .env
chmod 600 .env
echo "Created .env. Login: admin / ${PASS}"
echo "Now add OPENROUTER_API_KEY to .env, then: docker compose up --build -d"
