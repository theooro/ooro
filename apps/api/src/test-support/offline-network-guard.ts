import net from 'node:net'
import dgram from 'node:dgram'
import dns from 'node:dns'
import dnsPromises from 'node:dns/promises'

let installed = false

/** Blocks network from test processes except the explicit disposable PostgreSQL socket. */
export function installOfflineNetworkGuard(): void {
  if (installed) return
  installed = true

  const originalConnect = net.Socket.prototype.connect
  const guardedConnect = function (this: net.Socket, ...args: Parameters<typeof originalConnect>) {
    const first = args[0]
    const options = typeof first === 'object' && first !== null ? first as unknown as { port?: number; host?: string } : undefined
    const port = options?.port ?? (typeof first === 'number' ? first : undefined)
    const host = options?.host ?? (typeof args[1] === 'string' ? args[1] : undefined)
    if (port === 55432 && host === '127.0.0.1') return originalConnect.apply(this, args)
    throw new Error(`OFFLINE_TEST_NETWORK_BLOCKED:${String(host ?? 'unknown')}:${String(port ?? 'unknown')}`)
  }
  net.Socket.prototype.connect = guardedConnect as typeof originalConnect

  const guardedSend = function (): never {
    throw new Error('OFFLINE_TEST_DATAGRAM_BLOCKED')
  }
  dgram.Socket.prototype.send = guardedSend as typeof dgram.Socket.prototype.send

  const rejectLookup = ((hostname: string) => {
    if (net.isIP(hostname)) return Promise.resolve({ address: hostname, family: net.isIP(hostname) })
    return Promise.reject(new Error(`OFFLINE_TEST_DNS_BLOCKED:${hostname}`))
  }) as typeof dnsPromises.lookup
  dnsPromises.lookup = rejectLookup
  const originalDnsLookup = dns.lookup
  dns.lookup = ((...args: Parameters<typeof dns.lookup>) => {
    const hostname = args[0]
    if (net.isIP(hostname)) return Reflect.apply(originalDnsLookup, dns, args)
    throw new Error(`OFFLINE_TEST_DNS_BLOCKED:${hostname}`)
  }) as typeof dns.lookup
  for (const name of Object.keys(dnsPromises)) {
    if (name.startsWith('resolve') || name === 'reverse') {
      Object.assign(dnsPromises, { [name]: () => Promise.reject(new Error('OFFLINE_TEST_DNS_BLOCKED')) })
    }
  }
  for (const name of Object.keys(dns)) {
    if (name.startsWith('resolve') || name === 'reverse') {
      Object.assign(dns, { [name]: () => { throw new Error('OFFLINE_TEST_DNS_BLOCKED') } })
    }
  }

  globalThis.fetch = async () => { throw new Error('OFFLINE_TEST_FETCH_BLOCKED') }
}
