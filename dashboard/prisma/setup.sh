#!/bin/bash
set -e

# Detect database provider from DATABASE_URL or DATABASE_PROVIDER env var
if [[ "$DATABASE_PROVIDER" == "sqlite" ]] || [[ "$DATABASE_URL" == file:* ]]; then
  echo "SQLite detected — patching schema..."
  sed -i 's/provider = "postgresql"/provider = "sqlite"/' prisma/schema.prisma
fi

npx prisma generate
