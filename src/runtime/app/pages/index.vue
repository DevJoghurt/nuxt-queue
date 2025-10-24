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
import Queue from './queue/index.vue'
import QueueJobs from './queue/jobs.vue'
import QueueJob from './queue/job.vue'
import QueueDashboard from './dashboard/index.vue'
import QueueEvents from './events/index.vue'
import QueueFlows from './flows/index.vue'

const navItems = [
  [
    { label: 'Dashboard', icon: 'i-heroicons-chart-pie', path: '/' },
    { label: 'Queue', icon: 'i-lucide-app-window', path: '/queue' },
    { label: 'Flows', icon: 'i-lucide-git-branch', path: '/flows' },
    { label: 'Events', icon: 'i-lucide-activity', path: '/events' },
  ],
] as (NavigationMenuItem & { path?: string })[][]

const routes = {
  '/': QueueDashboard,
  '/queue': Queue,
  '/queue/:name/jobs': QueueJobs,
  '/queue/:name/jobs/:id': QueueJob,
  '/flows': QueueFlows,
  '/events': QueueEvents,
}

// Consumer mode: read the current router context from inside this page
// Shell and pages will consume the router via useComponentRouter() in consumer mode
</script>
