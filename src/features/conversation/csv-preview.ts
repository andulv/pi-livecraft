export const csvPreviewLimits = {
  maxCellCharacters: 160,
  maxColumns: 8,
  maxRows: 20,
  maxScanCharacters: 64_000,
  maxSourceCharacters: 20_000,
} as const

export interface CsvPreview {
  rows: string[][]
  truncated: boolean
}

/** Parses only the bounded prefix needed to render a safe CSV preview. */
export function parseCsvPreview(content: string): CsvPreview {
  const { maxCellCharacters, maxColumns, maxRows, maxScanCharacters } = csvPreviewLimits
  const rows: string[][] = []
  let index = 0
  let truncated = false

  while (index < content.length && index < maxScanCharacters && rows.length < maxRows) {
    const row: string[] = []
    let cell = ''
    let cellTruncated = false
    let column = 0
    let inQuotes = false
    let rowEnded = false

    const append = (character: string) => {
      if (cell.length < maxCellCharacters) cell += character
      else cellTruncated = true
    }
    const pushCell = () => {
      if (column < maxColumns) row.push(`${cell}${cellTruncated ? '…' : ''}`)
      else truncated = true
      column++
      if (cellTruncated) truncated = true
      cell = ''
      cellTruncated = false
    }

    while (index < content.length && index < maxScanCharacters) {
      const character = content[index]
      if (character === '"') {
        if (inQuotes && content[index + 1] === '"') {
          append('"')
          index += 2
          continue
        }
        inQuotes = !inQuotes
        index++
        continue
      }
      if (!inQuotes && character === ',') {
        pushCell()
        index++
        continue
      }
      if (!inQuotes && (character === '\n' || character === '\r')) {
        pushCell()
        rowEnded = true
        index++
        if (character === '\r' && content[index] === '\n') index++
        break
      }
      append(character)
      index++
    }

    if (!rowEnded && (cell.length > 0 || column > 0 || index >= content.length)) pushCell()
    if (row.length > 0) rows.push(row)
    if (index >= maxScanCharacters && index < content.length) truncated = true
  }

  if (index < content.length) truncated = true
  return { rows, truncated }
}

/** Returns a bounded source view while preserving the complete content for copying. */
export function csvSourcePreview(content: string): { text: string; truncated: boolean } {
  const maxCharacters = csvPreviewLimits.maxSourceCharacters
  return content.length <= maxCharacters
    ? { text: content, truncated: false }
    : { text: `${content.slice(0, maxCharacters)}…`, truncated: true }
}
