<template>
  <div
    class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 cursor-pointer transition-colors"
    :class="{
      'bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-500': selected,
    }"
    @click="$emit('click')"
  >
    <div class="flex items-start gap-3">
      <div
        v-if="icon || $slots.icon"
        class="flex-shrink-0 mt-0.5"
      >
        <slot name="icon">
          <UIcon
            v-if="icon"
            :name="icon"
            class="w-5 h-5"
            :class="iconClass"
          />
        </slot>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2 mb-1">
          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            <slot name="title">
              {{ title }}
            </slot>
          </h3>
          <slot name="badge">
            <UBadge
              v-if="badge"
              :label="badge"
              :color="badgeColor"
              variant="subtle"
              size="xs"
              class="capitalize flex-shrink-0"
            />
          </slot>
        </div>
        <p
          v-if="subtitle || $slots.subtitle"
          class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mb-1"
        >
          <slot name="subtitle">
            {{ subtitle }}
          </slot>
        </p>
        <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <slot name="meta">
            <span v-if="meta">{{ meta }}</span>
            <span v-if="metaSecondary">• {{ metaSecondary }}</span>
          </slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  selected?: boolean
  icon?: string
  iconClass?: string
  title?: string
  subtitle?: string
  badge?: string
  badgeColor?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'
  meta?: string
  metaSecondary?: string
}>()

defineEmits<{
  click: []
}>()
</script>
