import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
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
  // Клиент — статика (SPA) на /new; серверная часть — сервис applications-api на /new/api.
  base: '/new/',
  server: {
    proxy: {
      '/new/api': process.env.VITE_APPLICATIONS_API ?? 'http://127.0.0.1:3100',
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/pages',
      generatedRouteTree: './src/shared/router/routeTree.gen.ts',
    }),
    tailwindcss(),
    viteReact(),
  ],
})
