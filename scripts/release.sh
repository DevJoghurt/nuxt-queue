#!/bin/bash

set -xe

# Update token
if [[ ! -z ${NPM_TOKEN} ]] ; then
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> ~/.npmrc
  echo "registry=https://registry.npmjs.org/" >> ~/.npmrc
  echo "always-auth=true" >> ~/.npmrc
  npm whoami
fi

echo "📦 Publishing nvent monorepo packages"

# Publish core nvent package
echo "⚡ Publishing nvent"
cd packages/nvent
npm publish --access public --tolerate-republish
cd ../..

# Publish @nvent-addon/app
echo "⚡ Publishing @nvent-addon/app"
cd packages/app
npm publish --access public --tolerate-republish
cd ../..

# Publish adapter packages
echo "⚡ Publishing @nvent-addon/adapter-queue-redis"
cd packages/adapter-queue-redis
npm publish --access public --tolerate-republish
cd ../..

echo "⚡ Publishing @nvent-addon/adapter-store-redis"
cd packages/adapter-store-redis
npm publish --access public --tolerate-republish
cd ../..

echo "⚡ Publishing @nvent-addon/adapter-stream-redis"
cd packages/adapter-stream-redis
npm publish --access public --tolerate-republish
cd ../..

echo "✅ All packages published successfully"