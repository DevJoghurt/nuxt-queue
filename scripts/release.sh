#!/bin/bash

set -e

publish_package() {
  local package_name=$1
  local package_path=$2
  
  echo "⚡ Publishing $package_name"
  cd "$package_path"
  
  if npm publish --access public 2>&1; then
    echo "✅ $package_name published successfully"
  else
    echo "ℹ️  $package_name might already be published at this version"
  fi
  
  cd - > /dev/null
}

echo "📦 Publishing nvent monorepo packages"

# Publish packages
publish_package "nvent" "packages/nvent"
publish_package "@nvent-addon/app" "packages/app"
publish_package "@nvent-addon/adapter-queue-redis" "packages/adapter-queue-redis"
publish_package "@nvent-addon/adapter-store-redis" "packages/adapter-store-redis"
publish_package "@nvent-addon/adapter-stream-redis" "packages/adapter-stream-redis"
publish_package "@nvent-addon/adapter-queue-postgres" "packages/adapter-queue-postgres"
publish_package "@nvent-addon/adapter-store-postgres" "packages/adapter-store-postgres"
publish_package "@nvent-addon/adapter-stream-postgres" "packages/adapter-stream-postgres"

echo "✅ All packages published successfully"

echo "✅ All packages published successfully"