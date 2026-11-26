import { app } from './app.js'
import { config } from './config.js'
import { deliverDuePartnerWebhooks } from './partner-runtime.js'

const address = await app.listen({ port: config.port, host: '0.0.0.0' })
app.log.info(`OORO API listening at ${address}`)

const partnerOutboxTimer = setInterval(() => {
  void deliverDuePartnerWebhooks().catch(() => app.log.error('Partner webhook outbox worker failed'))
}, 5000)
partnerOutboxTimer.unref()

const shutdown = async () => {
  clearInterval(partnerOutboxTimer)
  await app.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
