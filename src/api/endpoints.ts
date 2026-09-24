/** 后端接口的类型化封装。页面只依赖这里，不直接拼 URL。 */

import type { ApplyTokenPayload, SsoMeResponse } from '@shared/sso'
import type { RuntimeConfig } from '@shared/runtime'
import type { Member, NewsItem, Project, ResourceKey, SiteConfig, Slide } from '@shared/types'
import { apiRequest, jsonInit } from './client'

// ===== 公开只读 =====

export interface BootstrapData {
  members: Member[]
  projects: Project[]
  news: NewsItem[]
  slides: Slide[]
  site: SiteConfig
}

export function fetchBootstrap(signal?: AbortSignal) {
  return apiRequest<BootstrapData>('/api/public/bootstrap', { signal })
}

// ===== 教务网登录 =====

/** 登录是整页跳转：交给浏览器跳过去，不要用 fetch（会跟随跨域重定向） */
export const STUDENT_LOGIN_URL = '/api/auth/login'

/** 当前报名登录态 */
export function studentMe(signal?: AbortSignal) {
  return apiRequest<SsoMeResponse>('/api/auth/me', { signal }, { timeoutMs: 10_000 })
}

export function studentLogout() {
  return apiRequest<{ loggedOut: boolean }>('/api/auth/logout', jsonInit('POST'))
}

export type { ApplyTokenPayload }

// ===== 管理员认证 =====

export interface AdminIdentity {
  username: string
  name: string
  isOwner?: boolean
}

export function adminLogin(username: string, password: string) {
  return apiRequest<AdminIdentity>('/api/admin/login', jsonInit('POST', { username, password }))
}

export function adminLogout() {
  return apiRequest<{ ok: boolean }>('/api/admin/logout', jsonInit('POST'))
}

export function adminMe() {
  return apiRequest<AdminIdentity>('/api/admin/me')
}

export function adminChangePassword(currentPassword: string, newPassword: string) {
  return apiRequest<{ ok: boolean }>(
    '/api/admin/change-password',
    jsonInit('POST', { currentPassword, newPassword }),
  )
}

export function adminSeedContent() {
  return apiRequest<{ result: Record<string, string> }>('/api/admin/seed-content', jsonInit('POST'))
}

// ===== 文件上传 =====

export interface UploadResult {
  key: string
  /** 可直接用于 <img src> 的相对地址，形如 /api/files/avatars/xxx.jpg */
  url: string
  size: number
  contentType: string
}

/** 上传图片。不要手动设置 content-type，交给浏览器带 multipart boundary */
export function adminUploadImage(file: File, scope = 'misc') {
  const form = new FormData()
  form.append('file', file)
  form.append('scope', scope)
  return apiRequest<UploadResult>('/api/admin/uploads', { method: 'POST', body: form }, { timeoutMs: 60_000 })
}

// ===== 后台内容 CRUD =====

export interface ContentListResponse<T> {
  resource: ResourceKey
  items: T[]
  total: number
}

export function adminListContent<T = Record<string, unknown>>(
  resource: ResourceKey,
  params: { q?: string; limit?: number; offset?: number } = {},
) {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  const suffix = search.toString() ? `?${search}` : ''
  return apiRequest<ContentListResponse<T>>(`/api/admin/content/${resource}${suffix}`)
}

export function adminCreateContent<T = Record<string, unknown>>(resource: ResourceKey, body: unknown) {
  return apiRequest<T>(`/api/admin/content/${resource}`, jsonInit('POST', body))
}

export function adminUpdateContent<T = Record<string, unknown>>(
  resource: ResourceKey,
  id: string,
  body: unknown,
) {
  return apiRequest<T>(`/api/admin/content/${resource}/${encodeURIComponent(id)}`, jsonInit('PUT', body))
}

export function adminDeleteContent(resource: ResourceKey, id: string) {
  return apiRequest<{ id: string }>(
    `/api/admin/content/${resource}/${encodeURIComponent(id)}`,
    jsonInit('DELETE'),
  )
}

// ===== 后台：概览 / 审计 / 配置 =====

export interface AdminStats {
  counts: Record<ResourceKey, number>
  recentNews: NewsItem[]
  recentMembers: Member[]
}

export function adminStats() {
  return apiRequest<AdminStats>('/api/admin/stats')
}

export interface AuditLog {
  id: string
  actor: string
  action: string
  resource: string
  target_id: string
  detail: string
  ip: string
  created_at: string
}

export function adminAudit(limit = 100) {
  return apiRequest<{ logs: AuditLog[] }>(`/api/admin/audit?limit=${limit}`)
}

export interface AdminConfigResponse {
  site: SiteConfig
  runtime: RuntimeConfig
}

export function adminGetConfig() {
  return apiRequest<AdminConfigResponse>('/api/admin/config')
}

export function adminUpdateConfig(patch: { site?: Partial<SiteConfig>; runtime?: Partial<RuntimeConfig> }) {
  return apiRequest<{ site: SiteConfig | null; runtime: RuntimeConfig | null }>(
    '/api/admin/config',
    jsonInit('PUT', patch),
  )
}
