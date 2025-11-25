/**
 * Get all server imports for the nvent module
 * Centralizes all auto-imports configuration
 */
export function getServerImports(resolverFn: (path: string) => string, buildDir: string) {
  return [
    // Generated templates
    {
      name: 'useFunctionRegistry',
      as: '$useFunctionRegistry',
      from: resolverFn(buildDir + '/function-registry'),
    },
    {
      name: 'useWorkerHandlers',
      as: '$useWorkerHandlers',
      from: resolverFn(buildDir + '/worker-handlers'),
    },
    {
      name: 'useAnalyzedFlows',
      as: '$useAnalyzedFlows',
      from: resolverFn(buildDir + '/analyzed-flows'),
    },
    {
      name: 'useTriggerRegistry',
      as: '$useTriggerRegistry',
      from: resolverFn(buildDir + '/trigger-registry'),
    },

    // Core utilities for user code
    {
      name: 'defineFunctionConfig',
      from: resolverFn('./runtime/nitro/utils/defineFunctionConfig'),
    },
    {
      name: 'defineFunction',
      from: resolverFn('./runtime/nitro/utils/defineFunction'),
    },

    // Composables users may need in server code
    {
      name: 'useFlowEngine',
      from: resolverFn('./runtime/nitro/utils/useFlowEngine'),
    },
    {
      name: 'useEventManager',
      from: resolverFn('./runtime/nitro/utils/useEventManager'),
    },
    {
      name: 'usePeerManager',
      from: resolverFn('./runtime/nitro/utils/wsPeerManager'),
    },
    {
      name: 'useNventLogger',
      from: resolverFn('./runtime/nitro/utils/useNventLogger'),
    },
    {
      name: 'useHookRegistry',
      from: resolverFn('./runtime/nitro/utils/useHookRegistry'),
    },
    {
      name: 'useAwait',
      from: resolverFn('./runtime/nitro/utils/useAwait'),
    },
    {
      name: 'useRunContext',
      from: resolverFn('./runtime/nitro/utils/useRunContext'),
    },
    {
      name: 'defineAwaitRegisterHook',
      from: resolverFn('./runtime/nitro/utils/defineHooks'),
    },
    {
      name: 'defineAwaitResolveHook',
      from: resolverFn('./runtime/nitro/utils/defineHooks'),
    },

    // Adapter composables
    {
      name: 'useQueueAdapter',
      from: resolverFn('./runtime/nitro/utils/adapters'),
    },
    {
      name: 'useStoreAdapter',
      from: resolverFn('./runtime/nitro/utils/adapters'),
    },
    {
      name: 'useStreamAdapter',
      from: resolverFn('./runtime/nitro/utils/adapters'),
    },
    {
      name: 'useStateAdapter',
      from: resolverFn('./runtime/nitro/utils/adapters'),
    },
    {
      name: 'getAdapters',
      from: resolverFn('./runtime/nitro/utils/adapters'),
    },
    {
      name: 'setAdapters',
      from: resolverFn('./runtime/nitro/utils/adapters'),
    },

    // Runtime utilities
    {
      name: 'useStreamTopics',
      from: resolverFn('./runtime/nitro/utils/useStreamTopics'),
    },
    {
      name: 'useTrigger',
      from: resolverFn('./runtime/nitro/utils/useTrigger'),
    },
    {
      name: 'useFlow',
      from: resolverFn('./runtime/nitro/utils/useFlow'),
    },
    // Adapter registration utilities for external modules
    {
      name: 'registerQueueAdapter',
      from: resolverFn('./runtime/nitro/utils/registerAdapter'),
    },
    {
      name: 'registerStreamAdapter',
      from: resolverFn('./runtime/nitro/utils/registerAdapter'),
    },
    {
      name: 'registerStoreAdapter',
      from: resolverFn('./runtime/nitro/utils/registerAdapter'),
    },
  ]
}
