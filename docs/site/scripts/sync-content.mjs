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
  const line = withFenceState(markdown.split('\n')).find(
    ([text, inFence]) =>
      !inFence && text.trim() !== '' && !/^[#\-*>|]|^\d+\./.test(text.trim()),
  )
  if (!line) return ''
  const plain = line[0]
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
  { anchors = {}, selfRoute = '', adrRoutes = {} },
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

const readme = inlineReferenceLinks(
  readFileSync(join(source, 'README.md'), 'utf8'),
)
const changelog = inlineReferenceLinks(
  readFileSync(join(source, 'CHANGELOG.md'), 'utf8'),
)
const adrDir = join(source, 'docs', 'adr')
const adrFiles = readdirSync(adrDir)
  .filter(file => file.endsWith('.md'))
  .sort()

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

sections.forEach((section, index) => {
  // Promote the section to a page: its `##` becomes the H1, `###` becomes `##`.
  const promoted = withFenceState(section.body.split('\n'))
    .map(([line, inFence]) =>
      !inFence && /^##+ /.test(line) ? line.slice(1) : line,
    )
    .join('\n')
  // The page header already shows the description; when the first paragraph
  // after the H1 is a single line and IS the description, drop it from the
  // body so it does not read twice.
  const description = descriptionOf(
    section.body.split('\n').slice(1).join('\n'),
  )
  const body = promoted.split('\n')
  const first = body.findIndex((line, i) => i > 0 && line.trim() !== '')
  const isLoneParagraph =
    first > 0 &&
    (body[first + 1] ?? '').trim() === '' &&
    descriptionOf(body[first]) === description
  const deduped = (isLoneParagraph ? body.toSpliced(first, 1) : body).join('\n')
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
      ],
    },
    null,
    2,
  )}\n`,
)

console.log(
  `Derived ${1 + sections.length + 1 + adrFiles.length} pages from tao-io/foldcase@${commit.slice(0, 7)}`,
)
