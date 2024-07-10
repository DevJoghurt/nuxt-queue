# Nuxt Queue Module

BullMQ integration for Nuxt with PM2 as process manager for worker.

To achive this behavior, this module offers a dedicated build process for running and scaling worker in seperate processes on the server. Nethertheless it is deep integrated with the Nuxt framework to achive a great developer usability.

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

## ROADMAP

- Flow support + UI ([Vue Flow](https://vueflow.dev/))


## ©️ License

[MIT License](./LICENSE) - Copyright (c) DevJoghurt