export interface FileIcon {
  readonly glyph: string
  readonly label: string
}

const icon = (glyph: string, label: string): FileIcon => ({ glyph, label })

export const fallbackFileIcon = icon('\uf016', 'File')

const specialFileIcons: Readonly<Record<string, FileIcon>> = {
  '.env': icon('\ue615', 'Environment configuration'),
  '.gitattributes': icon('\ue702', 'Git attributes'),
  '.gitignore': icon('\ue702', 'Git ignore rules'),
  '.gitmodules': icon('\ue702', 'Git modules'),
  'bun.lockb': icon('\uf023', 'Lockfile'),
  'cargo.toml': icon('\ue7a8', 'Rust package'),
  'changelog': icon('\uf0f6', 'Changelog'),
  'composer.json': icon('\ue73d', 'PHP package'),
  'docker-compose.yaml': icon('\ue7b0', 'Docker Compose'),
  'docker-compose.yml': icon('\ue7b0', 'Docker Compose'),
  dockerfile: icon('\ue7b0', 'Dockerfile'),
  'gemfile': icon('\ue739', 'Ruby package'),
  'go.mod': icon('\ue724', 'Go module'),
  'license': icon('\uf0f6', 'License'),
  'makefile': icon('\uf1c9', 'Makefile'),
  'mix.exs': icon('\ue62d', 'Elixir package'),
  'package-lock.json': icon('\ue616', 'Package lock'),
  'package.json': icon('\ue616', 'Package manifest'),
  'pnpm-lock.yaml': icon('\ue616', 'Package lock'),
  'pom.xml': icon('\ue738', 'Java package'),
  'readme': icon('\ue609', 'Readme'),
  'yarn.lock': icon('\ue616', 'Package lock'),
}

const compoundExtensionIcons: Readonly<Record<string, FileIcon>> = {
  'config.cjs': icon('\ue615', 'Configuration'),
  'config.css': icon('\ue615', 'Configuration'),
  'config.js': icon('\ue615', 'Configuration'),
  'config.json': icon('\ue615', 'Configuration'),
  'config.mjs': icon('\ue615', 'Configuration'),
  'config.scss': icon('\ue615', 'Configuration'),
  'config.ts': icon('\ue615', 'Configuration'),
  'config.tsx': icon('\ue615', 'Configuration'),
  'config.yaml': icon('\ue615', 'Configuration'),
  'config.yml': icon('\ue615', 'Configuration'),
  'spec.js': icon('\uf0c3', 'Test'),
  'spec.jsx': icon('\uf0c3', 'Test'),
  'spec.ts': icon('\uf0c3', 'Test'),
  'spec.tsx': icon('\uf0c3', 'Test'),
  'test.js': icon('\uf0c3', 'Test'),
  'test.jsx': icon('\uf0c3', 'Test'),
  'test.ts': icon('\uf0c3', 'Test'),
  'test.tsx': icon('\uf0c3', 'Test'),
}

const extensionIcons: Readonly<Record<string, FileIcon>> = {
  avif: icon('\uf1c5', 'Image'),
  bash: icon('\uf1c9', 'Shell script'),
  bmp: icon('\uf1c5', 'Image'),
  bz2: icon('\uf1c6', 'Archive'),
  c: icon('\ue61e', 'C source'),
  cc: icon('\ue61d', 'C++ source'),
  cfg: icon('\ue615', 'Configuration'),
  cjs: icon('\ue60c', 'JavaScript'),
  conf: icon('\ue615', 'Configuration'),
  cpp: icon('\ue61d', 'C++ source'),
  cs: icon('\uf81a', 'C# source'),
  cxx: icon('\ue61d', 'C++ source'),
  css: icon('\ue614', 'CSS'),
  dart: icon('\ue798', 'Dart'),
  flac: icon('\uf1c7', 'Audio'),
  fish: icon('\uf1c9', 'Shell script'),
  gif: icon('\uf1c5', 'Image'),
  go: icon('\ue627', 'Go'),
  gql: icon('\uf1c9', 'GraphQL'),
  graphql: icon('\uf1c9', 'GraphQL'),
  gz: icon('\uf1c6', 'Archive'),
  h: icon('\ue61e', 'C header'),
  hpp: icon('\ue61d', 'C++ header'),
  htm: icon('\ue60e', 'HTML'),
  html: icon('\ue60e', 'HTML'),
  ico: icon('\uf1c5', 'Image'),
  ini: icon('\ue615', 'Configuration'),
  java: icon('\ue738', 'Java'),
  jpeg: icon('\uf1c5', 'Image'),
  jpg: icon('\uf1c5', 'Image'),
  js: icon('\ue60c', 'JavaScript'),
  json: icon('\ue60b', 'JSON'),
  jsonc: icon('\ue60b', 'JSON'),
  jsx: icon('\ue625', 'React JSX'),
  kt: icon('\uf1c9', 'Kotlin'),
  kts: icon('\uf1c9', 'Kotlin'),
  less: icon('\ue758', 'Less'),
  log: icon('\uf0f6', 'Log'),
  lua: icon('\ue620', 'Lua'),
  markdown: icon('\ue609', 'Markdown'),
  md: icon('\ue609', 'Markdown'),
  mdx: icon('\ue609', 'Markdown JSX'),
  mkv: icon('\uf1c8', 'Video'),
  mjs: icon('\ue60c', 'JavaScript'),
  mov: icon('\uf1c8', 'Video'),
  mp3: icon('\uf1c7', 'Audio'),
  mp4: icon('\uf1c8', 'Video'),
  pdf: icon('\uf1c1', 'PDF'),
  perl: icon('\ue769', 'Perl'),
  php: icon('\ue73d', 'PHP'),
  pl: icon('\ue769', 'Perl'),
  png: icon('\uf1c5', 'Image'),
  ps1: icon('\uf1c9', 'PowerShell script'),
  py: icon('\ue606', 'Python'),
  pyw: icon('\ue606', 'Python'),
  rb: icon('\ue605', 'Ruby'),
  rar: icon('\uf1c6', 'Archive'),
  rake: icon('\ue739', 'Ruby'),
  rs: icon('\ue7a8', 'Rust'),
  sass: icon('\ue603', 'Sass'),
  scss: icon('\ue603', 'SCSS'),
  sh: icon('\uf1c9', 'Shell script'),
  sql: icon('\uf1c0', 'SQL'),
  svg: icon('\ufc1f', 'SVG'),
  svelte: icon('\uf1c9', 'Svelte'),
  swift: icon('\ue755', 'Swift'),
  tar: icon('\uf1c6', 'Archive'),
  test: icon('\uf0c3', 'Test'),
  ts: icon('\ue628', 'TypeScript'),
  tsx: icon('\ue625', 'React TypeScript'),
  txt: icon('\uf0f6', 'Text'),
  vue: icon('\ufd42', 'Vue'),
  wav: icon('\uf1c7', 'Audio'),
  wasm: icon('\uf1c9', 'WebAssembly'),
  webm: icon('\uf1c8', 'Video'),
  webp: icon('\uf1c5', 'Image'),
  xml: icon('\ue619', 'XML'),
  xz: icon('\uf1c6', 'Archive'),
  yaml: icon('\ue615', 'YAML'),
  yml: icon('\ue615', 'YAML'),
  zip: icon('\uf1c6', 'Archive'),
}

function fileName(path: string): string {
  return path.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? ''
}

function extension(path: string): string {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1)
}

/** Resolves a stable Nerd Font glyph from a Git-relative path. */
export function resolveFileIcon(path: string): FileIcon {
  const name = fileName(path)
  const special = specialFileIcons[name]
  if (special) return special

  if (name.startsWith('dockerfile.')) return specialFileIcons.dockerfile
  if (name.startsWith('readme.')) return specialFileIcons.readme
  if (name.startsWith('license.')) return specialFileIcons.license
  if (name.startsWith('.env.')) return specialFileIcons['.env']

  for (const [suffix, fileIcon] of Object.entries(compoundExtensionIcons)) {
    if (name.endsWith(`.${suffix}`)) return fileIcon
  }

  return extensionIcons[extension(path)] ?? fallbackFileIcon
}
