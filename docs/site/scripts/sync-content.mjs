// Derives content/docs/en from this repository's own prose.
//
// The site holds no copy of it. README.md, CHANGELOG.md and docs/adr/*.md are
// read from the working tree two directories up and projected into foldocs
// pages on every build; `docs/site/content/` is gitignored, so a drifted copy
// cannot even be committed. There is no pin to bump and no window in which the
// site and the repository disagree: they are the same files.
//
// This is ADR-0001 ("one definition, many surfaces") applied to the prose, and
// it is the reason ADR-0003 keeps the site in this repository rather than in a
// second one.
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(site, '..', '..')
const out = join(site, 'content', 'docs', 'en')

const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const blob = path => `https://github.com/tao-io/foldcase/blob/${commit}/${path}`

// ── markdown helpers ─────────────────────────────────────────────────────────

/** GitHub's heading-anchor algorithm, close enough for these documents. */
const githubSlug = heading => {
  const text = heading.replace(/`/g, '')
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/ /g, '-')
}

/** Split a document into [line, insideCodeFence] pairs. */
const withFenceState = lines => {
  let fence = null
  return lines.map(line => {
    const open = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence === null && open) {
      fence = open[1][0].repeat(3)
      return [line, true]
    }
    if (fence !== null && open && open[1].startsWith(fence)) {
      fence = null
      return [line, true]
    }
    return [line, fence !== null]
  })
}

const headingsOf = markdown =>
  withFenceState(markdown.split('\n'))
    .filter(([line, inFence]) => !inFence && /^#{1,6} /.test(line))
    .map(([line]) => line.replace(/^#+ /, '').trim())

/** First paragraph line, stripped to plain text, for a frontmatter description. */
const descriptionOf = markdown => {
  // A real block marker is the character *and* its space — `**bold**` opening a
  // paragraph is prose, not a list, and skipping it took the second line of the
  // paragraph as the description.
  const BLOCK = /^(#{1,6} |[-*+] |> |\d+\. |\||`{3,})/
  const lines = withFenceState(markdown.split('\n'))
  const start = lines.findIndex(
    ([text, inFence]) => !inFence && text.trim() !== '' && !BLOCK.test(text.trim()),
  )
  if (start < 0) return ''
  // The whole paragraph, not its first line: this prose is hard-wrapped, so one
  // line ends mid-sentence and reads as a truncation.
  const paragraph = []
  for (const [text, inFence] of lines.slice(start)) {
    if (inFence || text.trim() === '') break
    paragraph.push(text.trim())
  }
  const plain = paragraph
    .join(' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim()
  return plain.length > 160 ? `${plain.slice(0, 157)}...` : plain
}

/**
 * Foldocs' markdown pipeline rejects reference-style links, and Keep a
 * Changelog uses them (`## [0.1.0]` ... `[0.1.0]: url`). Resolve every
 * definition into inline links and drop the definition lines.
 */
const inlineReferenceLinks = markdown => {
  const annotated = withFenceState(markdown.split('\n'))
  const definitions = {}
  for (const [line, inFence] of annotated) {
    const match = !inFence && /^\[([^\]]+)\]:\s*(\S+)\s*$/.exec(line)
    if (match) definitions[match[1].toLowerCase()] = match[2]
  }
  return annotated
    .filter(
      ([line, inFence]) => inFence || !/^\[([^\]]+)\]:\s*\S+\s*$/.test(line),
    )
    .map(([line, inFence]) =>
      inFence
        ? line
        : line
            .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (all, text, label) => {
              const url = definitions[(label || text).toLowerCase()]
              return url ? `[${text}](${url})` : all
            })
            .replace(/\[([^\]]+)\](?![([:])/g, (all, text) => {
              const url = definitions[text.toLowerCase()]
              return url ? `[${text}](${url})` : all
            }),
    )
    .join('\n')
}

/**
 * Drop raw HTML blocks. A README carries presentation markup that only GitHub
 * reads — a centred `<p>` around the mark, say — and the site draws its own
 * header, so the block is noise here at best and an unsupported markdown node
 * at worst.
 */
const withoutHtmlBlocks = markdown => {
  const lines = withFenceState(markdown.split('\n'))
  const kept = []
  let closing = null
  for (const [line, inFence] of lines) {
    if (closing !== null) {
      if (!inFence && line.includes(closing)) closing = null
      continue
    }
    // `<!-- site:skip -->` … `<!-- /site:skip -->` marks prose that only makes
    // sense on GitHub — a link to this very site, for one. The markers are HTML
    // comments, so GitHub shows nothing where they sit.
    if (!inFence && line.trim() === '<!-- site:skip -->') {
      closing = '<!-- /site:skip -->'
      continue
    }
    if (!inFence && /^<!--/.test(line.trim())) continue
    const open = !inFence && /^<([a-z][\w-]*)(\s|>)/.exec(line)
    if (open) {
      closing = `</${open[1]}>`
      if (line.includes(closing)) closing = null
      continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}

const yaml = value => `'${value.replace(/'/g, "''")}'`

const page = (title, description, order, body) =>
  [
    '---',
    `title: ${yaml(title)}`,
    ...(description ? [`description: ${yaml(description)}`] : []),
    ...(order === undefined ? [] : [`order: ${order}`]),
    '---',
    '',
    body.trim(),
    '',
  ].join('\n')

// ── link rewriting ───────────────────────────────────────────────────────────

/**
 * Rewrite one link target from repository coordinates to site coordinates.
 * `anchors` maps a GitHub heading anchor to the site route that now holds it.
 */
const rewriteTarget = (
  target,
  { anchors = {}, selfRoute = '', adrRoutes = {}, assets = [] },
) => {
  if (/^(https?:|mailto:)/.test(target)) return target
  if (target.startsWith('#')) {
    const route = anchors[target.slice(1)]
    return route && route !== selfRoute ? `${route}${target}` : target
  }
  const clean = target.replace(/^\.\//, '')
  const [path, anchor] = clean.split('#')
  const adr = /^docs\/adr\/([\w-]+)\.md$/.exec(path)
  if (adr && adrRoutes[adr[1]]) {
    return adrRoutes[adr[1]] + (anchor ? `#${anchor}` : '')
  }
  // A brand file the site serves itself, so the page can show the real mark
  // rather than link away to GitHub for it.
  if (assets.includes(path)) return `/brand/${path}`
  return blob(clean)
}

const rewriteLinks = (markdown, context) =>
  withFenceState(markdown.split('\n'))
    .map(([line, inFence]) =>
      inFence
        ? line
        : line.replace(
            /\]\(([^)\s]+)\)/g,
            (_, target) => `](${rewriteTarget(target, context)})`,
          ),
    )
    .join('\n')

// ── read the definition ──────────────────────────────────────────────────────

const readme = withoutHtmlBlocks(
  inlineReferenceLinks(readFileSync(join(source, 'README.md'), 'utf8')),
)
const changelog = inlineReferenceLinks(
  readFileSync(join(source, 'CHANGELOG.md'), 'utf8'),
)
const adrDir = join(source, 'docs', 'adr')
const adrFiles = readdirSync(adrDir)
  .filter(file => file.endsWith('.md'))
  .sort()

const brandDir = join(source, 'docs', 'brand')
const brand = inlineReferenceLinks(readFileSync(join(brandDir, 'README.md'), 'utf8'))
const brandAssets = readdirSync(brandDir).filter(file => file.endsWith('.svg'))

// Split the README into the intro and one chunk per `## ` section.
const lines = withFenceState(readme.split('\n'))
const cuts = lines.flatMap(([line, inFence], index) =>
  !inFence && line.startsWith('## ') ? [index] : [],
)
const intro = lines
  .slice(0, cuts[0])
  .map(([line]) => line)
  .join('\n')
const sections = cuts.map((cut, i) => {
  const body = lines
    .slice(cut, cuts[i + 1] ?? lines.length)
    .map(([line]) => line)
    .join('\n')
  const heading = lines[cut][0].replace(/^## /, '').trim()
  return { heading, slug: githubSlug(heading), body }
})

// Every README anchor, mapped to the page that will hold its heading.
const route = slug => `/en/docs/${slug}`
const anchors = {}
for (const heading of headingsOf(intro))
  anchors[githubSlug(heading)] = route('index')
for (const section of sections) {
  for (const heading of headingsOf(section.body)) {
    anchors[githubSlug(heading)] ??= route(section.slug)
  }
}

const adrRoutes = {}
for (const file of adrFiles)
  adrRoutes[file.replace(/\.md$/, '')] = route(
    `adr/${file.replace(/\.md$/, '')}`,
  )

// ── write the surface ────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'adr'), { recursive: true })

writeFileSync(
  join(out, 'index.md'),
  page(
    'Foldcase',
    descriptionOf(intro),
    undefined,
    rewriteLinks(intro, { anchors, selfRoute: route('index'), adrRoutes }),
  ),
)

/**
 * The page header already shows the description; when the first paragraph after
 * the H1 is a single line and *is* the description, drop it from the body so it
 * does not read twice.
 */
const withoutRepeatedDescription = (markdown, description) => {
  const body = markdown.split('\n')
  const first = body.findIndex((line, i) => i > 0 && line.trim() !== '')
  const isLoneParagraph =
    first > 0 &&
    (body[first + 1] ?? '').trim() === '' &&
    descriptionOf(body[first]) === description
  return (isLoneParagraph ? body.toSpliced(first, 1) : body).join('\n')
}

sections.forEach((section, index) => {
  // Promote the section to a page: its `##` becomes the H1, `###` becomes `##`.
  const promoted = withFenceState(section.body.split('\n'))
    .map(([line, inFence]) =>
      !inFence && /^##+ /.test(line) ? line.slice(1) : line,
    )
    .join('\n')
  const description = descriptionOf(
    section.body.split('\n').slice(1).join('\n'),
  )
  const deduped = withoutRepeatedDescription(promoted, description)
  writeFileSync(
    join(out, `${section.slug}.md`),
    page(
      section.heading,
      description,
      index + 1,
      rewriteLinks(deduped, {
        anchors,
        selfRoute: route(section.slug),
        adrRoutes,
      }),
    ),
  )
})

writeFileSync(
  join(out, 'changelog.md'),
  page(
    'Changelog',
    descriptionOf(changelog),
    undefined,
    rewriteLinks(changelog, { adrRoutes }),
  ),
)

// The brand page, and the files it draws. The site serves the real SVGs out of
// public/brand/ — copied, never committed — so the page shows the mark instead
// of linking away to it, and there is still only one copy of each file in git.
const publicBrand = join(site, 'public', 'brand')
rmSync(publicBrand, { recursive: true, force: true })
mkdirSync(publicBrand, { recursive: true })
for (const asset of brandAssets) {
  copyFileSync(join(brandDir, asset), join(publicBrand, asset))
}

const brandDescription = descriptionOf(brand.split('\n').slice(1).join('\n'))

writeFileSync(
  join(out, 'brand.md'),
  page(
    'The mark',
    brandDescription,
    undefined,
    rewriteLinks(withoutRepeatedDescription(brand, brandDescription), {
      selfRoute: route('brand'),
      assets: brandAssets,
    }),
  ),
)

for (const file of adrFiles) {
  const slug = file.replace(/\.md$/, '')
  const raw = readFileSync(join(adrDir, file), 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  const front = Object.fromEntries(
    (match ? match[1] : '')
      .split('\n')
      .map(line => /^(\w+): (.*)$/.exec(line))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  )
  const body = inlineReferenceLinks((match ? match[2] : raw).trim())
  const note = front.status
    ? `> Status: **${front.status}** · created ${front.created ?? '?'} · updated ${front.updated ?? '?'}\n\n`
    : ''
  writeFileSync(
    join(out, 'adr', `${slug}.md`),
    page(
      front.title ?? slug,
      front.description ?? '',
      undefined,
      note + rewriteLinks(body, { selfRoute: adrRoutes[slug], adrRoutes }),
    ),
  )
}

writeFileSync(
  join(out, 'adr', 'meta.json'),
  `${JSON.stringify(
    {
      title: 'Decisions (ADRs)',
      icon: 'scale',
      defaultOpen: false,
      pages: adrFiles.map(file => file.replace(/\.md$/, '')),
    },
    null,
    2,
  )}\n`,
)

writeFileSync(
  join(out, 'meta.json'),
  `${JSON.stringify(
    {
      title: 'Documentation',
      pages: [
        '---Guide---',
        'index',
        ...sections.map(section => section.slug),
        '---Project---',
        'changelog',
        'adr',
        'brand',
      ],
    },
    null,
    2,
  )}\n`,
)

console.log(
  `Derived ${2 + sections.length + 1 + adrFiles.length} pages and ${brandAssets.length} brand files from tao-io/foldcase@${commit.slice(0, 7)}`,
)
