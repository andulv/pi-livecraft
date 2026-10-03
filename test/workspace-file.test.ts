import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  readWorkspaceRawFile,
  resolveWorkspaceFilePath,
  WorkspaceFileError,
} from '../server/workspace-file.ts'

function workspaceFileErrorWith(status: number): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.equal(error instanceof WorkspaceFileError, true)
    assert.equal((error as WorkspaceFileError).status, status)
    return true
  }
}

test('reads a text file from the workspace and rejects its root', async () => {
  const path = await resolveWorkspaceFilePath(process.cwd(), 'package.json')
  const file = await readWorkspaceFile(process.cwd(), 'package.json')
  assert.equal(path, file.path)
  assert.equal(relative(process.cwd(), file.path), 'package.json')
  assert.match(file.content, /"name": "pi-livecraft"/)
  await assert.rejects(readWorkspaceFile(process.cwd(), '.'), (error: unknown) => {
    assert.equal(error instanceof WorkspaceFileError, true)
    assert.equal((error as WorkspaceFileError).status, 403)
    return true
  })
})

test('refuses binary text reads and serves raw media only from the allow-list', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-raw-'))
  const outside = await mkdtemp(join(tmpdir(), 'pi-livecraft-outside-'))
  try {
    await writeFile(join(directory, 'notes.txt'), 'plain text')
    await writeFile(join(directory, 'blob.dat'), Buffer.from([0x61, 0x00, 0x62]))
    await writeFile(join(directory, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(directory, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(join(outside, 'picture.png'), Buffer.from([0x89]))

    await assert.rejects(readWorkspaceFile(directory, 'blob.dat'), workspaceFileErrorWith(415))
    // SVG deliberately stays off the raw route: it is previewed as sandboxed text.
    await assert.rejects(readWorkspaceRawFile(directory, 'icon.svg'), workspaceFileErrorWith(415))
    await assert.rejects(readWorkspaceRawFile(directory, 'notes.txt'), workspaceFileErrorWith(415))
    await assert.rejects(
      readWorkspaceRawFile(directory, `../${basename(outside)}/picture.png`),
      workspaceFileErrorWith(403),
    )

    const png = await readWorkspaceRawFile(directory, 'logo.png')
    assert.equal(png.mimeType, 'image/png')
    assert.deepEqual([...png.bytes], [0x89, 0x50, 0x4e, 0x47])
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('lists direct workspace children without exposing symlinks or parent paths', async () => {
  const listing = await listWorkspaceFiles(process.cwd(), 'src')
  assert.equal(listing.path, 'src')
  assert.ok(listing.entries.some((entry) => entry.name === 'App.tsx' && entry.kind === 'file'))
  assert.ok(
    listing.entries.some((entry) => entry.name === 'features' && entry.kind === 'directory'),
  )
  await assert.rejects(listWorkspaceFiles(process.cwd(), '..'), (error: unknown) => {
    assert.equal(error instanceof WorkspaceFileError, true)
    assert.equal((error as WorkspaceFileError).status, 403)
    return true
  })
})

test('allows opening an absolute file outside the workspace without widening reads', async () => {
  const workspacePath = await realpath('src')
  const externalPath = await realpath('package.json')
  assert.equal(
    await resolveWorkspaceFilePath(workspacePath, externalPath, true),
    externalPath,
  )
  await assert.rejects(
    resolveWorkspaceFilePath(workspacePath, externalPath),
    (error: unknown) => {
      assert.equal(error instanceof WorkspaceFileError, true)
      assert.equal((error as WorkspaceFileError).status, 403)
      return true
    },
  )
})
