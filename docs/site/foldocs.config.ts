import { defineConfig } from 'foldocs'

export default defineConfig({
  site: {
    title: 'Foldcase',
    description:
      'One typed record per component state — read by your coding agent, your CI, your docs, and your coverage.',
    // The Worker `mise run docs:deploy` creates. Absolute links in the sitemap,
    // the OG tags and llms.txt are built from this, so it has to be the real one.
    baseUrl: 'https://foldcase-docs.1st-account.workers.dev',
    logoText: 'Foldcase',
    tagline:
      'One typed record per component state — read by your coding agent, your CI, your docs, and your coverage.',
    githubUrl: 'https://github.com/tao-io/foldcase',
    keywords: ['Foldcase', 'Foldkit', 'Effect', 'Showcase', 'testing', 'MCP'],
    // Copied out of docs/brand/ by scripts/sync-content.mjs, never committed
    // here — the brand directory is the one copy of every mark.
    favicon: '/brand/favicon.svg',
    locale: 'en',
  },
  i18n: {
    defaultLocale: 'en',
    fallbackLocale: 'en',
    locales: [{ locale: 'en', name: 'English' }],
  },
  basePath: '/docs',
  layout: { preset: 'docs' },
  landing: {
    sections: ['hero', 'overview', 'features', 'cta'],
    headline: 'One typed record per component state.',
    description:
      'A Showcase is data, not a function: your coding agent, your CI, your docs, and your coverage all read the same declaration.',
    command: 'bun add -d foldcase@alpha',
    footer: {
      author: 'tao-io',
      authorUrl: 'https://github.com/tao-io',
    },
  },
  content: { dir: 'content/docs' },
  llms: true,
  markdown: true,
  sitemap: true,
  og: true,
  prerender: true,
  search: { staticIndex: true },
})
