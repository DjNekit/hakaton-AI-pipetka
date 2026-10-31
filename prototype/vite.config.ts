import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    semi: false,
    printWidth: 80,
    arrowParens: 'avoid',
    singleQuote: true,
    sortImports: true,
    ignorePatterns: ['**/*.gen.ts'],
    sortTailwindcss: {
      stylesheet: './src/shared/ui/styles/globals.css',
      functions: ['clsx', 'cn'],
      preserveWhitespace: true,
    },
  },
  lint: {
    jsPlugins: [
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
      './fsd.mjs',
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'fsd/boundaries': 'error',
    },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ['**/*.gen.ts'],
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro(),
    tailwindcss(),
    tanstackStart({
      router: {
        entry: 'shared/router/index',
        routesDirectory: 'pages',
        generatedRouteTree: 'shared/router/routeTree.gen.ts',
      },
    }),
    viteReact(),
  ],
})
