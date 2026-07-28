import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import {
  calculateManagerRuntimeRevision,
  managerRuntimeManifestPath,
} from '../server/manager-runtime.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')

test('changes the manager revision only when declared content changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-runtime-'))
  const manifestPath = join(root, 'manifest.json')
  try {
    await writeFile(join(root, 'a.ts'), 'export const a = 1\n')
    await writeFile(join(root, 'b.ts'), 'export const b = 2\n')
    await writeManifest(manifestPath, ['b.ts', 'a.ts'])
    const first = await calculateManagerRuntimeRevision(manifestPath, root)

    await writeManifest(manifestPath, ['a.ts', 'b.ts'])
    const reordered = await calculateManagerRuntimeRevision(manifestPath, root)
    assert.equal(reordered.revision, first.revision)

    await writeFile(join(root, 'b.ts'), 'export const b = 3\n')
    const changed = await calculateManagerRuntimeRevision(manifestPath, root)
    assert.notEqual(changed.revision, first.revision)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('rejects manager runtime paths outside the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-runtime-'))
  const manifestPath = join(root, 'manifest.json')
  try {
    await writeManifest(manifestPath, ['../outside.ts'])
    await assert.rejects(
      calculateManagerRuntimeRevision(manifestPath, root),
      /Invalid manager runtime path/,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('declares every local runtime import reachable from manager.ts', async () => {
  const manifest = JSON.parse(await readFile(managerRuntimeManifestPath, 'utf8')) as {
    files: string[]
  }
  const importedFiles = await collectRuntimeImports(join(repositoryRoot, 'server/manager.ts'))
  const declaredFiles = new Set(manifest.files)
  const missing = [...importedFiles]
    .map((path) => relative(repositoryRoot, path).replaceAll('\\', '/'))
    .filter((path) => !declaredFiles.has(path))
  assert.deepEqual(missing, [], `Manager runtime manifest is missing: ${missing.join(', ')}`)
})

async function writeManifest(path: string, files: string[]): Promise<void> {
  await writeFile(path, JSON.stringify({ version: 1, files }))
}

/** Traverses value imports with TypeScript so new manager dependencies cannot bypass the manifest. */
async function collectRuntimeImports(entryPath: string): Promise<Set<string>> {
  const files = new Set<string>()
  const visit = async (path: string): Promise<void> => {
    const canonicalPath = await realpath(path)
    if (files.has(canonicalPath)) return
    files.add(canonicalPath)
    const source = ts.createSourceFile(
      canonicalPath,
      await readFile(canonicalPath, 'utf8'),
      ts.ScriptTarget.Latest,
      false,
    )
    const imports = runtimeImportSpecifiers(source).filter((specifier) => specifier.startsWith('.'))
    await Promise.all(imports.map((specifier) => visit(resolve(dirname(canonicalPath), specifier))))
  }
  await visit(entryPath)
  return files
}

/** Finds static value imports, re-exports, and literal dynamic imports in one source file. */
function runtimeImportSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) && hasRuntimeImport(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) specifiers.push(node.moduleSpecifier.text)
    else if (
      ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) specifiers.push(node.moduleSpecifier.text)
    else if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node
          .arguments
          .length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) specifiers.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

function hasRuntimeImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return true
  if (clause.isTypeOnly) return false
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings))
    return true
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly)
}
