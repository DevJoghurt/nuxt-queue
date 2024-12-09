# Nuxt Queue Module

BullMQ integration for Nuxt. Comes with an API for the programmatic management of queues and workers. Offers its own user interface based on `@nuxt/ui`, which can be integrated as a component.

This module offers a dedicated build process for running and scaling workers in separate processes on the server. Nevertheless, it is deeply integrated with the Nuxt framework to achieve great developer usability.

## ✅ Status

Currently in development mode, work in progress.

## 🚀 Usage

### Install

1. Add the following line to the `devDependencies` with your package manager:

```sh
npx nuxi@latest module add nuxt-queue
```

2. Add `nuxt-queue` to the `modules` section of `nuxt.config.ts`

```ts
{
  modules: [
    'nuxt-queue',
  ],
}
```

## Settings

The queue UI components can be enabled by setting config `queue.ui` to true.

```ts
{
  queue: {
    ui: true,
  },
}
```

As the UI components are based on `@nuxt/ui`, it will be installed alongside.

```ts
{
  modules: [
    'nuxt-queue'
  ],
}
```


Use the component in your application:

```vue
<template>
  <div>
    <QueueApp />
  </div>
</template>
```

## ROADMAP
- Better dev runtime support for worker (check new files for in-process and sandboxed worker)
- Add support for nuxt layers
- Dev types for external workers
- Test if it saves memory by not loading queue instances in memory
- Add queue steps as own worker handler -> Programmable with auto UI
- Add programmable flows for worker as UI and API ([Vue Flow](https://vueflow.dev/))


## ©️ License

[MIT License](./LICENSE) - Copyright (c) DevJoghurt