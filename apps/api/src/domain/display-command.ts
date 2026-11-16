export type DisplayCommandRequest = {
  displayId: string
  commandType: string
  payload?: unknown
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function sameDisplayCommandRequest(existing: DisplayCommandRequest, requested: DisplayCommandRequest): boolean {
  return existing.displayId === requested.displayId
    && existing.commandType === requested.commandType
    && stableJson(existing.payload) === stableJson(requested.payload)
}
