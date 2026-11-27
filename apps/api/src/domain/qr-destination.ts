export const safeDestination = (value: unknown, allowLocalDevelopment = process.env.NODE_ENV === 'development') => {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || ['localhost', '127.0.0.1'].includes(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || ['api.theooro.com', 'api-staging.theooro.com', 'staging.theooro.com'].includes(host)) return null
    if (parsed.protocol !== 'https:') return allowLocalDevelopment && ['localhost', '127.0.0.1'].includes(parsed.hostname) ? parsed.toString() : null
    return parsed.toString()
  } catch { return null }
}
