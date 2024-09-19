# Nuxt Queue Module

BullMQ integration for Nuxt. Comes with an API for the programmatic management of queues and workers. Offers its own user interface based on `@nuxt/ui`, which can be integrated as a component.

This module offers a dedicated build process for running and scaling workers in seperate processes on the server. Nethertheless it is deep integrated with the Nuxt framework to achive a great developer usability.

## ✅ Status

Currently in developing mode, wip.

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

As the UI components are based on `@nuxt/ui`, you have to install this module seperatley and add it to `nuxt.config`.

```ts
{
  modules: [
    'nuxt-queue'
    '@nuxt/ui',
  ],
}
```

Since this module uses the `tailwindcss:config` hook, it must be registered before `@nuxt/ui`.

Use the component in your application:

```vue
<template>
  <div>
    <QueueApp />
  </div>
</template>
```

## ROADMAP

- Add more features to UI
- Save memory by not loading queue instances in memory
- Flow support + UI ([Vue Flow](https://vueflow.dev/))


## ©️ License

[MIT License](./LICENSE) - Copyright (c) DevJoghurt