/**
 * API 传输层：运行时通道解析 + 失败自动切换 + 统一错误处理。
 *
 * 通道设计（对应「Cloudflare 主站 + 国内 serverless 降级」）：
 *   - core：公开内容、后台接口与教务网登录回调，恒定同源（Cloudflare），不参与切换；
 *   - join：报名提交，按后台开关与灰度比例决定走本站还是国内服务。
 */

import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CACHE_KEY,
  type ChannelTarget,
  type RuntimeConfig,
  type RuntimeConfigResponse,
} from '@shared/runtime'
import { DEFAULT_SITE_CONFIG, type ApiResult, type SiteConfig } from '@shared/types'

export type ApiGroup = 'core' | 'join'

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'UNKNOWN', status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

// ===== 运行时配置缓存 =====

let runtime: RuntimeConfig = loadCachedRuntime()
let site: SiteConfig = DEFAULT_SITE_CONFIG
let initialized = true
let refreshPromise: Promise<void> | null = null

function loadCachedRuntime(): RuntimeConfig {
  try {
    const raw = sessionStorage.getItem(RUNTIME_CACHE_KEY)
    if (raw) return { ...DEFAULT_RUNTIME_CONFIG, ...(JSON.parse(raw) as RuntimeConfig) }
  } catch {
    // 隐私模式或数据损坏，走默认配置
  }
  return DEFAULT_RUNTIME_CONFIG
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtime
}

export function getSiteConfig(): SiteConfig {
  return site
}

export function isInitialized(): boolean {
  return initialized
}

/** 拉取运行时配置；并发调用会合并为一次请求 */
export async function refreshRuntimeConfig(): Promise<void> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/config/runtime', { credentials: 'include', cache: 'no-store' })
      if (!response.ok) return
      const result = (await response.json()) as ApiResult<RuntimeConfigResponse>
      if (!result.ok) return
      runtime = { ...DEFAULT_RUNTIME_CONFIG, ...result.data.config }
      site = { ...DEFAULT_SITE_CONFIG, ...result.data.site }
      initialized = result.data.initialized
      try {
        sessionStorage.setItem(RUNTIME_CACHE_KEY, JSON.stringify(runtime))
      } catch {
        // 忽略存储失败
      }
    } catch {
      // 保留上一次（或默认）配置，站点不能因为配置接口故障而不可用
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

// ===== 通道选择 =====

function deviceBucket(): number {
  let id = ''
  try {
    id = localStorage.getItem('kc-device-id') ?? ''
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('kc-device-id', id)
    }
  } catch {
    id = navigator.userAgent
  }
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 100
}

/** 返回 [主通道基址, 备用通道基址]；空字符串表示同源 */
export function resolveChannels(group: ApiGroup): [string, string | null] {
  if (group === 'core') return ['', null]

  const target: ChannelTarget = runtime.join
  const primary = target.mode === 'edgeone' ? target.edgeone : target.cloudflare
  const secondary = target.mode === 'edgeone' ? target.cloudflare : target.edgeone

  // 灰度：未命中的流量继续留在本站
  if (target.mode === 'edgeone' && runtime.rolloutPercent > 0) {
    if (deviceBucket() >= runtime.rolloutPercent) return ['', runtime.failover ? secondary || null : null]
  }

  // 主通道未配置（例如 EdgeOne 尚未部署）时直接回落
  if (primary === '' && target.mode === 'edgeone') return ['', null]
  return [primary, runtime.failover ? secondary || null : null]
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.status === 0) return true // 网络错误 / 超时
  return error.status >= 500 || error.status === 429
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD'])

// ===== 底层请求 =====

export interface RequestOptions {
  group?: ApiGroup
  /** 允许失败后切备用通道（默认：仅幂等请求允许） */
  retry?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

async function doFetch<T>(base: string, path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // 调用方传入的 signal 与超时信号合并
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
    })

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      if (response.ok) return undefined as T
      throw new ApiError(`服务返回了非 JSON 响应（HTTP ${response.status}）`, 'BAD_RESPONSE', response.status)
    }

    const result = (await response.json()) as ApiResult<T>
    if (!result.ok) {
      throw new ApiError(result.error.message, result.error.code, response.status)
    }
    return result.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    const aborted = (error as Error)?.name === 'AbortError'
    throw new ApiError(aborted ? '请求超时，请检查网络' : '网络异常，无法连接服务', aborted ? 'TIMEOUT' : 'NETWORK_ERROR', 0)
  } finally {
    clearTimeout(timer)
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const { group = 'core', timeoutMs = 15_000 } = options
  const method = (init.method ?? 'GET').toUpperCase()
  const [primary, secondary] = resolveChannels(group)
  const allowRetry = options.retry ?? IDEMPOTENT_METHODS.has(method)

  try {
    return await doFetch<T>(primary, path, { ...init }, timeoutMs)
  } catch (error) {
    if (!allowRetry || !secondary || secondary === primary || !isRetryable(error)) throw error
    // 主通道异常：自动切到备用通道，并记录一次事件方便排查
    console.warn('[api] 主通道失败，切换到备用通道', { path, group, error })
    return await doFetch<T>(secondary, path, { ...init }, timeoutMs)
  }
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

/** 页面重新可见或长时间停留时刷新配置，让存量页面也能感知通道切换 */
export function installConfigRefresh(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') void refreshRuntimeConfig()
  }
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(() => void refreshRuntimeConfig(), 5 * 60 * 1000)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}
