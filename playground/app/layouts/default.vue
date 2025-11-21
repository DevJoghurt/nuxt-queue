<script setup lang="ts">
const links = [
  { label: 'Home', to: '/' },
  { label: 'Triggers & Await', to: '/triggers' },
]
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
    <!-- Fixed Header -->
    <nav class="shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div class="px-4 sm:px-6 lg:px-8">
        <div class="flex h-16 items-center justify-between">
          <div class="flex items-center gap-8">
            <div class="flex-shrink-0">
              <span class="text-xl font-bold">nvent Playground</span>
            </div>
            <div class="flex space-x-8">
              <NuxtLink
                v-for="link in links"
                :key="link.to"
                :to="link.to"
                class="inline-flex items-center px-1 pt-1 text-sm font-medium"
                active-class="border-b-2 border-primary-500 text-gray-900 dark:text-white"
                inactive-class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                {{ link.label }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </nav>
    
    <!-- Scrollable Content Area -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <slot />
    </div>
  </div>
</template>
