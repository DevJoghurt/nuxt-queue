<template>
  <component :is="noCard ? 'div' : UCard">
    <template v-if="!noCard" #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-webhook"
          class="w-5 h-5 text-purple-500"
        />
        <h2 class="text-lg font-semibold">
          Webhook Configuration
        </h2>
      </div>
    </template>

    <UForm
      nested
      :name="name"
      :schema="schema"
      :class="noCard ? 'space-y-6' : 'space-y-4'"
    >
      <UFormField
        label="Webhook Path"
        name="path"
        required
      >
        <template #hint>
          <span class="text-xs text-gray-500">The URL path where this webhook will listen</span>
        </template>
        <UInput
          v-model="config.path"
          placeholder="/webhooks/my-trigger"
          icon="i-lucide-link"
        />
      </UFormField>

      <UFormField
        label="HTTP Method"
        name="method"
      >
        <template #hint>
          <span class="text-xs text-gray-500">The HTTP method to accept</span>
        </template>
        <USelectMenu
          v-model="config.method"
          :items="['GET', 'POST', 'PUT', 'PATCH', 'DELETE']"
          placeholder="Select method"
        />
      </UFormField>

      <UFormField
        label="Authentication"
        name="requireAuth"
      >
        <ClientOnly>
          <UCheckbox
            v-model="config.requireAuth"
            label="Require authentication"
          />
        </ClientOnly>
      </UFormField>

      <UFormField
        v-if="config.requireAuth"
        label="Auth Header Name"
        name="authHeader"
      >
        <template #hint>
          <span class="text-xs text-gray-500">The header name to check for authentication</span>
        </template>
        <UInput
          v-model="config.authHeader"
          placeholder="X-API-Key"
          icon="i-lucide-key"
        />
      </UFormField>
    </UForm>
  </component>
</template>

<script setup lang="ts">
import { UCard } from '#components'
import { z } from 'zod'

const { noCard = false, name = 'webhook' } = defineProps<{
  noCard?: boolean
  name?: string
}>()

const config = defineModel<{
  path: string
  method: string
  requireAuth: boolean
  authHeader: string
}>({ required: true })

const schema = z.object({
  path: z.string().min(1, 'Webhook path is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  requireAuth: z.boolean(),
  authHeader: z.string().optional(),
})
</script>
