import type { PartnerEnvironment, PartnerScope } from './domain/partner-integration.js'
declare module 'fastify' {
  interface FastifyRequest {
    partner?: { partnerId: string; clientId: string; environment: PartnerEnvironment; scopes: PartnerScope[] }
  }
}
