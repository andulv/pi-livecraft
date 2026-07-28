import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isObject } from '../shared/is-object.ts'

export const managerRuntimeManifestPath = fileURLToPath(
  new URL('./manager-runtime-files.json', import.meta.url),
)
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))

export interface ManagerRuntimeRevision {
  files: string[]
  revision: string
}

/** Hashes the declared manager runtime without scanning unrelated project files. */
export async function calculateManagerRuntimeRevision(
  manifestPath = managerRuntimeManifestPath,
  rootDirectory = repositoryRoot,
): Promise<ManagerRuntimeRevision> {
  const manifest = await readManifest(manifestPath)
  const root = await realpath(rootDirectory)
  const files = await Promise.all(manifest.files.map(async (entry) => {
    const path = resolve(root, entry)
    const relativePath = relative(root, path)
    if (!relativePath || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
      throw new Error(`Invalid manager runtime path: ${entry}`)
    const canonicalPath = await realpath(path)
    const canonicalRelativePath = relative(root, canonicalPath)
    if (
      !canonicalRelativePath || canonicalRelativePath.startsWith(`..${sep}`)
      || isAbsolute(canonicalRelativePath)
    ) throw new Error(`Manager runtime path escapes the repository: ${entry}`)
    return { path: canonicalPath, relativePath: canonicalRelativePath.split(sep).join('/') }
  }))
  if (new Set(files.map(({ path }) => path)).size !== files.length)
    throw new Error('Manager runtime manifest resolves duplicate paths')
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))

  const hash = createHash('sha256')
  hash.update(`manager-runtime-v${manifest.version}\0`)
  for (const file of files) {
    const content = await readFile(file.path)
    hash.update(file.relativePath)
    hash.update('\0')
    hash.update(String(content.length))
    hash.update('\0')
    hash.update(content)
    hash.update('\0')
  }
  return {
    files: files.map(({ path }) => path),
    revision: `sha256-v${manifest.version}:${hash.digest('hex')}`,
  }
}

/** Reads the runtime manifest afresh so a supervised restart includes newly declared files. */
async function readManifest(manifestPath: string): Promise<{ version: number; files: string[] }> {
  const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    !isObject(value) || !Number.isInteger(value.version) || Number(value.version) < 1
    || !Array.isArray(value.files)
  ) throw new Error('Invalid manager runtime manifest')
  const files = value.files.filter((entry): entry is string =>
    typeof entry === 'string' && entry.length > 0
  )
  if (files.length !== value.files.length || new Set(files).size !== files.length)
    throw new Error('Manager runtime manifest contains invalid or duplicate paths')
  return { version: value.version as number, files }
}
