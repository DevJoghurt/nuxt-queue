import chokidar from 'chokidar'
import { join } from 'pathe'
import type { Nuxt } from '@nuxt/schema'
import { useLogger } from '@nuxt/kit'
import { debounce } from 'perfect-debounce'
import type { LayerInfo } from '../registry'

const logger = useLogger('nuxt-queue')

interface WatcherOptions {
  nuxt: Nuxt
  layerInfos: LayerInfo[]
  queuesDir: string
  onRefresh: (reason: string, changedPath?: string) => Promise<void>
}

/**
 * Watch queue worker files and trigger registry refresh on changes
 */
export function watchQueueFiles(options: WatcherOptions) {
  const { nuxt, layerInfos, queuesDir, onRefresh } = options

  // Build list of directories to watch
  const dirsToWatch = layerInfos
    .map((layer) => {
      const serverDir = layer.serverDir || join(layer.rootDir, 'server')
      return join(serverDir, queuesDir)
    })
    .filter(Boolean)

  if (dirsToWatch.length === 0) {
    logger.warn('No queue directories found to watch')
    return
  }

  logger.info('Watching queue directories:', dirsToWatch)

  // Create chokidar watcher
  const watcher = chokidar.watch(dirsToWatch, {
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true,
    ignored: [
      '**/node_modules/**',
      '**/__pycache__/**',
      '**/.git/**',
      '**/dist/**',
      '**/.nuxt/**',
    ],
    // Watch only specific file types
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  })

  logger.info('Chokidar watcher initialized')
  logger.info('Watched patterns:', dirsToWatch.map(dir => `${dir}/**/*.{ts,js,py}`))

  watcher.on('ready', () => {
    const watched = watcher.getWatched()
    const fileCount = Object.values(watched).reduce((sum, files) => sum + files.length, 0)
    logger.success(`Queue file watcher ready - watching ${fileCount} files`)
  })

  // Debounce the refresh to avoid multiple rapid updates
  const debouncedRefresh = debounce(onRefresh, 150)

  // Debug: Log all events
  watcher.on('all', (event, path) => {
    logger.info(`Watcher event: ${event} - ${path}`)
  })

  // Handle file changes
  watcher.on('add', async (path) => {
    logger.info(`Queue file added: ${path}`)
    await debouncedRefresh('add', path)
  })

  watcher.on('change', async (path) => {
    logger.info(`Queue file changed: ${path}`)
    await debouncedRefresh('change', path)
  })

  watcher.on('unlink', async (path) => {
    logger.info(`Queue file removed: ${path}`)
    await debouncedRefresh('unlink', path)
  })

  watcher.on('error', (error) => {
    logger.error('Watcher error:', error)
  })

  // Clean up watcher on Nuxt close
  nuxt.hook('close', () => {
    logger.info('Closing queue file watcher')
    watcher.close()
  })

  return watcher
}
