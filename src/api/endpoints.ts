/** 后端接口的类型化封装。页面只依赖这里，不直接拼 URL。 */

import type { ApplicationNoticeKind } from '@shared/recruit'
import type { ApplyTokenPayload, SsoMeResponse } from '@shared/sso'
import type { RuntimeConfig } from '@shared/runtime'
import type {
  Application,
  ApplicationStatus,
  Member,
  NewsItem,
  Project,
  ResourceKey,
  SiteConfig,
  Slide,
} from '@shared/types'
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
  /** 服务端是否已配置 SMTP_PASSWORD（密码本身不下发，只告知有没有） */
  mailSecretConfigured: boolean
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

// ===== 招新报名（学生侧） =====

/**
 * 提交报名表。
 *
 * 走 `join` 通道：这一组就是为「报名提交 / 文件上传」准备的，
 * 后台可在「系统设置 → 流量通道」把它切到国内服务，切换前端无需重新部署。
 * 不要手动设置 content-type，交给浏览器带 multipart boundary。
 */
export function submitApplication(form: FormData) {
  return apiRequest<Application>(
    '/api/applications',
    { method: 'POST', body: form },
    { group: 'join', timeoutMs: 120_000 },
  )
}

export interface MyApplicationResponse {
  application: Application | null
  /** 已发出邀请函时给出确认页地址，省得同学翻邮箱找链接 */
  inviteUrl?: string
}

export function myApplication(signal?: AbortSignal) {
  return apiRequest<MyApplicationResponse>('/api/applications/me', { signal })
}

// ===== 招新报名（邀请函确认页） =====

export interface InviteInfo {
  alreadyMember: boolean
  name: string
  studentId: string
  email?: string
  expiresAt?: string
  roleOptions?: readonly string[]
  joinYear?: string
  confirmedAt?: string
}

export function fetchInvite(token: string) {
  return apiRequest<InviteInfo>(`/api/applications/invite/${encodeURIComponent(token)}`)
}

export interface ConfirmInviteBody {
  title: string
  nameEn?: string
  direction?: string
  bio?: string
  email?: string
}

export function confirmInvite(token: string, body: ConfirmInviteBody) {
  return apiRequest<{ memberId: string }>(
    `/api/applications/invite/${encodeURIComponent(token)}`,
    jsonInit('POST', body),
  )
}

// ===== 招新报名（后台） =====

/** 后台视图比学生视图多出邀请链接与状态中文名 */
export interface AdminApplication extends Application {
  inviteToken: string
  inviteExpiresAt: string
  inviteUrl: string
  statusLabel: string
}

export interface AdminApplicationList {
  items: AdminApplication[]
  total: number
  /** 各状态的条数，用于列表页顶部的筛选徽章 */
  counts: Record<string, number>
}

export function adminListApplications(
  params: { status?: ApplicationStatus[]; q?: string; limit?: number; offset?: number } = {},
) {
  const search = new URLSearchParams()
  if (params.status?.length) search.set('status', params.status.join(','))
  if (params.q) search.set('q', params.q)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  const suffix = search.toString() ? `?${search}` : ''
  return apiRequest<AdminApplicationList>(`/api/admin/applications${suffix}`)
}

export interface UpdateApplicationBody {
  status?: ApplicationStatus
  note?: string
  writtenAt?: string
  writtenScore?: string
  writtenNote?: string
  interviewAt?: string
  interviewNote?: string
  probationNote?: string
  sendMail?: boolean
  /** 补发某封信（状态不变时也能用） */
  notice?: ApplicationNoticeKind
}

export interface UpdateApplicationResult {
  application: AdminApplication
  /** 本次触发的邮件结果；没有发信时为 null */
  mail: { kind: ApplicationNoticeKind; sent: boolean; code: string; message: string } | null
}

export function adminUpdateApplication(id: string, body: UpdateApplicationBody) {
  return apiRequest<UpdateApplicationResult>(
    `/api/admin/applications/${encodeURIComponent(id)}`,
    jsonInit('PUT', body),
  )
}

export function adminDeleteApplication(id: string) {
  return apiRequest<{ id: string }>(
    `/api/admin/applications/${encodeURIComponent(id)}`,
    jsonInit('DELETE'),
  )
}

/** 报名表下载地址：需管理员会话，直接交给浏览器打开/下载即可 */
export function applicationFileUrl(id: string) {
  return `/api/admin/applications/${encodeURIComponent(id)}/file`
}

/** 给指定邮箱发一封测试邮件（`to` 留空则用站点联系邮箱），用于验证 SMTP 配置 */
export function adminSendTestMail(to?: string) {
  return apiRequest<{ accepted: string[]; messageId: string }>(
    '/api/admin/mail/test',
    jsonInit('POST', { to: to ?? '' }),
    { timeoutMs: 30_000 },
  )
}
