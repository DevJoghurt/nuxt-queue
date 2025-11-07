<template>
  <QueueNhealthComponentRouter
    v-slot="{ component }"
    :routes="routes"
    base="p"
    mode="query"
  >
    <QueueNhealthComponentShell
      orientation="horizontal"
      :items="navItems"
    >
      <component :is="component" />
    </QueueNhealthComponentShell>
  </QueueNhealthComponentRouter>
</template>

<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import Queue from './queues/index.vue'
import QueueJobs from './queues/jobs.vue'
import QueueJob from './queues/job.vue'
import QueueFlows from './flows/index.vue'

const navItems = [
  [
    { label: 'Queues', icon: 'i-lucide-app-window', path: '/' },
    { label: 'Flows', icon: 'i-lucide-git-branch', path: '/flows' },
  ],
] as (NavigationMenuItem & { path?: string })[][]

const routes = {
  '/': Queue,
  '/queues/:name/jobs': QueueJobs,
  '/queues/:name/jobs/:id': QueueJob,
  '/flows': QueueFlows,
}

// Consumer mode: read the current router context from inside this page
// Shell and pages will consume the router via useComponentRouter() in consumer mode
</script>
