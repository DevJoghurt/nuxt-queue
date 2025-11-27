<template>
  <NventComponentRouter
    v-slot="{ component }"
    :routes="routes"
    base="p"
    mode="query"
  >
      <NventComponentShell
      orientation="horizontal"
      :items="navItems"
    >
      <component :is="component" />
    </NventComponentShell>
  </NventComponentRouter>
</template>

<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import Dashboard from './dashboard.vue'
import Queue from './queues/index.vue'
import QueueJobs from './queues/jobs.vue'
import QueueJob from './queues/job.vue'
import Flows from './flows/index.vue'
import FlowDetail from './flows/[name].vue'
import Triggers from './triggers/index.vue'
import TriggerDetail from './triggers/[name].vue'
import TriggerNew from './triggers/new.vue'
import TriggerEdit from './triggers/[name]/edit.vue'
import SettingsScheduler from './settings/scheduler.vue'

const navItems: NavigationMenuItem[][] = [
  [
    { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', path: '/' } as any,
    { label: 'Queues', icon: 'i-lucide-app-window', path: '/queues' } as any,
    { label: 'Flows', icon: 'i-lucide-git-branch', path: '/flows' } as any,
    { label: 'Triggers', icon: 'i-lucide-zap', path: '/triggers' } as any,
  ],
  [
    {
      label: 'Settings',
      icon: 'i-lucide-settings',
      children: [
        {
          label: 'Scheduler',
          description: 'Monitor scheduled jobs and their execution',
          icon: 'i-lucide-clock',
          path: '/settings/scheduler',
        } as any,
      ],
    } as any,
  ],
]

const routes = {
  '/': Dashboard,
  '/queues': Queue,
  '/queues/:name/jobs': QueueJobs,
  '/queues/:name/jobs/:id': QueueJob,
  '/flows': Flows,
  '/flows/:name': FlowDetail,
  '/triggers': Triggers,
  '/triggers/new': TriggerNew,
  '/triggers/:name/edit': TriggerEdit,
  '/triggers/:name': TriggerDetail,
  '/settings/scheduler': SettingsScheduler,
}

// Consumer mode: read the current router context from inside this page
// Shell and pages will consume the router via useComponentRouter() in consumer mode
</script>
