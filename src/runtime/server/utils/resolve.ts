import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export function resolveWorkerRuntimePath(path: string) {
    if (path === 'build') {
        return join(dirname(fileURLToPath(import.meta.url)), 'worker')
    }
    return path
}