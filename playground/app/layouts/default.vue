<script setup lang="ts">
const links = [
  { label: 'Home', to: '/' },
  { label: 'Queue', to: '/queue' },
  { label: 'Triggers & Await', to: '/triggers' },
]
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <nav class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16">
          <div class="flex">
            <div class="flex-shrink-0 flex items-center">
              <span class="text-xl font-bold">nvent Playground</span>
            </div>
            <div class="ml-6 flex space-x-8">
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
    <slot />
  </div>
</template>
