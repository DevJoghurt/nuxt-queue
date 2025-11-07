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

# Save original package.json
cp package.json package.json.bak

# Publish as nuxt-queue
echo "⚡ Publishing as nuxt-queue with tag latest"
npx npm@8.17.0 publish --tag latest --access public --tolerate-republish

# Publish as nvent
echo "⚡ Publishing as nvent with tag latest"
jq '.name = "nvent"' package.json > package.nvent.json
mv package.nvent.json package.json
npx npm@8.17.0 publish --tag latest --access public --tolerate-republish

# Restore original package.json
mv package.json.bak package.json