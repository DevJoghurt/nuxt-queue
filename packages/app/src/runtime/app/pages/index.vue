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
import Dashboard from './dashboard.vue'
import Queue from './queues/index.vue'
import QueueJobs from './queues/jobs.vue'
import QueueJob from './queues/job.vue'
import QueueFlows from './flows/index.vue'
import Triggers from './triggers/index.vue'
import TriggerDetail from './triggers/[name].vue'

const navItems = [
  [
    { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', path: '/' },
    { label: 'Queues', icon: 'i-lucide-app-window', path: '/queues' },
    { label: 'Flows', icon: 'i-lucide-git-branch', path: '/flows' },
    { label: 'Triggers', icon: 'i-lucide-zap', path: '/triggers' },
  ],
] as (NavigationMenuItem & { path?: string })[][]

const routes = {
  '/': Dashboard,
  '/queues': Queue,
  '/queues/:name/jobs': QueueJobs,
  '/queues/:name/jobs/:id': QueueJob,
  '/flows': QueueFlows,
  '/triggers': Triggers,
  '/triggers/:name': TriggerDetail,
}

// Consumer mode: read the current router context from inside this page
// Shell and pages will consume the router via useComponentRouter() in consumer mode
</script>
