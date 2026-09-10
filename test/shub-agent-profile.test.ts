import { ok, strictEqual } from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  catalogSelection,
  discoverProfiles,
  MAX_TOOL_DESCRIPTION_CHARS,
  parseProfile,
  projectProfileDirectory,
  toolDescription,
  type ShubProfile,
} from '../pi-extensions/shub-agents/profile.ts'

const KNOWN_TOOLS = new Set([
  'read',
  'edit',
  'write',
  'bash',
  'grep',
  'find',
  'ls',
  'fffind',
  'ffgrep',
])

function parse(raw: string): ReturnType<typeof parseProfile> {
  return parseProfile(raw, '/profiles/test.md', KNOWN_TOOLS)
}

const validProfile = `---
name: reviewer
description: Reviews code for correctness. Use after a non-trivial implementation.
tools: [read, fffind, ffgrep]
---

You are a senior code reviewer.
`

test('parses a valid profile with defaults', () => {
  const { profile, diagnostic } = parse(validProfile)

  ok(profile)
  strictEqual(diagnostic, undefined)
  strictEqual(profile.name, 'reviewer')
  strictEqual(profile.defaultEffort, 'standard')
  strictEqual(profile.projectContext, false)
  strictEqual(profile.model, undefined)
  strictEqual(profile.thinking, undefined)
  ok(profile.body.includes('senior code reviewer'))
  strictEqual(profile.sourcePath, '/profiles/test.md')
})

test('declared tools are validated and deduplicated', () => {
  const { profile } = parse(`---
name: reviewer
description: Reviews code. Use after implementation.
tools: [read, fffind, ffgrep, fffind, read]
---
Body.`)

  ok(profile)
  strictEqual(profile.tools.join(','), 'read,fffind,ffgrep')
})

test('unknown fields, unknown tools, and bad enums are errors', () => {
  for (
    const [raw, reason] of [
      [
        `---\nname: a\ndescription: Does things. Use when needed.\ntools: [read]\nvendor: x\n---\nBody.`,
        'unknown field',
      ],
      [
        `---\nname: a\ndescription: Does things. Use when needed.\ntools: [read, deploy]\n---\nBody.`,
        'unknown tool \'deploy\'',
      ],
      [
        `---\nname: A_B\ndescription: Does things. Use when needed.\ntools: [read]\n---\nBody.`,
        'name must be',
      ],
      [`---\nname: a\n---\nBody.`, 'description'],
      [`---\nname: a\ndescription: Does things. Use when needed.\n---\nBody.`, 'tools'],
      [
        `---\nname: a\ndescription: Does things. Use when needed.\ntools: [read]\nthinking: wildly\n---\nBody.`,
        'thinking',
      ],
      [
        `---\nname: a\ndescription: Does things. Use when needed.\ntools: [read]\ndefaultEffort: exhaustive\n---\nBody.`,
        'defaultEffort',
      ],
      [`no frontmatter here`, 'frontmatter'],
      [`---\nname: a\ndescription: Does things. Use when needed.\ntools: [read]\n---\n`, 'body'],
    ] as const
  ) {
    const { profile, diagnostic } = parse(raw)
    strictEqual(profile, undefined)
    ok(diagnostic?.reason.includes(reason), `${diagnostic?.reason} should mention ${reason}`)
  }
})

test('profile limits are enforced as data validation', () => {
  const longDescription = 'x'.repeat(201)
  const { diagnostic: descriptionDiagnostic } = parse(
    `---\nname: a\ndescription: ${longDescription}\ntools: [read]\n---\nBody.`,
  )
  ok(descriptionDiagnostic?.reason.includes('at most 200'))

  const { diagnostic: bodyDiagnostic } = parse(
    `---\nname: a\ndescription: Short. Use when needed.\ntools: [read]\n---\n${'y'.repeat(12_001)}`,
  )
  ok(bodyDiagnostic?.reason.includes('at most 12000'))
})

test('description is trimmed and kept up to 200 characters', () => {
  const { profile } = parse(
    `---\nname: a\ndescription: ${'x'.repeat(199)}\ntools: [read]\n---\nBody.`,
  )
  strictEqual(profile?.description.length, 199)
})

test('profiles are discovered, deduplicated, and sorted across directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shub-profiles-'))
  const bundled = join(root, 'bundled')
  const user = join(root, 'user')
  await mkdir(bundled, { recursive: true })
  await mkdir(user, { recursive: true })

  const profileText = (name: string, tools = '[read]') =>
    `---\nname: ${name}\ndescription: ${name} does things. Use when needed.\ntools: ${tools}\n---\nBody.`
  await writeFile(join(bundled, 'reviewer.md'), profileText('reviewer'))
  await writeFile(join(user, 'planner.md'), profileText('planner', '[fffind, read]'))
  await writeFile(join(user, 'broken.md'), 'not frontmatter')
  await writeFile(join(user, 'ignored.txt'), profileText('ignored'))
  await writeFile(join(user, 'research.md'), profileText('research'))
  await writeFile(join(bundled, 'research.md'), profileText('research'))

  const { profiles, diagnostics } = await discoverProfiles([
    { label: 'bundled', path: bundled },
    { label: 'user', path: user },
  ], KNOWN_TOOLS)

  strictEqual(profiles.map((profile) => profile.name).join(','), 'planner,reviewer')
  strictEqual(profiles[0].tools.join(','), 'fffind,read')
  ok(diagnostics.some(({ reason }) => reason.includes('more than once')), 'collision is reported')
  ok(diagnostics.some(({ reason }) => reason.includes('frontmatter')), 'broken file is reported')
  strictEqual(diagnostics.length, 2)
})

test('a symlink escaping the profile directory is excluded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shub-profiles-'))
  await mkdir(root, { recursive: true })
  const outside = join(tmpdir(), `shub-outside-${Date.now()}.md`)
  await writeFile(
    outside,
    '---\nname: evil\ndescription: x. Use when needed.\ntools: [read]\n---\nBody.',
  )
  await symlink(outside, join(root, 'evil.md'))

  const { profiles, diagnostics } = await discoverProfiles(
    [{ label: 'user', path: root }],
    KNOWN_TOOLS,
  )

  strictEqual(profiles.length, 0)
  ok(diagnostics[0]?.reason.includes('symlink'))
})

test('the catalog stays within its budget and reports omissions', () => {
  const worstCase: ShubProfile = {
    name: 'a'.repeat(32),
    description: 'x'.repeat(200),
    tools: ['read'],
    defaultEffort: 'standard',
    projectContext: false,
    body: 'Body.',
    sourcePath: '/profiles/worst.md',
  }
  const many = Array.from({ length: 20 }, (_, index) => ({
    ...worstCase,
    name: `${index}-${worstCase.name}`.slice(0, 32),
  }))

  const { included, omitted } = catalogSelection(many)
  ok(included.length > 0)
  ok(included.length <= 12)
  strictEqual(included.length + omitted.length, many.length)
  strictEqual(toolDescription(included).length <= MAX_TOOL_DESCRIPTION_CHARS, true)
  // Deterministic by name: the first agents alphabetically are advertised.
  strictEqual(included[0].name, many.map((agent) => agent.name).sort()[0])
})

test('the tool description carries only dispatch text and announcements', () => {
  const description = toolDescription([{
    name: 'research',
    description: 'Investigates with cited evidence. Use when a question spans sources.',
    tools: ['read'],
    defaultEffort: 'standard',
    projectContext: false,
    body: 'SECRET PROFILE BODY',
    sourcePath: '/profiles/research.md',
  }])

  ok(description.includes('research — Investigates with cited evidence'))
  ok(!description.includes('SECRET PROFILE BODY'), 'profile bodies never reach the parent')
  ok(description.length <= MAX_TOOL_DESCRIPTION_CHARS)
})

test('project profiles resolve under the workspace .pi directory', () => {
  strictEqual(projectProfileDirectory('/workspace'), join('/workspace', '.pi', 'shub-agents'))
})
