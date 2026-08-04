import { defineConfig } from 'foldocs'

export default defineConfig({
  site: {
    title: 'Foldcase',
    description:
      'One typed record per component state — read by your coding agent, your CI, your docs, and your coverage.',
    // Placeholder until the first `alchemy deploy` prints the real workers.dev URL.
    baseUrl: 'https://foldcase-docs.example.com',
    logoText: 'Foldcase',
    tagline:
      'One typed record per component state — read by your coding agent, your CI, your docs, and your coverage.',
    githubUrl: 'https://github.com/tao-io/foldcase',
    keywords: ['Foldcase', 'Foldkit', 'Effect', 'Showcase', 'testing', 'MCP'],
    favicon: '/favicon.svg',
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
