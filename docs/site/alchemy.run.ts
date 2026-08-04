// Deploys the built site to Cloudflare, the way foldocs deploys its own docs:
// an `alchemy/cloudflare` Website, which puts `dist/` behind a Worker as
// static assets. Driven by `mise run docs:deploy`.
//
// The build command is the mise task rather than a second copy of the build,
// so the two cannot drift. Credentials never live here: `alchemy login` keeps
// an OAuth token outside the repository, and CI passes CLOUDFLARE_API_TOKEN in
// the environment.
import alchemy from 'alchemy'
import { Website } from 'alchemy/cloudflare'
import { CloudflareStateStore } from 'alchemy/state'

const app = await alchemy(
  'foldcase-docs',
  process.env.ALCHEMY_STATE_TOKEN
    ? {
        stateStore: scope => new CloudflareStateStore(scope),
      }
    : undefined,
)

export const website = await Website('website', {
  name: 'foldcase-docs',
  build: 'mise run docs:build',
  dev: 'mise run docs:dev',
  assets: {
    directory: './dist',
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'none',
  },
  spa: false,
})

console.log({ url: website.url })

await app.finalize()
