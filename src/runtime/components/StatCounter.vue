<template>
  <div
    class="border rounded p-4 min-w-32"
    :class="{
      'border-red-400': color === 'red',
      'border-green-400': color === 'green',
      'border-yellow-400': color === 'yellow',
      'border-orange-400': color === 'orange',
    }"
  >
    <div class="flex flex-col gap-1 text-center">
      <span class="text-sm text-gray-500">{{ name }}</span>
      <span class="text-lg font-semibold">{{ count || 0 }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type colors from '#ui-colors'

export type Color = typeof colors[number]

defineProps<{
  name: string
  count?: number
  color?: Color
}>()
</script>
