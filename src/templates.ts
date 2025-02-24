import {
  addTemplate,
} from '@nuxt/kit'
import { join } from 'pathe'
import type { RegisteredWorker } from './types'

const importFiles = (workers: RegisteredWorker[]) =>
  workers
    .filter(worker => worker.runtype === 'in-process')
    .map(
      worker => `import ${worker.name} from '${join(worker.cwd, worker.file.replace('.ts', ''))}';`,
    ).join('\n')

export const createInProcessWorkerComposable = (
  workers: RegisteredWorker[],
) => {
  const inProcessWorkerComposable = `
${importFiles(workers)}
const registeredWorkers = {${workers.filter(worker => worker.runtype === 'in-process').map(worker => worker.name).join(', ')}};

export const useWorkerProcessor = async (worker: string) => {
  return (typeof registeredWorkers[worker] === 'function') ? registeredWorkers[worker] : null;
};
`

  addTemplate({
    filename: 'inprocess-worker-composable.ts',
    write: true,
    getContents: () => inProcessWorkerComposable,
  })
}
