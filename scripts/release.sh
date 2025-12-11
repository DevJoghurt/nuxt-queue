#!/bin/bash

set -xe

echo "📦 Publishing nvent monorepo packages"

# Publish core nvent package
echo "⚡ Publishing nvent"
cd packages/nvent
npm publish --access public --provenance
cd ../..

# Publish @nvent-addon/app
echo "⚡ Publishing @nvent-addon/app"
cd packages/app
npm publish --access public --provenance
cd ../..

# Publish adapter packages
echo "⚡ Publishing @nvent-addon/adapter-queue-redis"
cd packages/adapter-queue-redis
npm publish --access public --provenance
cd ../..

echo "⚡ Publishing @nvent-addon/adapter-store-redis"
cd packages/adapter-store-redis
npm publish --access public --provenance
cd ../..

echo "⚡ Publishing @nvent-addon/adapter-stream-redis"
cd packages/adapter-stream-redis
npm publish --access public --provenance
cd ../..

echo "⚡ Publishing @nvent-addon/adapter-queue-postgres"
cd packages/adapter-queue-postgres
npm publish --access public --provenance
cd ../..

echo "⚡ Publishing @nvent-addon/adapter-store-postgres"
cd packages/adapter-store-postgres
npm publish --access public --provenance
cd ../..

echo "⚡ Publishing @nvent-addon/adapter-stream-postgres"
cd packages/adapter-stream-postgres
npm publish --access public --provenance
cd ../..

echo "✅ All packages published successfully"