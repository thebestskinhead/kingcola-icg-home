/**
 * 纯 Web Crypto 实现的密码哈希、签名与令牌工具。
 * 无第三方依赖，可在 Worker 与边缘函数中通用（EdgeOne 同样支持 Web Crypto）。
 */

const encoder = new TextEncoder()
const PBKDF2_ITERATIONS = 150_000

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomHex(4)}`
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function utf8ToBase64Url(text: string): string {
  return bytesToBase64Url(encoder.encode(text))
}

function base64UrlToUtf8(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value))
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ===== 密码哈希（PBKDF2-SHA256） =====

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  const salt = base64UrlToBytes(parts[2])
  const expected = base64UrlToBytes(parts[3])
  const actual = await deriveKey(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}

/** 密码变更版本号：改密码后所有旧会话自动失效 */
export function passwordVersion(passwordHash: string): string {
  return passwordHash.slice(-12)
}

// ===== HMAC 签名 =====

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function hmacVerify(payload: string, signature: string, secret: string): Promise<boolean> {
  const key = await hmacKey(secret)
  try {
    return await crypto.subtle.verify('HMAC', key, base64UrlToBytes(signature) as unknown as BufferSource, encoder.encode(payload))
  } catch {
    return false
  }
}

// ===== 紧凑签名令牌：base64url(json).base64url(hmac) =====

export interface CompactTokenPayload {
  /** 主体 id */
  sub: string
  /** 过期时间（秒） */
  exp?: number
}

export async function signToken<T extends CompactTokenPayload>(payload: T, secret: string): Promise<string> {
  const body = utf8ToBase64Url(JSON.stringify(payload))
  const signature = await hmacSign(body, secret)
  return `${body}.${signature}`
}

export async function verifyToken<T extends CompactTokenPayload>(token: string, secret: string): Promise<T | null> {
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null
  const body = token.slice(0, idx)
  const signature = token.slice(idx + 1)
  if (!(await hmacVerify(body, signature, secret))) return null
  try {
    const payload = JSON.parse(base64UrlToUtf8(body)) as T & { exp?: number }
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
