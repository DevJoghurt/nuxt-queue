import type {
  OutputOptions as RollupOutputOptions,
  InputOptions as RollupInputOptions,
  Plugin } from 'rollup'
import unimportPlugin from 'unimport/unplugin'
import type { NitroOptions } from 'nitropack'
import esbuild from 'rollup-plugin-esbuild'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import circularDependencies from 'rollup-plugin-circular-dependencies'
import { externals, type NodeExternalsOptions } from './externals'

export type RollupConfig = RollupInputOptions & {
  output: RollupOutputOptions
  plugins: Plugin[]
}

type Options = {
  buildDir: string
  nitro: NitroOptions
}

type EntryFiles = Record<string, string>

export function getRollupConfig(entryFiles: EntryFiles, options: Options): RollupConfig {
  const extensions: string[] = [
    '.ts',
    '.mjs',
    '.js',
    '.json',
    '.node',
    '.tsx',
    '.jsx',
  ]

  const outDir = options.nitro.dev ? options.buildDir : options.nitro.output.dir

  const rollupConfig = {
    input: entryFiles,
    output: {
      dir: `${outDir}/worker`,
      inlineDynamicImports: false,
      format: 'esm',
      exports: 'auto',
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/chunk_[hash].mjs',
      intro: '',
      outro: '',
      generatedCode: {
        constBindings: true,
      },
    },
    makeAbsoluteExternalsRelative: false,
    plugins: [
      json(),
      circularDependencies(),
    ],
  } as RollupConfig

  // add nitro compatible auto imports
  if (options.nitro.imports) {
    rollupConfig.plugins.push(
      unimportPlugin.rollup(options.nitro.imports) as Plugin,
    )
  }

  rollupConfig.plugins.push(
    esbuild({
      target: 'es2019',
      exclude: [/node_modules/],
    }),
  )

  // https://github.com/rollup/plugins/tree/master/packages/node-resolve
  rollupConfig.plugins.push(
    nodeResolve({
      extensions,
      preferBuiltins: !!options.nitro.node,
      rootDir: options.nitro.rootDir,
      modulePaths: options.nitro.nodeModulesDirs,
      // 'module' is intentionally not supported because of externals
      mainFields: ['main'],
      exportConditions: options.nitro.exportConditions,
    }),
  )

  // https://github.com/rollup/plugins/tree/master/packages/commonjs
  rollupConfig.plugins.push(
    commonjs({
      requireReturnsDefault: 'auto',
    }),
  )

  // Do not externalize in dev mode, but
  rollupConfig.plugins.push(
    externals(
          <NodeExternalsOptions>{
            outDir: `${outDir}/worker`,
            moduleDirectories: options.nitro.nodeModulesDirs,
            external: [
              ...(options.nitro.dev ? [options.nitro.buildDir] : []),
              ...options.nitro.nodeModulesDirs,
            ],
            inline: [
              '#',
              '~',
              '@/',
              '~~',
              '@@/',
              'virtual:',
            ],
            traceOptions: {
              base: '/',
              processCwd: options.nitro.rootDir,
              exportsOnly: true,
            },
            traceAlias: {
            },
            exportConditions: options.nitro.exportConditions,
          }),
  )

  // add nitro alias
  /*
    rollupConfig.plugins.push(
        alias({
          entries: options.nitro.alias,
        })
      );
    */
  return rollupConfig
}
