#!/bin/bash
set -e

# Apply schema to database (creates SQLite file or syncs PostgreSQL)
npx prisma db push --skip-generate 2>/dev/null || {
  echo "prisma db push failed, retrying in 2s..."
  sleep 2
  npx prisma db push --skip-generate
}

exec npx tsx server.ts
