import { readFileSync } from 'node:fs'

import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import { createTwoslashHighlighter } from '@foldocs/twoslash'
import { foldocs } from '@foldocs/vite'

import docs from './foldocs.config.js'
import {
  markdownIslandDefinitions,
  markdownIslands,
} from './src/markdown-islands.js'
import { mdxComponents } from './src/mdx-components.js'

export default defineConfig({
  plugins: [
    foldocs({
      ...docs,
      components: mdxComponents,
      islands: markdownIslands,
      markdownOptions: { islands: markdownIslandDefinitions },
      highlightCode: createTwoslashHighlighter(),
      // The share card carries the Foldcase mark, read from the one copy of it
      // in docs/brand/. Foldocs strips the fills and recolours it to the card's
      // own ink, so the light file is the right one to hand over.
      og: {
        logoSvg: readFileSync(
          new URL('../brand/mark.svg', import.meta.url),
          'utf8',
        ),
      },
    }),
    foldkit(),
  ],
  build: {
    rolldownOptions: {
      output: {
        manualChunks: id => {
          if (
            id.includes('/node_modules/.pnpm/effect@') ||
            id.includes('/node_modules/effect/')
          )
            return 'effect'
          if (
            id.includes('/node_modules/.pnpm/foldkit@') ||
            id.includes('/node_modules/foldkit/')
          )
            return 'foldkit'
          return undefined
        },
      },
    },
  },
})
