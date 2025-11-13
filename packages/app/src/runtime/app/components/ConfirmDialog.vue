<template>
  <UModal
    v-model:open="isOpen"
    :ui="{
      content: 'max-w-md',
    }"
  >
    <template #header>
      <div class="flex items-start gap-3">
        <div
          v-if="icon"
          class="shrink-0 rounded-full p-2"
          :class="iconColorClasses"
        >
          <UIcon
            :name="icon"
            class="size-5"
          />
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">
            {{ title }}
          </h3>
        </div>
      </div>
    </template>

    <template #body>
      <div class="space-y-3">
        <p
          v-if="description"
          class="text-sm text-gray-600 dark:text-gray-400"
        >
          {{ description }}
        </p>
        <ul
          v-if="items && items.length > 0"
          class="space-y-2 text-sm text-gray-600 dark:text-gray-400"
        >
          <li
            v-for="(item, index) in items"
            :key="index"
            class="flex items-start gap-2"
          >
            <UIcon
              name="i-lucide-circle"
              class="size-1.5 mt-1.5 shrink-0"
            />
            <span>{{ item }}</span>
          </li>
        </ul>
        <p
          v-if="warning"
          class="text-sm font-medium text-amber-600 dark:text-amber-400"
        >
          {{ warning }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="loading"
          @click="handleCancel"
        >
          {{ cancelLabel }}
        </UButton>
        <UButton
          :color="confirmColor"
          :loading="loading"
          @click="handleConfirm"
        >
          {{ confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed } from '#imports'
import { UModal, UButton, UIcon } from '#components'

interface Props {
  title: string
  description?: string
  items?: string[]
  warning?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: 'primary' | 'error' | 'warning' | 'success'
  icon?: string
  iconColor?: 'primary' | 'error' | 'warning' | 'success' | 'info'
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  confirmColor: 'primary',
  iconColor: 'primary',
})

const isOpen = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const iconColorClasses = computed(() => {
  switch (props.iconColor) {
    case 'error':
      return 'bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400'
    case 'warning':
      return 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
    case 'success':
      return 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
    case 'info':
      return 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
    default:
      return 'bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400'
  }
})

const handleConfirm = () => {
  emit('confirm')
}

const handleCancel = () => {
  isOpen.value = false
  emit('cancel')
}
</script>
