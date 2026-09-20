#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="${1:-/var/www/Employee-tracking}"

cd "$APP_DIR"

git remote prune origin
git fetch origin "+refs/heads/main:refs/remotes/origin/main"
git reset --hard refs/remotes/origin/main

cd backend
npm ci
npm run build
pm2 restart lightspeedgo-backend

cd ../admin
npm ci
npm run build
pm2 restart lightspeedgo-admin

pm2 save