#!/usr/bin/env bash
set -euo pipefail

npm install --no-audit --no-fund
npx drizzle-kit migrate
npm run check
npm test
npm run build