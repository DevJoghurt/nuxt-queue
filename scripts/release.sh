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

# Save original package.json
cp package.json package.json.bak

# Publish as nuxt-queue
if [[ "$PUBLISH_PACKAGE" == "nuxt-queue" ]] || [[ "$PUBLISH_PACKAGE" == "both" ]]; then
  echo "⚡ Publishing as nuxt-queue with tag latest"
  npx npm@8.17.0 publish --tag latest --access public --tolerate-republish
fi

# Publish as nvent (change name AFTER publishing nuxt-queue)
if [[ "$PUBLISH_PACKAGE" == "nvent" ]] || [[ "$PUBLISH_PACKAGE" == "both" ]]; then
  echo "⚡ Publishing as nvent with tag latest"
  # Change the name in the already built dist/package.json instead of root package.json
  if [ -f "package.json.bak" ]; then
    jq '.name = "nvent"' package.json.bak > package.json
  else
    jq '.name = "nvent"' package.json > package.nvent.json
    mv package.nvent.json package.json
  fi
  npx npm@8.17.0 publish --tag latest --access public --tolerate-republish
fi

# Restore original package.json
if [ -f "package.json.bak" ]; then
  mv package.json.bak package.json
fi