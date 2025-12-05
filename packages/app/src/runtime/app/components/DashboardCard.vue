<template>
  <div
    :class="[
      'rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow cursor-pointer',
      gradientClass,
    ]"
    @click="onClick"
  >
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <div class="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
          <UIcon
            :name="icon"
            class="w-6 h-6"
          />
        </div>
        <div class="text-sm opacity-75">
          {{ title }}
        </div>
      </div>
      <UIcon
        name="i-lucide-arrow-right"
        class="w-5 h-5 opacity-60"
      />
    </div>

    <!-- Primary Stats (Live Data - Large) -->
    <div class="flex items-baseline gap-4 mb-4 flex-wrap min-h-[3rem]">
      <div
        v-for="stat in primaryStats"
        :key="stat.label"
        class="flex items-baseline gap-2"
      >
        <div class="text-4xl font-bold">
          {{ stat.value }}
        </div>
        <div class="text-sm opacity-90">
          {{ stat.label }}
        </div>
      </div>
    </div>

    <!-- Secondary Stats (Static/Context - Small) -->
    <div class="flex items-center gap-3 text-xs opacity-75">
      <div
        v-for="stat in secondaryStats"
        :key="stat.label"
      >
        <span class="font-semibold">{{ stat.value }}</span> {{ stat.label }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from '#imports'

interface Stat {
  value: string | number
  label: string
}

interface Props {
  icon: string
  title: string
  primaryStats: Stat[]
  secondaryStats?: Stat[]
  color: 'blue' | 'purple' | 'amber' | 'emerald' | 'red'
  onClick?: () => void
}

const props = withDefaults(defineProps<Props>(), {
  secondaryStats: () => [],
  onClick: () => {},
})

const gradientClass = computed(() => {
  const colors = {
    blue: 'bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700',
    purple: 'bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700',
    amber: 'bg-gradient-to-br from-amber-500 to-amber-600 dark:from-amber-600 dark:to-amber-700',
    emerald: 'bg-gradient-to-br from-emerald-500 to-emerald-600 dark:from-emerald-600 dark:to-emerald-700',
    red: 'bg-gradient-to-br from-red-500 to-red-600 dark:from-red-600 dark:to-red-700',
  }
  return colors[props.color]
})
</script>
