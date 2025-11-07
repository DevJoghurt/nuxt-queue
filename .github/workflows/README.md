# Release Workflows

This directory contains GitHub Actions workflows for releasing the package under different names.

## Workflows

### 1. `release.yml` - Automatic Release (Tag-based)
**Trigger:** Pushing a git tag (e.g., `v0.4.0`)

Publishes to **both** `nuxt-queue` and `nvent` on npm.

```bash
git tag v0.4.0
git push origin v0.4.0
```

### 2. `release-nuxt-queue.yml` - Manual Release (nuxt-queue only)
**Trigger:** Manual workflow dispatch from GitHub UI

Publishes **only** to `nuxt-queue` on npm.

**How to use:**
1. Go to Actions tab in GitHub
2. Select "Release nuxt-queue" workflow
3. Click "Run workflow"
4. Enter the version tag (e.g., `v0.4.0`)
5. Click "Run workflow"

### 3. `release-nvent.yml` - Manual Release (nvent only)
**Trigger:** Manual workflow dispatch from GitHub UI

Publishes **only** to `nvent` on npm.

**How to use:**
1. Go to Actions tab in GitHub
2. Select "Release nvent" workflow
3. Click "Run workflow"
4. Enter the version tag (e.g., `v0.4.0`)
5. Click "Run workflow"

## Release Script

The `scripts/release.sh` script supports the following environment variables:

- `PUBLISH_PACKAGE=both` (default) - Publish to both nuxt-queue and nvent
- `PUBLISH_PACKAGE=nuxt-queue` - Publish only to nuxt-queue
- `PUBLISH_PACKAGE=nvent` - Publish only to nvent

## Manual Release from Terminal

You can also run releases manually from your terminal:

```bash
# Build first
yarn build

# Publish to both
NPM_TOKEN=your-token ./scripts/release.sh

# Publish to nuxt-queue only
NPM_TOKEN=your-token PUBLISH_PACKAGE=nuxt-queue ./scripts/release.sh

# Publish to nvent only
NPM_TOKEN=your-token PUBLISH_PACKAGE=nvent ./scripts/release.sh
```

## Required Secrets

Make sure the following secrets are set in your GitHub repository:

- `NPM_TOKEN` - Your npm publish token
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions

## How It Works

1. **Build the package** with `yarn build` (creates `dist/` folder)
2. **Publish as nuxt-queue** (if enabled)
3. **Change package name to nvent** in package.json
4. **Publish as nvent** (if enabled) - uses the same built `dist/` folder
5. **Restore original package.json**

The key is that we build ONCE and publish TWICE (with different names), rather than trying to rebuild with a different name.
