/** 后端接口的类型化封装。页面只依赖这里，不直接拼 URL。 */

import type {
  DirectAccessInfo,
  StorageConfigView,
  StoragePurpose,
  StorageTargetConfig,
} from '@shared/storage'
import type {
  CheckinStage,
  RecruitAction,
  MaterialStatus,
  RecruitActionResult,
  RecruitCheckinCodeMap,
  RecruitCycleConfig,
  RecruitMailKind,
  RecruitProgressInfo,
  RecruitPublicStatus,
  RecruitResult,
  RecruitStage,
  RecruitStats,
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

/**
 * 首屏聚合里顺带带的招新状态（与 `/api/public/recruit` 同一形状）。
 * 首页横幅、顶部提示的显隐由它派生 —— 不必再发一次请求，也没有「招新总开关」可配。
 */
export type RecruitStatusInfo = RecruitPublicStatus

export interface BootstrapData {
  members: Member[]
  projects: Project[]
  news: NewsItem[]
  slides: Slide[]
  site: SiteConfig
  recruit: RecruitStatusInfo
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
  /** SMTP 密码来自哪里（密码本身永不下发，只告知有没有、在哪） */
  mailPasswordSource: 'database' | 'env' | 'none'
}

export function adminGetConfig() {
  return apiRequest<AdminConfigResponse>('/api/admin/config')
}

export function adminUpdateConfig(patch: { site?: Partial<SiteConfig>; runtime?: Partial<RuntimeConfig> }) {
  return apiRequest<{
    site: SiteConfig | null
    runtime: RuntimeConfig | null
    /** 保存后 SMTP 密码的来源（数据库 / 环境变量 / 未设置） */
    mailPasswordSource?: 'database' | 'env' | 'none'
  }>('/api/admin/config', jsonInit('PUT', patch))
}

// ===== 招新（公开：报名页与签到页用） =====

export type RecruitStatus = RecruitPublicStatus

export function fetchRecruitStatus(signal?: AbortSignal) {
  return apiRequest<RecruitStatus>('/api/public/recruit', { signal })
}

export interface CheckinInfo {
  stage: CheckinStage
  /** 阶段中文名，如「笔试」 */
  stageLabel: string
  cycleName: string
  studioName: string
}

/**
 * 读取签到页要展示的信息。`token` 就是二维码里的凭证（只绑阶段 + 带失效时间），
 * 无效 / 过期 / 被作废时后端返回 404，且不透露任何信息。
 */
export function fetchCheckinInfo(token: string, signal?: AbortSignal) {
  return apiRequest<CheckinInfo>(`/api/applications/checkin/${encodeURIComponent(token)}`, { signal })
}

export interface CheckinResult {
  already: boolean
  name: string
  stage: CheckinStage
  stageLabel: string
  at: string
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

export interface MyApplicationResponse {
  /** 整届状态（报名中 / 笔试中 / 已截止…），进度页据此显示说明 */
  state: RecruitProgressInfo['state']
  cycleName: string
  notice: string
  /** 他此刻该进哪个群（报名阶段为空 —— 还没分群） */
  groupLabel: string
  group: string
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

// ===== 招新（后台：整届状态 / 模板 / 动作 / 签到二维码） =====

export interface AdminRecruitSettings {
  cycle: RecruitCycleConfig
  templates: RecruitTemplates
  /** 模板里写错的变量，按模板分类给出提示 */
  unknownVariables: Record<string, string[]>
}

export function adminGetRecruit() {
  return apiRequest<AdminRecruitSettings>('/api/admin/recruit')
}

/**
 * 保存本届名称 / 四个群号 / 邮件模板。
 *
 * 界面上分属两处、边界清晰（判据：下一届还要不要重新填一次）：
 * - **跨届通用** → 「设置」页（`RecruitSettingsView`）：八封邮件模板、官网招新文案；
 * - **只属于本届** → 「流程」页的本届信息面板（`CycleInfoPanel`）：名称、四个 QQ 群号。
 *
 * 注意**不接受 `state`** —— 整届状态只能通过 `adminRunRecruitAction` 推进，
 * 否则「保存一下」就可能把流程跳到别的阶段。
 */
export function adminSaveRecruit(patch: {
  cycle?: Partial<RecruitCycleConfig>
  templates?: Partial<RecruitTemplates>
}) {
  return apiRequest<{ cycle: RecruitCycleConfig; templates: RecruitTemplates }>(
    '/api/admin/recruit',
    jsonInit('PUT', patch),
  )
}

export function adminGetRecruitStats() {
  return apiRequest<RecruitStats>('/api/admin/recruit/stats')
}

export interface RunRecruitActionResult extends RecruitActionResult {
  /** 这次动作在按钮上的名字 */
  label: string
  /** 接下来该做什么（后台直接提示，省得对着流程图数） */
  next: { action: RecruitAction; label: string } | null
}

/**
 * 推进整届：开启报名、结束报名、确认名单、结束考试、关闭本届……
 * 可用动作与校验规则在 `shared/recruit.ts` 的 `RECRUIT_ACTION_META`，前后端读同一张表。
 */
export function adminRunRecruitAction(body: { action: RecruitAction; selectedIds?: string[] }) {
  return apiRequest<RunRecruitActionResult>(
    '/api/admin/recruit/actions',
    jsonInit('POST', body),
    { timeoutMs: 180_000 },
  )
}

export function adminListCheckinCodes() {
  return apiRequest<{ codes: RecruitCheckinCodeMap }>('/api/admin/recruit/checkin-codes')
}

/**
 * 签发某阶段的签到二维码。**会自动作废该阶段旧码** ——
 * 二维码会被拍照转发，重发往往正是因为旧码泄了，两张都有效等于作废动作白做。
 */
export function adminIssueCheckinCode(stage: CheckinStage, ttlHours?: number) {
  return apiRequest<{ code: NonNullable<RecruitCheckinCodeMap[CheckinStage]>; url: string }>(
    '/api/admin/recruit/checkin-codes',
    jsonInit('POST', ttlHours ? { stage, ttlHours } : { stage }),
  )
}

export function adminRevokeCheckinCode(stage?: CheckinStage) {
  return apiRequest<{ revoked: number }>(
    '/api/admin/recruit/checkin-codes/revoke',
    jsonInit('POST', stage ? { stage } : {}),
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
  /**
   * apply（默认）= 补录进报名阶段，不要求报名表、联系方式可选；
   * written = 笔试现场补录，邮箱 / 手机 / QQ / 报名表都要给，录入即视为已参加笔试。
   */
  stage?: 'apply' | 'written'
}

/**
 * 补录未报名考生（现场来考的人）。
 * 带报名表时（笔试现场补录）自动改走 multipart；不带就是普通 JSON。
 */
export function adminCreateApplication(body: ManualApplicationInput, file?: File | null) {
  if (file) {
    const form = new FormData()
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null && value !== '') form.append(key, String(value))
    }
    form.append('file', file)
    return apiRequest<{ application: AdminApplication }>(
      '/api/admin/applications',
      { method: 'POST', body: form },
      { timeoutMs: 120_000 },
    )
  }
  return apiRequest<{ application: AdminApplication }>(
    '/api/admin/applications',
    jsonInit('POST', body),
    { timeoutMs: 60_000 },
  )
}

export interface UpdateApplicationBody {
  stage?: RecruitStage
  result?: RecruitResult
  /**
   * 「改全部资料」：姓名 / 学号 / 联系方式都能改（学号撞别人会返回 409 `ALREADY_EXISTS`）。
   * 报名表本身不在这里改，走 `adminUploadApplicationDoc`。
   */
  name?: string
  studentId?: string
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
  /**
   * 材料审核（只在报名阶段与「待确认笔试名单」期间可用）：
   * `approved` 通过 / `rejected` 驳回 / `''` 退回待审核。
   * **驳回会自动发出一封「材料驳回通知」**，所以必须同时给出理由。
   */
  material?: MaterialStatus
  /** 驳回理由（必填，会写进给同学的邮件） */
  materialReason?: string
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
  /** approve_material / reject_material 都是材料审核；后者必须带 materialReason */
  action: 'checkin' | 'absent' | 'withdraw' | 'approve_material' | 'reject_material'
  stage?: CheckinStage
  materialReason?: string
}) {
  return apiRequest<{
    moved: number
    /** 批量驳回会逐人发信，这里给出汇总（其余批量动作没有信） */
    mail: { sent: number; failed: number; summary: string } | null
  }>('/api/admin/applications/bulk', jsonInit('POST', body), { timeoutMs: 120_000 })
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

/**
 * 后补 / 替换报名表（multipart）。
 *
 * 存在的理由：补录时同学常真的没带材料，而「报名时上传」是过去唯一的入口 ——
 * 错过就再也补不上。校验与官网报名完全一致（大小 / 后缀 / 文件头魔数），
 * 成功后**旧文件会被删掉**，下载名统一为「姓名+学号+报名表」。
 */
export function adminUploadApplicationDoc(id: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<{ application: AdminApplication }>(
    `/api/admin/applications/${encodeURIComponent(id)}/file`,
    { method: 'POST', body: form },
    { timeoutMs: 120_000 },
  )
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
