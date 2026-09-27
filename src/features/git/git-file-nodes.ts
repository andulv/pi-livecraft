import type { GitFileChange } from '../../../shared/types.ts'

export interface GitFileNode {
  id: string
  name: string
  children?: GitFileNode[]
  file?: GitFileChange
}

/** Arborist virtualizes both views; the flat view is a list of leaf nodes. */
export function gitFileNodes(files: readonly GitFileChange[], treeView: boolean): GitFileNode[] {
  if (!treeView)
    return files.map((file) => ({ id: `file:${file.path}`, name: file.path, file }))

  const root: GitFileNode[] = []
  const directories = new Map<string, GitFileNode & { children: GitFileNode[] }>()
  for (const file of files) {
    const segments = file.path.split('/')
    let children = root
    let directoryPath = ''
    for (const name of segments.slice(0, -1)) {
      directoryPath = directoryPath ? `${directoryPath}/${name}` : name
      let directory = directories.get(directoryPath)
      if (!directory) {
        directory = { id: `dir:${directoryPath}`, name, children: [] }
        directories.set(directoryPath, directory)
        children.push(directory)
      }
      children = directory.children
    }
    children.push({ id: `file:${file.path}`, name: segments.at(-1) ?? file.path, file })
  }
  return root
}
