<template>
  <div class="space-y-4">
    <div v-if="!schedules || schedules.length === 0">
      <UAlert
        color="info"
        title="No schedules configured"
        variant="subtle"
        icon="i-lucide-info"
        description="Create a schedule to run this flow automatically"
      />
    </div>

    <div
      v-for="schedule in schedules"
      :key="schedule.id"
      class="border border-gray-200 dark:border-gray-800 rounded-lg p-4"
    >
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-2">
            <UIcon
              name="i-lucide-clock"
              class="text-blue-500"
            />
            <span class="font-medium text-sm">
              {{ schedule.schedule.cron || 'One-time delay' }}
            </span>
          </div>
          <div class="text-xs text-gray-500 space-y-1">
            <div>
              <span class="font-medium">Next run:</span>
              {{ formatDate(schedule.nextRun) }}
            </div>
            <div v-if="schedule.metadata?.description">
              <span class="font-medium">Description:</span>
              {{ schedule.metadata.description }}
            </div>
          </div>
        </div>
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="xs"
          :loading="deletingId === schedule.id"
          @click="handleDelete(schedule.id)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from '#imports'
import { UAlert, UButton, UIcon } from '#components'

const props = defineProps<{
  flowName: string
}>()

const emit = defineEmits<{
  updated: []
}>()

const schedules = ref<any[]>([])
const deletingId = ref<string | null>(null)

const loadSchedules = async () => {
  try {
    const data = await $fetch<any[]>(`/api/_flows/${props.flowName}/schedules`)
    schedules.value = data
  }
  catch (error) {
    console.error('Failed to load schedules:', error)
    schedules.value = []
  }
}

const handleDelete = async (id: string) => {
  deletingId.value = id
  try {
    await $fetch(`/api/_flows/${props.flowName}/schedules/${id}`, {
      method: 'DELETE',
    })
    await loadSchedules()
    emit('updated')
  }
  catch (error) {
    console.error('Failed to delete schedule:', error)
  }
  finally {
    deletingId.value = null
  }
}

const formatDate = (date?: string) => {
  if (!date)
    return 'N/A'
  return new Date(date).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

onMounted(() => {
  loadSchedules()
})

defineExpose({
  loadSchedules,
})
</script>
