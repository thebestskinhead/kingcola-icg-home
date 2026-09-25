/** 后端接口的类型化封装。页面只依赖这里，不直接拼 URL。 */

import type {
  DirectAccessInfo,
  StorageConfigView,
  StoragePurpose,
  StorageTargetConfig,
} from '@shared/storage'
import type {
  CheckinStage,
  RecruitAutoPreview,
  RecruitAutoTask,
  RecruitBoard,
  RecruitCycleConfig,
  RecruitMailKind,
  RecruitPhase,
  RecruitResult,
  RecruitStage,
  RecruitTemplates,
} from '@shared/recruit'
import type { ApplyTokenPayload, SsoMeResponse } from '@shared/sso'
import type { RuntimeConfig } from '@shared/runtime'
import type {
  Application,
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

// ===== 招新（公开：报名页与签到页用） =====

export interface RecruitStatus {
  phase: RecruitPhase
  name: string
  applyStart: string
  applyEnd: string
  applyStartText: string
  applyEndText: string
  /** 报名通道是否开放 */
  applyOpen: boolean
  /** 给「加入我们」页面的说明文案 */
  notice: string
}

export function fetchRecruitStatus(signal?: AbortSignal) {
  return apiRequest<RecruitStatus>('/api/public/recruit', { signal })
}

export interface CheckinInfo {
  stage: CheckinStage
  /** 阶段中文名，如「笔试」 */
  stageLabel: string
  sessionId: string
  /** 场次称呼，如「第一场」「上午场」 */
  sessionLabel: string
  /** 场次时间文本，如「2026 年 10 月 8 日 14:00–16:00」 */
  sessionTime: string
  cycleName: string
  studioName: string
}

/**
 * 读取签到页要展示的信息。`token` 就是二维码里的凭证（绑场次 + 带失效时间），
 * 无效 / 过期 / 被作废时后端返回 404，且不透露任何场次信息。
 */
export function fetchCheckinInfo(token: string, signal?: AbortSignal) {
  return apiRequest<CheckinInfo>(`/api/applications/checkin/${encodeURIComponent(token)}`, { signal })
}

export interface CheckinResult {
  already: boolean
  name: string
  stage: CheckinStage
  at: string
  sessionId: string
  sessionLabel: string
}

export function submitCheckin(token: string, body: { name: string; studentId: string }) {
  return apiRequest<CheckinResult>(
    `/api/applications/checkin/${encodeURIComponent(token)}`,
    jsonInit('POST', body),
  )
}

// ===== 招新（学生侧） =====

/**
 * 提交报名表（multipart）。报名表文件按后台「对象存储」页的
 * applications 目标桶存取；不要手动设置 content-type，交给浏览器带 boundary。
 */
/**
 * 提交报名表（multipart）。
 *
 * 同一学号已有记录时，后端会返回 409 `REPLACE_CONFIRM` 要求确认；
 * `replace = true` 表示同学已确认 —— 会替换材料并删除旧文件。
 * 确认笔试名单后材料锁死，替换会被拒（MATERIAL_LOCKED）。
 */
export function submitApplication(form: FormData, replace = false) {
  return apiRequest<Application>(
    `/api/applications${replace ? '?replace=true' : ''}`,
    { method: 'POST', body: form },
    { timeoutMs: 120_000 },
  )
}

/** 进度页要用到的本届安排（时间都是后台配置里的全局时间窗） */
export interface RecruitSchedule {
  writtenAt: string
  writtenPlace: string
  interviewAt: string
  interviewPlace: string
  defenseStart: string
  defenseEnd: string
  onboardDeadline: string
}

export interface MyApplicationResponse {
  phase: RecruitPhase
  cycleName: string
  notice: string
  schedule: RecruitSchedule
  application: Application | null
  /** 已发出邀请函时给出确认页地址，省得同学翻邮箱找链接 */
  inviteUrl?: string
}

export function myApplication(signal?: AbortSignal) {
  return apiRequest<MyApplicationResponse>('/api/applications/me', { signal })
}

// ===== 招新（邀请函确认页） =====

export interface InviteInfo {
  alreadyMember: boolean
  name: string
  studentId: string
  email?: string
  expiresAt?: string
  roleOptions?: readonly string[]
  joinYear?: string
  cycleName?: string
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

// ===== 招新（后台：周期 / 模板 / 看板 / 自动流程） =====

export interface AdminRecruitSettings {
  cycle: RecruitCycleConfig
  templates: RecruitTemplates
  phase: RecruitPhase
  /** 招新模块现在对管理员是否开放（非招新期菜单收起） */
  moduleOpen: boolean
  notice: string
  /** 模板里写错的变量，按模板分类给出提示 */
  unknownVariables: Record<string, string[]>
}

export function adminGetRecruit() {
  return apiRequest<AdminRecruitSettings>('/api/admin/recruit')
}

export function adminSaveRecruit(patch: {
  cycle?: Partial<RecruitCycleConfig>
  templates?: Partial<RecruitTemplates>
}) {
  return apiRequest<{ cycle: RecruitCycleConfig; templates: RecruitTemplates; phase: RecruitPhase }>(
    '/api/admin/recruit',
    jsonInit('PUT', patch),
  )
}

export function adminGetRecruitBoard() {
  return apiRequest<RecruitBoard>('/api/admin/recruit/board')
}

export function adminPreviewRecruitAuto(task: RecruitAutoTask, selectedIds: string[] = []) {
  const search = new URLSearchParams({ task })
  if (selectedIds.length > 0) search.set('selected', selectedIds.join(','))
  return apiRequest<RecruitAutoPreview>(`/api/admin/recruit/auto?${search}`)
}

export interface RunRecruitAutoResult {
  task: RecruitAutoTask
  moved: number
  mail: {
    sent: number
    failed: number
    summary: string
    results: Array<{ kind: string; sent: boolean; code: string; message: string; to: string }>
  }
  archive: { url: string; total: number } | null
  preview: RecruitAutoPreview
}

export function adminRunRecruitAuto(body: {
  task: RecruitAutoTask
  selectedIds?: string[]
  force?: boolean
}) {
  return apiRequest<RunRecruitAutoResult>(
    '/api/admin/recruit/auto',
    jsonInit('POST', body),
    { timeoutMs: 120_000 },
  )
}

/** 名单导出下载地址：直接交给浏览器打开即可下载 CSV */
export function recruitExportUrl(params: { stage?: string; result?: string; q?: string } = {}) {
  const search = new URLSearchParams()
  if (params.stage) search.set('stage', params.stage)
  if (params.result !== undefined) search.set('result', params.result)
  if (params.q) search.set('q', params.q)
  const suffix = search.toString() ? `?${search}` : ''
  return `/api/admin/recruit/export${suffix}`
}

export interface MailLogRow {
  id: string
  applicationId: string
  kind: string
  recipient: string
  subject: string
  ok: boolean
  code: string
  message: string
  actor: string
  createdAt: string
}

export function adminGetRecruitMails(limit = 200) {
  return apiRequest<{ logs: MailLogRow[] }>(`/api/admin/recruit/mails?limit=${limit}`)
}

// ===== 招新（后台：考试场次与签到二维码） =====

/** 后台看到的场次：比契约多出派生称呼、时间文本与到场人数 */
export interface AdminSession {
  id: string
  stage: CheckinStage
  name: string
  startsAt: string
  endsAt: string
  place: string
  note: string
  sortOrder: number
  /** 场次称呼（没填名字时按该阶段序号兜底） */
  label: string
  stageLabel: string
  /** 时间文本，如「2026 年 10 月 8 日 14:00–16:00」 */
  timeText: string
  checkinCount: number
}

/** 仍有效的签到二维码（同一场次至多一张） */
export interface AdminCheckinCode {
  sessionId: string
  stage: string
  sessionLabel: string
  expiresAt: string
  url: string
  createdBy: string
  createdAt: string
}

export interface AdminSessionsPayload {
  sessions: AdminSession[]
  codes: AdminCheckinCode[]
}

export function adminListSessions() {
  return apiRequest<AdminSessionsPayload>('/api/admin/recruit/sessions')
}

export interface SessionInput {
  stage: CheckinStage
  name?: string
  startsAt: string
  endsAt?: string
  place?: string
  note?: string
  sortOrder?: number
}

export function adminCreateSession(body: SessionInput) {
  return apiRequest<{ session: AdminSession }>(
    '/api/admin/recruit/sessions',
    jsonInit('POST', body),
  )
}

export function adminUpdateSession(id: string, body: Partial<SessionInput>) {
  return apiRequest<{ session: AdminSession }>(
    `/api/admin/recruit/sessions/${encodeURIComponent(id)}`,
    jsonInit('PUT', body),
  )
}

export function adminDeleteSession(id: string) {
  return apiRequest<{ id: string }>(
    `/api/admin/recruit/sessions/${encodeURIComponent(id)}`,
    jsonInit('DELETE'),
  )
}

export interface IssuedCheckinCode {
  token: string
  expiresAt: string
  /** 二维码里要编码的绝对地址 */
  url: string
  sessionId: string
  stage: CheckinStage
  sessionLabel: string
}

/**
 * 签发该场次的签到二维码。**会把该场旧码一并作废**（同一场次至多一张有效码），
 * 因为二维码会被拍照转发，重发往往正是因为旧码泄了。
 */
export function adminIssueCheckinToken(sessionId: string, ttlHours?: number) {
  return apiRequest<IssuedCheckinCode>(
    `/api/admin/recruit/sessions/${encodeURIComponent(sessionId)}/checkin-token`,
    jsonInit('POST', ttlHours ? { ttlHours } : {}),
  )
}

/** 作废签到二维码：给 sessionId 只作废那一场，否则作废全部 */
export function adminRevokeCheckinTokens(sessionId?: string) {
  return apiRequest<{ revoked: number }>(
    '/api/admin/recruit/checkin-tokens/revoke',
    jsonInit('POST', sessionId ? { sessionId } : {}),
  )
}

// ===== 招新（后台：报名明细） =====

/** 后台视图比学生视图多出邀请链接与派生标签 */
export interface AdminApplication extends Application {
  inviteToken: string
  inviteUrl: string
  stageLabel: string
  resultLabel: string
  statusLabel: string
}

export interface AdminApplicationList {
  items: AdminApplication[]
  total: number
}

export function adminListApplications(
  params: {
    stages?: RecruitStage[]
    /** 注意：传空数组表示不过滤；想看「尚无结论」要显式传 [''] */
    results?: RecruitResult[]
    q?: string
    limit?: number
    offset?: number
  } = {},
) {
  const search = new URLSearchParams()
  if (params.stages?.length) search.set('stage', params.stages.join(','))
  if (params.results) search.set('result', params.results.join(','))
  if (params.q) search.set('q', params.q)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  const suffix = search.toString() ? `?${search}` : ''
  return apiRequest<AdminApplicationList>(`/api/admin/applications${suffix}`)
}

export interface ApplicationDetail {
  application: AdminApplication
  mails: MailLogRow[]
}

export function adminGetApplication(id: string) {
  return apiRequest<ApplicationDetail>(`/api/admin/applications/${encodeURIComponent(id)}`)
}

export interface ManualApplicationInput {
  name: string
  studentId: string
  email?: string
  phone?: string
  qq?: string
}

/**
 * 补录未报名考生（现场来考的人）。
 * 不要求报名表文件，联系方式全部可选 —— 人已经在考场里了，缺什么后补。
 */
export function adminCreateApplication(body: ManualApplicationInput) {
  return apiRequest<{ application: AdminApplication }>(
    '/api/admin/applications',
    jsonInit('POST', body),
  )
}

export interface UpdateApplicationBody {
  stage?: RecruitStage
  result?: RecruitResult
  /** 勾选 / 取消签到（value: false 表示取消） */
  checkin?: { stage: CheckinStage; value?: boolean }
  writtenScore?: string
  interviewScore?: string
  defenseScore?: string
  writtenNote?: string
  interviewNote?: string
  defenseNote?: string
  note?: string
  email?: string
  phone?: string
  qq?: string
  /** 补发某封信（状态不变也能发） */
  notice?: RecruitMailKind
}

export interface UpdateApplicationResult {
  application: AdminApplication
  /** 本次触发的邮件结果；没有发信时为 null */
  mail: { kind: RecruitMailKind; sent: boolean; code: string; message: string; to: string } | null
}

export function adminUpdateApplication(id: string, body: UpdateApplicationBody) {
  return apiRequest<UpdateApplicationResult>(
    `/api/admin/applications/${encodeURIComponent(id)}`,
    jsonInit('PUT', body),
    { timeoutMs: 60_000 },
  )
}

export function adminBulkApplications(body: {
  ids: string[]
  action: 'checkin' | 'absent' | 'withdraw'
  stage?: CheckinStage
}) {
  return apiRequest<{ moved: number }>(
    '/api/admin/applications/bulk',
    jsonInit('POST', body),
    { timeoutMs: 60_000 },
  )
}

export function adminNotifyApplications(body: { ids: string[]; subject: string; body: string }) {
  return apiRequest<{
    summary: string
    results: Array<{ sent: boolean; code: string; message: string; to: string }>
  }>('/api/admin/applications/notify', jsonInit('POST', body), { timeoutMs: 120_000 })
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

// ===== 对象存储 =====

export interface StorageStatusResponse {
  /** secret 已抹除的配置（secretAccessKey → secretConfigured 布尔） */
  config: StorageConfigView
  /** worker 侧已注册的适配器 id（内置 + 插件） */
  providers: string[]
  /** env 中检测到的 R2 桶绑定名，供 r2 模式选择 */
  bindings: string[]
  ready: Record<StoragePurpose, boolean>
}

export function adminGetStorage() {
  return apiRequest<StorageStatusResponse>('/api/admin/storage')
}

export function adminUpdateStorage(patch: {
  site?: Partial<StorageTargetConfig>
  applications?: Partial<StorageTargetConfig>
}) {
  return apiRequest<{ config: StorageConfigView }>('/api/admin/storage', jsonInit('PUT', patch))
}

export function adminTestStorage(purpose: StoragePurpose) {
  return apiRequest<{ ok: boolean; message: string }>(
    '/api/admin/storage/test',
    jsonInit('POST', { purpose }),
    { timeoutMs: 30_000 },
  )
}

/** 签发直连访问：s3 模式返回预签名 URL（真直连），r2 模式返回一次性令牌地址 */
export function adminIssueDirectToken(body: { purpose: StoragePurpose; key: string; action: 'get' | 'put'; ttlSeconds?: number }) {
  return apiRequest<DirectAccessInfo>('/api/admin/storage/direct-token', jsonInit('POST', body))
}
