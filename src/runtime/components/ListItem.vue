<template>
  <div
    :to="link"
    class="rounded-lg divide-y divide-gray-200 dark:divide-gray-800 ring-1 ring-gray-200 dark:ring-gray-800 shadow bg-white dark:bg-gray-900"
  >
    <div class="px-4 py-5 sm:p-6">
      <div class="flex flex-row">
        <div class="flex-none flex flex-col justify-between space-y-2">
          <ULink
            :to="link"
            class="inline-flex items-center gap-1"
          >
            <span class="text-lg font-semibold">{{ title }}</span>
            <UIcon
              name="i-heroicons-arrow-up-right"
              class="w-5 h-5 text-primary-500"
            />
          </ULink>
          <div class="flex flex-wrap items-center gap-2">
            <div class="inline-flex gap-1 items-center">
              <UIcon
                name="i-heroicons-check-circle"
                class="w-4 h-4 text-green-500"
              />
              <span class="text-sm">Active</span>
            </div>
            <UBadge
              v-if="origin"
              size="sm"
              color="neutral"
            >
              <span v-if="origin==='local'">Local</span>
              <span v-if="origin==='remote'">Remote</span>
            </UBadge>
          </div>
        </div>
        <div class="grow pr-12">
          <div class="flex flex-row gap-4 justify-end">
            <slot />
          </div>
        </div>
        <div class="flex-none">
          <div class="flex gap-2 items-center">
            <UDropdownMenu
              :items="dropdown"
              :popper="{ placement: 'bottom-start' }"
            >
              <UButton
                icon="i-heroicons-ellipsis-vertical"
                color="gray"
                variant="outline"
              />
            </UDropdownMenu>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps({
  title: {
    type: String,
    default: '',
  },
  link: {
    type: String,
  },
  origin: {
    type: String,
    default: null,
  },
  dropdown: {
    type: Array,
    default: () => [],
  },
})
</script>
