<template>
  <slot
    :component="component"
    :route="route"
    :push="push"
  />
</template>

<script setup lang="ts">
import { useComponentRouter } from '#imports'

type ComponentRouteRecord = { path: string, component: any, name?: string }
type ComponentRouterMode = 'query' | 'hash' | 'memory'

const props = withDefaults(
  defineProps<{
    routes: ComponentRouteRecord[] | Record<string, any>
    base?: string
    mode?: ComponentRouterMode
    initial?: string
    debug?: boolean
  }>(),
  {
    base: 'fp',
    mode: 'query',
    debug: false,
  },
)

const { component, route, push, replace } = useComponentRouter({
  routes: props.routes,
  base: props.base,
  mode: props.mode,
  initial: props.initial,
  debug: props.debug,
})

defineExpose({ push, replace, route })
</script>
