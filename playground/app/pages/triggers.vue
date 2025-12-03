<script setup lang="ts">
import { ref, watch, useToast } from '#imports'

const toast = useToast()

interface FlowExample {
  id: string
  name: string
  description: string
  trigger: string
  testData: Record<string, any>
  awaitType: string
  instructions: string
}

// Flow examples with descriptions
const flowExamples: FlowExample[] = [
  {
    id: 'webhook-approval',
    name: 'Webhook Approval Flow',
    description: 'Demonstrates awaitBefore with webhook. Step waits for webhook call to proceed.',
    trigger: 'manual.webhook-approval',
    testData: {
      requestedBy: 'John Doe',
      amount: 5000,
      reason: 'Budget approval needed',
    },
    awaitType: 'webhook',
    instructions: 'After starting, copy the webhook URL from console and call it with approval data.',
  },
  {
    id: 'notification-delay',
    name: 'Notification with Time Delay',
    description: 'Demonstrates awaitAfter with time delay. Flow pauses for 10 seconds before next step.',
    trigger: 'manual.notification-test',
    testData: {
      recipient: 'user@example.com',
      message: 'This is a test notification',
    },
    awaitType: 'time',
    instructions: 'Flow will pause for 10 seconds after sending notification.',
  },
  {
    id: 'order-processing',
    name: 'Order Processing with Event',
    description: 'Demonstrates awaitBefore with event. Waits for payment.completed event.',
    trigger: 'manual.order-test',
    testData: {
      items: ['Item 1', 'Item 2'],
      total: 100,
    },
    awaitType: 'event',
    instructions: 'After starting, emit payment.completed event using the form below.',
  },
]

const selectedFlow = ref<FlowExample>(flowExamples[0]!)
const testDataJson = ref(JSON.stringify(selectedFlow.value.testData, null, 2))
const isStarting = ref(false)
const lastFlowId = ref<string | null>(null)

// Webhook testing
const webhookUrl = ref('/api/_webhook/await/approve/{runId}/{stepName}')
const webhookPayload = ref(JSON.stringify({
  approved: true,
  approvedBy: 'Manager',
  comment: 'Approved for processing',
}, null, 2))
const isCallingWebhook = ref(false)

// Event testing
const eventName = ref('payment.completed')
const eventPayload = ref(JSON.stringify({
  amount: 100,
  paymentMethod: 'credit_card',
  transactionId: 'txn_123',
}, null, 2))
const isEmittingEvent = ref(false)

// Update test data when flow changes
watch(selectedFlow, (newFlow) => {
  testDataJson.value = JSON.stringify(newFlow.testData, null, 2)
})

async function startFlow() {
  try {
    isStarting.value = true

    const testData = JSON.parse(testDataJson.value)

    const response = await $fetch('/api/test/trigger/fire', {
      method: 'POST',
      body: {
        triggerName: selectedFlow.value.trigger,
        data: testData,
      },
    })

    const result = response as any

    // Generate a pseudo flowId for webhook/event testing
    // In reality, the flow system generates UUIDs, but we'll use timestamp for simplicity
    lastFlowId.value = `flow-${Date.now()}`

    toast.add({
      title: 'Trigger Fired',
      description: `${result.subscribedFlows?.length || 0} flow(s) will start. Check console for details.`,
      color: 'success',
    })

    console.log('Trigger fired:', result)
  }
  catch (error: any) {
    toast.add({
      title: 'Error',
      description: error.message || 'Failed to fire trigger',
      color: 'error',
    })
  }
  finally {
    isStarting.value = false
  }
}

async function callWebhook() {
  try {
    isCallingWebhook.value = true

    const url = webhookUrl.value

    // Note: The actual runId and stepName should be copied from console logs
    // where they are displayed when the await is registered
    const payload = JSON.parse(webhookPayload.value)

    const response = await $fetch(url, {
      method: 'POST',
      body: payload,
    })

    toast.add({
      title: 'Webhook Called',
      description: 'Approval webhook executed successfully. Flow should continue.',
      color: 'success',
    })

    console.log('Webhook response:', response)
  }
  catch (error: any) {
    toast.add({
      title: 'Webhook Error',
      description: error.data?.message || error.message || 'Failed to call webhook',
      color: 'error',
    })
  }
  finally {
    isCallingWebhook.value = false
  }
}

async function emitEvent() {
  try {
    isEmittingEvent.value = true

    const payload = JSON.parse(eventPayload.value)

    const response = await $fetch('/api/test/emit-event', {
      method: 'POST',
      body: {
        eventName: eventName.value,
        payload,
      },
    })

    toast.add({
      title: 'Event Emitted',
      description: `Event ${eventName.value} published`,
      color: 'success',
    })

    console.log('Event response:', response)
  }
  catch (error: any) {
    toast.add({
      title: 'Event Error',
      description: error.message || 'Failed to emit event',
      color: 'error',
    })
  }
  finally {
    isEmittingEvent.value = false
  }
}
</script>

<template>
  <div class="p-8">
    <div class="max-w-6xl mx-auto">
      <h1 class="text-3xl font-bold mb-2">
        Trigger & Await Pattern Testing
      </h1>
      <p class="text-gray-600 dark:text-gray-400 mb-8">
        Test different flow patterns: webhook approval, time delays, and event-driven workflows
      </p>

      <!-- Flow Selection -->
      <UCard class="mb-6">
        <template #header>
          <h2 class="text-xl font-semibold">
            Select Flow Example
          </h2>
        </template>

        <USelectMenu
          v-model="selectedFlow"
          :items="flowExamples"
          label-key="name"
          class="mb-4"
        >
          <template #default="{ modelValue }">
            <div v-if="modelValue">
              <div class="font-medium">
                {{ modelValue.name }}
              </div>
              <div class="text-sm text-gray-500">
                {{ modelValue.description }}
              </div>
            </div>
          </template>
        </USelectMenu>

        <UAlert
          :title="selectedFlow.instructions"
          color="info"
          variant="soft"
          class="mb-4"
        />

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">Test Data (JSON)</label>
            <UTextarea
              v-model="testDataJson"
              :rows="6"
              placeholder="Enter test data as JSON"
              class="font-mono text-sm"
            />
          </div>

          <UButton
            color="primary"
            size="lg"
            :loading="isStarting"
            @click="startFlow"
          >
            Start Flow
          </UButton>

          <div
            v-if="lastFlowId"
            class="text-sm text-gray-600 dark:text-gray-400"
          >
            Last triggered: <code class="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{{ new Date().toLocaleTimeString() }}</code>
            <p class="mt-1 text-xs">
              Check server console for actual flowId and webhook URLs
            </p>
          </div>
        </div>
      </UCard>

      <!-- Webhook Testing (for webhook approval flow) -->
      <UCard
        v-if="selectedFlow.awaitType === 'webhook'"
        class="mb-6"
      >
        <template #header>
          <h2 class="text-xl font-semibold">
            Call Webhook
          </h2>
        </template>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">Webhook URL</label>
            <UInput
              v-model="webhookUrl"
              placeholder="/api/_webhook/await/..."
            />
            <p class="text-xs text-gray-500 mt-1">
              {runId} and {stepName} will be replaced automatically if a flow is running
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">Webhook Payload (JSON)</label>
            <UTextarea
              v-model="webhookPayload"
              :rows="6"
              placeholder="Enter webhook payload as JSON"
              class="font-mono text-sm"
            />
          </div>

          <UButton
            color="success"
            :loading="isCallingWebhook"
            @click="callWebhook"
          >
            Call Webhook
          </UButton>

          <p class="text-sm text-orange-600">
            <strong>Important:</strong> Copy the actual webhook URL from server console logs after starting the flow
          </p>
        </div>
      </UCard>

      <!-- Event Testing (for event-driven flow) -->
      <UCard
        v-if="selectedFlow.awaitType === 'event'"
        class="mb-6"
      >
        <template #header>
          <h2 class="text-xl font-semibold">
            Emit Event
          </h2>
        </template>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">Event Name</label>
            <UInput
              v-model="eventName"
              placeholder="payment.completed"
            />
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">Event Payload (JSON)</label>
            <UTextarea
              v-model="eventPayload"
              :rows="6"
              placeholder="Enter event payload as JSON"
              class="font-mono text-sm"
            />
          </div>

          <UButton
            color="success"
            :loading="isEmittingEvent"
            @click="emitEvent"
          >
            Emit Event
          </UButton>
        </div>
      </UCard>

      <!-- Instructions -->
      <UCard>
        <template #header>
          <h2 class="text-xl font-semibold">
            Testing Instructions
          </h2>
        </template>

        <div class="space-y-4 text-sm">
          <div>
            <h3 class="font-medium mb-2">
              1. Webhook Approval Flow
            </h3>
            <ol class="list-decimal list-inside space-y-1 text-gray-600 dark:text-gray-400">
              <li>Select "Webhook Approval Flow"</li>
              <li>Click "Start Flow"</li>
              <li>Check browser console for webhook URL</li>
              <li>Use the "Call Webhook" form to approve/deny</li>
              <li>Flow will continue or fail based on approval</li>
            </ol>
          </div>

          <div>
            <h3 class="font-medium mb-2">
              2. Notification with Time Delay
            </h3>
            <ol class="list-decimal list-inside space-y-1 text-gray-600 dark:text-gray-400">
              <li>Select "Notification with Time Delay"</li>
              <li>Click "Start Flow"</li>
              <li>Flow will pause for 10 seconds</li>
              <li>Next step runs automatically after delay</li>
            </ol>
          </div>

          <div>
            <h3 class="font-medium mb-2">
              3. Order Processing with Event
            </h3>
            <ol class="list-decimal list-inside space-y-1 text-gray-600 dark:text-gray-400">
              <li>Select "Order Processing with Event"</li>
              <li>Click "Start Flow"</li>
              <li>Order is created, waiting for payment event</li>
              <li>Use "Emit Event" form to send payment.completed</li>
              <li>Flow continues with order processing</li>
            </ol>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
