<template>
  <div
    class="border rounded p-1 min-w-20"
    :class="{
      'border-red-400': color === 'red',
      'border-green-400': color === 'green',
      'border-yellow-400': color === 'yellow',
      'border-neutral-400': color === 'neutral',
      'border-orange-400': color === 'orange',
    }"
  >
    <div class="flex flex-col gap-1 text-center">
      <span class="text-xs text-gray-500">{{ name }}</span>
      <span class="text-sm font-semibold">{{ count || 0 }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Color } from '../types'

defineProps<{
  name: string
  count?: number
  color?: Color
}>()
</script>
