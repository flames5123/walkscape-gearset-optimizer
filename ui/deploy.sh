#!/bin/bash
# Deployment script for home server
# This script pulls latest changes and applies database migrations

set -e  # Exit on error

echo "🚀 Starting deployment..."

# Store current commit for comparison
OLD_COMMIT=$(git rev-parse HEAD)

# Pull latest changes
echo "📥 Pulling latest changes from GitHub..."
git pull origin main

NEW_COMMIT=$(git rev-parse HEAD)

# Check if anything changed
if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
    echo "✓ Already up to date"
    exit 0
fi

echo "📝 Changes detected: $OLD_COMMIT -> $NEW_COMMIT"

# Check if there are new migrations
if [ -d "migrations" ] && [ "$(ls -A migrations/*.sql 2>/dev/null)" ]; then
    echo "🔄 Applying database migrations..."
    docker-compose exec -T walkscape-ui python3 /app/ui/apply_migrations.py
else
    echo "✓ No migrations to apply"
fi

# Check if Dockerfile or requirements changed (need rebuild)
if git diff $OLD_COMMIT $NEW_COMMIT --name-only | grep -qE "Dockerfile|requirements.txt"; then
    echo "🔨 Rebuilding Docker image..."
    docker-compose up -d --build
else
    echo "✓ No rebuild needed, uvicorn will auto-reload"
fi

echo "✓ Deployment complete!"
