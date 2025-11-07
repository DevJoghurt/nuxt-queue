#!/bin/bash

set -xe

# Restore all git changes
git restore --source=HEAD --staged --worktree -- package.json yarn.lock

# Update token
if [[ ! -z ${NPM_TOKEN} ]] ; then
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> ~/.npmrc
  echo "registry=https://registry.npmjs.org/" >> ~/.npmrc
  echo "always-auth=true" >> ~/.npmrc
  npm whoami
fi

# Determine which package to publish (default: both)
PUBLISH_PACKAGE="${PUBLISH_PACKAGE:-both}"
echo "📦 PUBLISH_PACKAGE is set to: '$PUBLISH_PACKAGE'"
echo "📦 Checking condition for nuxt-queue publish..."
echo "📦 Condition 1: PUBLISH_PACKAGE = nuxt-queue? $([[ "$PUBLISH_PACKAGE" = "nuxt-queue" ]] && echo YES || echo NO)"
echo "📦 Condition 2: PUBLISH_PACKAGE = both? $([[ "$PUBLISH_PACKAGE" = "both" ]] && echo YES || echo NO)"

# Save original package.json
cp package.json package.json.bak

# Publish as nuxt-queue
if [[ "$PUBLISH_PACKAGE" = "nuxt-queue" ]] || [[ "$PUBLISH_PACKAGE" = "both" ]]; then
  echo "⚡ Publishing as nuxt-queue with tag latest"
  npx npm@8.17.0 publish --tag latest --access public --tolerate-republish
else
  echo "⏭️  Skipping nuxt-queue publish (PUBLISH_PACKAGE='$PUBLISH_PACKAGE')"
fi

# Publish as nvent (change name AFTER publishing nuxt-queue)
if [[ "$PUBLISH_PACKAGE" = "nvent" ]] || [[ "$PUBLISH_PACKAGE" = "both" ]]; then
  echo "⚡ Publishing as nvent with tag latest"
  echo "📦 Changing package name from 'nuxt-queue' to 'nvent'"
  # Change the name in package.json
  if [ -f "package.json.bak" ]; then
    jq '.name = "nvent"' package.json.bak > package.json
  else
    jq '.name = "nvent"' package.json > package.nvent.json
    mv package.nvent.json package.json
  fi
  cat package.json | grep '"name"'
  npx npm@8.17.0 publish --tag latest --access public --tolerate-republish
else
  echo "⏭️  Skipping nvent publish (PUBLISH_PACKAGE='$PUBLISH_PACKAGE')"
fi

# Restore original package.json
if [ -f "package.json.bak" ]; then
  mv package.json.bak package.json
fi