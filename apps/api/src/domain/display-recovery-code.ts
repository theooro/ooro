import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const createDisplayRecoveryCode = () => Array.from(randomBytes(10), byte => alphabet[byte % alphabet.length]).join('')
const encryptionKey = (secret: string) => createHash('sha256').update('ooro-screen-recovery-code:v1:').update(secret).digest()

export function encryptDisplayRecoveryCode(code: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

export function decryptDisplayRecoveryCode(value: string, secret: string): string {
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length < 29) throw new Error('Invalid encrypted recovery code')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
}
