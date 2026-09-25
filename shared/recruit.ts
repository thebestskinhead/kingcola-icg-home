/**
 * 招新（报名）契约 —— 状态模型、周期配置、邮件模板、自动流程。
 *
 * 这是整个招新模块的**唯一事实源**：前端、后台、Worker、Cron 都引它。
 * 改规则只改这里，不会出现「后台显示通过、Worker 认为是未通过」这类分歧。
 *
 * ── 状态模型 ───────────────────────────────────────────────
 * 不再用单列枚举描述「报名状态」，而是 **阶段 + 该阶段结果** 两个属性：
 *
 *   stage  当前处在哪一段：报名 / 笔试 / 面试 / 答辩(预备期) / 转正
 *   result 这一段的结果：待定 / 已参加 / 通过 / 未通过 / 未参加 / 婉拒 / 退出
 *
 * 「笔试是否已安排、面试时间是什么」不是个人状态，而是**全局周期配置**（见 RecruitCycleConfig），
 * 所以 stage=written 且 result='' 就表示「在等笔试」，不需要再存一个 scheduled。
 * 可读的中文标签由 `applicationLabel()` 派生，**不入库**，永远不会两处不一致。
 *
 * ── 邮件 ───────────────────────────────────────────────────
 * 5 类共 7 条模板（感谢信按阶段分 3 条），文案与开关都存在后台可改的配置里，
 * 支持 `{变量}` 占位（见 RECRUIT_MAIL_VARIABLES）。
 */

import { formatLimit } from './resources'
import { cnTimeToEpoch, cnTimeToText } from './time'
import type { Application } from './types'

// ============================================================================
// 一、阶段与结果
// ============================================================================

export type RecruitStage = 'apply' | 'written' | 'interview' | 'defense' | 'onboard'

export const RECRUIT_STAGES: readonly RecruitStage[] = [
  'apply',
  'written',
  'interview',
  'defense',
  'onboard',
]

export const RECRUIT_STAGE_LABELS: Record<RecruitStage, string> = {
  apply: '报名',
  written: '笔试',
  interview: '面试',
  defense: '答辩',
  onboard: '转正',
}

/** 阶段说明（后台页签提示） */
export const RECRUIT_STAGE_HINTS: Record<RecruitStage, string> = {
  apply: '已提交报名表、等待安排笔试的同学',
  written: '笔试环节：签到、录入成绩、生成面试名单',
  interview: '面试环节：签到、录取，录取后进入预备期',
  defense: '预备期 / 答辩：考核通过后转正',
  onboard: '已发邀请函，等待本人确认加入',
}

/**
 * 该阶段的结果。空串 '' 表示「尚无结论 / 正在进行」。
 * 刻意没有「已安排」——是否已安排是全局周期的事，不是每个人的状态。
 */
export type RecruitResult =
  | ''
  | 'attended'
  | 'passed'
  | 'failed'
  | 'absent'
  | 'declined'
  | 'withdrawn'

export const RECRUIT_RESULT_LABELS: Record<Exclude<RecruitResult, ''>, string> = {
  attended: '已参加',
  passed: '通过',
  failed: '未通过',
  absent: '未参加',
  declined: '婉拒',
  withdrawn: '退出',
}

/** 每个阶段允许出现的结果（校验用；withdrawn 任何阶段都可） */
export const STAGE_RESULTS: Record<RecruitStage, readonly RecruitResult[]> = {
  apply: ['', 'failed', 'withdrawn'],
  written: ['', 'attended', 'passed', 'failed', 'absent', 'withdrawn'],
  interview: ['', 'attended', 'passed', 'failed', 'absent', 'withdrawn'],
  defense: ['', 'passed', 'failed', 'withdrawn'],
  onboard: ['', 'passed', 'declined', 'withdrawn'],
}

export function isRecruitStage(value: string): value is RecruitStage {
  return (RECRUIT_STAGES as readonly string[]).includes(value)
}

export function isRecruitResult(value: string): value is RecruitResult {
  if (value === '') return true
  return Object.prototype.hasOwnProperty.call(RECRUIT_RESULT_LABELS, value)
}

export function isValidStageResult(stage: RecruitStage, result: RecruitResult): boolean {
  return STAGE_RESULTS[stage].includes(result)
}

// ============================================================================
// 二、派生标签（不入库）
// ============================================================================

/** 这个组合在流程里的性质，用于配色 */
export type RecruitTone = 'pending' | 'active' | 'passed' | 'failed' | 'done'

/** 阶段 + 结果 → 给同学看的中文（后台筛选按钮也用同一份） */
export function applicationLabel(stage: RecruitStage, result: RecruitResult): string {
  if (result === 'withdrawn') return '已退出报名'

  switch (stage) {
    case 'apply':
      return result === 'failed' ? '未通过初筛' : '已提交报名'
    case 'written':
      switch (result) {
        case 'attended':
          return '已参加笔试'
        case 'passed':
          return '笔试通过'
        case 'failed':
          return '笔试未通过'
        case 'absent':
          return '笔试未参加'
        default:
          return '待参加笔试'
      }
    case 'interview':
      switch (result) {
        case 'attended':
          return '已参加面试'
        case 'passed':
          return '面试通过'
        case 'failed':
          return '面试未通过'
        case 'absent':
          return '面试未参加'
        default:
          return '待参加面试'
      }
    case 'defense':
      switch (result) {
        case 'passed':
          return '答辩通过'
        case 'failed':
          return '答辩未通过'
        default:
          return '预备期中'
      }
    case 'onboard':
      switch (result) {
        case 'passed':
          return '正式成员'
        case 'declined':
          return '已婉拒邀请'
        default:
          return '已发邀请函'
      }
  }
}

export function applicationTone(stage: RecruitStage, result: RecruitResult): RecruitTone {
  if (result === 'withdrawn' || result === 'failed' || result === 'absent' || result === 'declined') {
    return 'failed'
  }
  if (stage === 'onboard' && result === 'passed') return 'done'
  if (result === 'passed') return 'passed'
  if (result === 'attended') return 'active'
  // 待定：报名阶段算「待处理」，后续阶段算「进行中」
  return stage === 'apply' ? 'pending' : 'active'
}

/** 流程是否已经结束（不会再自动往下走） */
export function isApplicationFinished(stage: RecruitStage, result: RecruitResult): boolean {
  if (result === 'withdrawn' || result === 'failed' || result === 'absent') return true
  if (stage === 'onboard') return result === 'passed' || result === 'declined'
  return false
}

/** 是否还在候选池里（看板与「待处理」计数用） */
export function isApplicationActive(application: Pick<Application, 'stage' | 'result'>): boolean {
  return !isApplicationFinished(application.stage, application.result)
}

/** 阶段序号（0 起），进度条用 */
export function stageIndex(stage: RecruitStage): number {
  return RECRUIT_STAGES.indexOf(stage)
}

// ============================================================================
// 三、流转规则
// ============================================================================

/**
 * 允许的跨阶段迁移：**只能一步一步走，也允许退回一步改判**。
 * 例如 `written → interview` 可以，`written → defense` 不行（那等于跳过面试）。
 */
export function canMoveStage(from: RecruitStage, to: RecruitStage): boolean {
  if (from === to) return false
  return Math.abs(stageIndex(from) - stageIndex(to)) === 1
}

/** 当前阶段可推进到的下一阶段 */
export function nextStageOf(stage: RecruitStage): RecruitStage | null {
  return RECRUIT_STAGES[stageIndex(stage) + 1] ?? null
}

/** 当前阶段可退回的上一阶段（改判用） */
export function prevStageOf(stage: RecruitStage): RecruitStage | null {
  return RECRUIT_STAGES[stageIndex(stage) - 1] ?? null
}

/** 退出报名：任何未结束的状态都能进 */
export function canWithdraw(stage: RecruitStage, result: RecruitResult): boolean {
  return !isApplicationFinished(stage, result)
}

// ============================================================================
// 四、报名表单与材料
// ============================================================================

/** 报名表（PDF / DOCX）体积上限 —— 前端提示与 Worker 校验共用 */
export const APPLICATION_DOC_LIMIT = 20 * 1024 * 1024

/** 报名表在存储桶里的逻辑前缀；同时决定它归属 applications 目标、且被当作私有文件（仅管理员可下载） */
export const APPLICATION_DOC_SCOPE = 'applications'

/** 关闭本届时导出的名单存档（同样落在 applications 前缀下 → 自动私有） */
export const RECRUIT_ARCHIVE_SCOPE = `${APPLICATION_DOC_SCOPE}/archives`

export const APPLICATION_DOC_ACCEPT = '.pdf,.docx'

export const APPLICATION_DOC_HINT = `支持 PDF / DOCX，单个文件不超过 ${formatLimit(
  APPLICATION_DOC_LIMIT,
)}。仅修改后缀的文件无法通过校验。`

/** 11 位大陆手机号 */
export const APPLICATION_PHONE_PATTERN = /^1\d{10}$/

/** QQ 号：5–12 位数字 */
export const APPLICATION_QQ_PATTERN = /^\d{5,12}$/

/** 邮箱：宽松校验即可，真正的有效性靠发信验证 */
export const APPLICATION_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ApplicationFormInput {
  email: string
  phone: string
  qq: string
}

/** 校验报名表单；返回 null 表示通过。前端与 Worker 共用，避免两端规则跑偏。 */
export function validateApplicationForm(input: Partial<ApplicationFormInput>): string | null {
  const email = (input.email ?? '').trim()
  if (!email) return '请填写邮箱，后续的笔试 / 面试通知都会发到这里'
  if (!APPLICATION_EMAIL_PATTERN.test(email)) return '邮箱格式不正确'

  const phone = (input.phone ?? '').trim()
  if (!phone) return '请填写手机号，便于面试安排时联系你'
  if (!APPLICATION_PHONE_PATTERN.test(phone)) return '请填写正确的 11 位手机号'

  const qq = (input.qq ?? '').trim()
  if (!qq) return '请填写 QQ 号，我们会建立招新通知群'
  if (!APPLICATION_QQ_PATTERN.test(qq)) return 'QQ 号应为 5–12 位数字'

  return null
}

// ============================================================================
// 五、邀请函
// ============================================================================

/** 邀请函链接的兜底有效期（未配置转正截止时用它） */
export const APPLICATION_INVITE_TTL_HOURS = 14 * 24

/** 邀请函过期时间（ISO 字符串，与转正截止取较早者由调用方决定） */
export function applicationInviteExpiry(
  from: Date = new Date(),
  fallbackHours = APPLICATION_INVITE_TTL_HOURS,
): string {
  return new Date(from.getTime() + fallbackHours * 3600 * 1000).toISOString()
}

/** 邀请函是否仍可用（已转正、已过期、状态不对都返回 false） */
export function isInviteUsable(
  expiresAt: string,
  stage: RecruitStage,
  result: RecruitResult,
): boolean {
  if (stage !== 'onboard' || result !== '') return false
  const expires = Date.parse(expiresAt)
  return Number.isFinite(expires) && expires > Date.now()
}

// ============================================================================
// 六、签到（真扫码：二维码 = 带凭证的签到链接，绑场次 + 带失效时间）
// ============================================================================

export type CheckinStage = 'written' | 'interview' | 'defense'

export const CHECKIN_STAGES: readonly CheckinStage[] = ['written', 'interview', 'defense']

export function isCheckinStage(value: string): value is CheckinStage {
  return (CHECKIN_STAGES as readonly string[]).includes(value)
}

/**
 * 签到页路径。**必须带凭证**（`/checkin/<token>`），没有裸入口：
 * 签到页只从二维码进来，导航里不出现，直接访问裸路径按「找不到页面」处理。
 */
export const CHECKIN_PATH = '/checkin'

/** 签到二维码指向的地址；token 来自 recruit_checkin_tokens */
export function checkinTokenPath(token: string): string {
  return `${CHECKIN_PATH}/${encodeURIComponent(token)}`
}

/**
 * 签到二维码是否还能用。过期或已作废都不行 ——
 * 二维码会被拍照、会被贴在场馆墙上，所以「失效时间 + 一键作废」是必需的。
 */
export function isCheckinTokenUsable(
  expiresAt: string,
  revokedAt: string,
  now: Date = new Date(),
): boolean {
  if (revokedAt) return false
  const expires = Date.parse(expiresAt)
  // 没设失效时间的码视为长期有效（后台可以随时作废）；设了就必须还没到点
  if (!Number.isFinite(expires)) return true
  return expires > now.getTime()
}

/** 生成二维码时默认给多长的有效期 */
export const CHECKIN_TOKEN_TTL_HOURS = 12

// ============================================================================
// 六之二、考试场次（笔试 / 面试 / 答辩各自可以有多场）
//
// 采用「开放参加制」：邀请函列出全部场次，同学现场任选一场参加，
// 签到按当场二维码记到场次（所以不需要预先给每个人排场次，也天然容纳临时来考的人）。
// 场次存在 recruit_sessions 表（不是周期 JSON），因为签到凭证要引用它、还要按场次统计。
// ============================================================================

/** 场次所属阶段，与签到阶段是同一套取值 */
export type SessionStage = CheckinStage

export const SESSION_STAGE_LABELS: Record<SessionStage, string> = {
  written: '笔试',
  interview: '面试',
  defense: '答辩',
}

export interface RecruitSession {
  id: string
  stage: SessionStage
  /** 场次名，如「第一场」「上午场」；留空时按顺序显示「第 N 场」 */
  name: string
  /** 起止时间，北京时间字符串 YYYY-MM-DDTHH:mm（与周期配置同一套约定） */
  startsAt: string
  endsAt: string
  /** 地点 / 形式，如「一教 305」「腾讯会议 123-456-789」 */
  place: string
  /** 备注，会写进邀请函，如「请自带电脑」 */
  note: string
  /** 展示与邀请函里的排序 */
  sortOrder: number
}

export const SESSION_NAME_LIMIT = 40
export const SESSION_PLACE_LIMIT = 80
export const SESSION_NOTE_LIMIT = 200

/** 场次名：没填就给个序号兜底的称呼 */
export function sessionLabel(session: RecruitSession, index: number): string {
  return session.name.trim() || `第 ${index + 1} 场`
}

/** 某阶段的场次，按 sortOrder → 开始时间排序 */
export function sessionsOfStage(
  sessions: readonly RecruitSession[],
  stage: SessionStage,
): RecruitSession[] {
  return sessions
    .filter((session) => session.stage === stage)
    .slice()
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        (cnTimeToEpoch(a.startsAt) ?? 0) - (cnTimeToEpoch(b.startsAt) ?? 0),
    )
}

/** 单个场次的时间文本：`2026 年 10 月 8 日 14:00–16:00`（同一天不重复写日期） */
export function sessionTimeText(session: Pick<RecruitSession, 'startsAt' | 'endsAt'>): string {
  const start = cnTimeToText(session.startsAt)
  if (!start) return ''
  const endFull = cnTimeToText(session.endsAt)
  if (!endFull) return start
  const sameDay = session.startsAt.slice(0, 10) === session.endsAt.slice(0, 10)
  const end = sameDay ? endFull.replace(/^.*?日\s*/, '') : endFull
  return `${start}–${end}`
}

/**
 * 场次列表 → 邮件正文里的多行文本（`{writtenSessions}` / `{interviewSessions}`）。
 * 一行一场：「第一场 · 2026 年 10 月 8 日 14:00–16:00 · 一教 305」，有备注再另起一行。
 */
export function sessionsToText(sessions: readonly RecruitSession[]): string {
  return sessions
    .map((session, index) => {
      const line = [
        sessionLabel(session, index),
        sessionTimeText(session),
        session.place.trim(),
      ]
        .filter(Boolean)
        .join(' · ')
      const note = session.note.trim()
      return note ? `${line}\n（${note}）` : line
    })
    .join('\n')
}

/** 一组场次里最晚的结束时刻（epoch 毫秒）；空列表返回 null */
export function lastSessionEnd(sessions: readonly RecruitSession[]): number | null {
  let latest: number | null = null
  for (const session of sessions) {
    const end = cnTimeToEpoch(session.endsAt || session.startsAt)
    if (end !== null && (latest === null || end > latest)) latest = end
  }
  return latest
}

/** 校验收到的场次数据（后台表单与 Worker 共用）；返回 null 表示通过 */
export function validateSession(input: Partial<RecruitSession>): string | null {
  if (!input.stage || !isCheckinStage(input.stage)) return '场次阶段不合法'
  const startsAt = (input.startsAt ?? '').trim()
  if (!startsAt) return '请填写开始时间'
  if (cnTimeToEpoch(startsAt) === null) return '开始时间格式应为 2026-10-08T14:00'
  const endsAt = (input.endsAt ?? '').trim()
  if (endsAt) {
    const end = cnTimeToEpoch(endsAt)
    if (end === null) return '结束时间格式应为 2026-10-08T16:00'
    if (end <= (cnTimeToEpoch(startsAt) ?? 0)) return '结束时间必须晚于开始时间'
  }
  if ((input.name ?? '').trim().length > SESSION_NAME_LIMIT) return '场次名太长了'
  if ((input.place ?? '').trim().length > SESSION_PLACE_LIMIT) return '地点太长了'
  if ((input.note ?? '').trim().length > SESSION_NOTE_LIMIT) return '备注太长了'
  return null
}

export interface CheckinRequest {
  /** 同学自己填写的姓名与学号 —— 与报名记录一致才算签到成功 */
  name: string
  studentId: string
}

export function validateCheckin(input: Partial<CheckinRequest>): string | null {
  if (!(input.name ?? '').trim()) return '请填写姓名'
  if (!(input.studentId ?? '').trim()) return '请填写学号'
  return null
}

/** 姓名比对用的宽松归一化：忽略空格与大小写 */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

/**
 * 签到时这条记录能不能算「该阶段的参与者」。
 *
 * - `current`：正处在这个阶段 → 正常签到
 * - `ahead`：还没被推进到该阶段（例如报名后后台还没来得及发笔试邀请就开考了）→ 也允许签到，
 *   签到本身会把他推进到该阶段。人在考场就不能因为后台没点按钮而签不上。
 * - `behind`：已经走到后面的阶段了（例如面试完了来扫笔试码）→ 拒绝，并提示他看自己的进度
 * - `closed`：流程已结束（淘汰 / 退出 / 已转正）→ 拒绝
 */
export type CheckinEligibility = 'current' | 'ahead' | 'behind' | 'closed'

export function checkinEligibility(
  recordStage: RecruitStage,
  recordResult: RecruitResult,
  stage: CheckinStage,
): CheckinEligibility {
  if (isApplicationFinished(recordStage, recordResult)) return 'closed'
  const recordIndex = stageIndex(recordStage)
  const targetIndex = stageIndex(stage)
  if (recordIndex === targetIndex) return 'current'
  if (recordIndex < targetIndex) return 'ahead'
  return 'behind'
}

// ============================================================================
// 七、周期配置（单一全局周期，存 site_config['runtime'].recruit）
// ============================================================================

/** 关闭时导出的一份存档（CSV 落在 applications/archives 下，私有，后台留下载入口） */
export interface RecruitArchive {
  name: string
  /** 相对地址，形如 /api/files/applications/archives/xxx.csv */
  url: string
  closedAt: string
  /** 本届报名人数与最终转正人数 */
  total: number
  members: number
}

export interface RecruitCycleConfig {
  /** 本届名称，如「2026 年秋季招新」 */
  name: string

  /** 报名窗口（北京时间字符串 YYYY-MM-DDTHH:mm，下同） */
  applyStart: string
  applyEnd: string
  /**
   * 确认笔试名单的时间。非空即表示**报名通道已关闭**（材料锁死，不再接受新报名与替换报名表）。
   * 这是「确认笔试名单」这个动作唯一需要落库的痕迹 —— 名单本身是挨条改 stage，不需要额外标记。
   */
  writtenConfirmedAt: string

  /**
   * 笔试的**兜底**时间与地点。真正的安排是 recruit_sessions 表里的场次列表
   * （一个阶段可以有多场，见 RecruitSession）：有场次时 writtenEnd 由最后一场自动派生、
   * {writtenAt} / {writtenPlace} 取第一场；没有场次时才用这里手填的值（兼容旧配置）。
   */
  writtenAt: string
  writtenEnd: string
  writtenPlace: string

  /** 面试的兜底时间与地点，同上（有场次时取第一场） */
  interviewAt: string
  interviewPlace: string

  /** 预备期起止（答辩期），写进面试通过通知 */
  defenseStart: string
  defenseEnd: string

  /** 转正确认截止：到期仍未确认的视为放弃，并触发自动关闭 */
  onboardDeadline: string

  /** 笔试结束后多少小时仍未签到 → 视为未参加（自动退出流程） */
  absentGraceHours: number
  /** 缺考自动标记开关（关掉后自动流程页只提醒、不自动执行） */
  autoAbsent: boolean
  /** 允许自动关闭（到转正截止或全部确认完毕） */
  autoClose: boolean

  /** 笔试晋级规则：'top' 取前 N 名 / 'score' 取分数不低于 X */
  advanceRule: 'top' | 'score'
  advanceTop: number
  advanceScore: number

  /** 手动关闭 / 重新开启的标记；手动关闭写入，重新开启清空 */
  forceClosed: boolean
  /** 关闭时间；非空即表示本届已结束（数据已归档并清空） */
  closedAt: string

  /** 往届存档列表（每次关闭追加一条） */
  archives: RecruitArchive[]
}

export const DEFAULT_RECRUIT_CYCLE: RecruitCycleConfig = {
  name: '',
  applyStart: '',
  applyEnd: '',
  writtenConfirmedAt: '',
  writtenAt: '',
  writtenEnd: '',
  writtenPlace: '',
  interviewAt: '',
  interviewPlace: '',
  defenseStart: '',
  defenseEnd: '',
  onboardDeadline: '',
  absentGraceHours: 24,
  autoAbsent: true,
  autoClose: true,
  advanceRule: 'top',
  advanceTop: 20,
  advanceScore: 60,
  forceClosed: false,
  closedAt: '',
  archives: [],
}

export type RecruitPhase = 'not_configured' | 'upcoming' | 'applying' | 'in_progress' | 'closed'

export const RECRUIT_PHASE_LABELS: Record<RecruitPhase, string> = {
  not_configured: '未配置',
  upcoming: '未开始',
  applying: '报名进行中',
  in_progress: '流程进行中',
  closed: '已结束',
}

/**
 * 当前周期处在什么状态。
 * - 已关闭（closedAt 非空）→ closed
 * - 时间窗没配齐 → not_configured
 * - 未到报名开始 → upcoming
 * - 在报名窗口内 → applying
 * - 报名已截止但流程还在走 → in_progress
 */
export function recruitPhase(config: RecruitCycleConfig, now: Date = new Date()): RecruitPhase {
  if (config.closedAt) return 'closed'
  const start = cnTimeToEpoch(config.applyStart)
  const end = cnTimeToEpoch(config.applyEnd)
  if (start === null || end === null || end <= start) return 'not_configured'

  const t = now.getTime()
  if (t < start) return 'upcoming'
  if (t <= end) return 'applying'
  return 'in_progress'
}

/** 招新模块是否对管理员开放：报名中或流程进行中 */
export function isRecruitModuleOpen(phase: RecruitPhase): boolean {
  return phase === 'applying' || phase === 'in_progress'
}

/**
 * 报名通道是否开放（学生能不能提交 / 替换报名表）。
 *
 * 两个条件都要满足：① 在报名时间窗内；② **还没确认笔试名单**。
 * 确认名单是「材料锁死」的分界点 —— 评审都开始了还让材料变来变去没有意义，
 * 所以即便时间窗还没到点，确认名单后也立刻关闭（见自动流程的 confirm_written）。
 */
export function isApplyOpen(config: RecruitCycleConfig, now: Date = new Date()): boolean {
  if (config.writtenConfirmedAt) return false
  return recruitPhase(config, now) === 'applying'
}

/** 给「加入我们」页面的一句话说明 */
export function recruitNotice(config: RecruitCycleConfig, now: Date = new Date()): string {
  switch (recruitPhase(config, now)) {
    case 'not_configured':
      return '招新时间尚未公布，请稍后再来。'
    case 'upcoming':
      return `${config.name || '本届招新'}将于 ${cnTimeToText(config.applyStart)} 开始报名。`
    case 'applying':
      return `${config.name || '本届招新'}报名截止时间：${cnTimeToText(config.applyEnd)}。`
    case 'in_progress':
      return '本届报名已截止。已报名的同学可登录查看自己的进度。'
    case 'closed':
      return '本届招新已结束，感谢关注。'
  }
}

/** 笔试是否已结束（缺考判定的起点） */
export function isWrittenFinished(config: RecruitCycleConfig, now: Date = new Date()): boolean {
  const end = cnTimeToEpoch(config.writtenEnd)
  return end !== null && now.getTime() > end
}

/** 笔试结束后允许的签到宽限期是否已过 —— 过了就可以标记「未参加」 */
export function isAbsentWindowPassed(config: RecruitCycleConfig, now: Date = new Date()): boolean {
  const end = cnTimeToEpoch(config.writtenEnd)
  if (end === null) return false
  return now.getTime() > end + Math.max(config.absentGraceHours, 0) * 3600 * 1000
}

/** 转正截止是否已过（自动关闭的判定之一） */
export function isOnboardDeadlinePassed(config: RecruitCycleConfig, now: Date = new Date()): boolean {
  const deadline = cnTimeToEpoch(config.onboardDeadline)
  return deadline !== null && now.getTime() > deadline
}

// ============================================================================
// 八、邮件模板
// ============================================================================

export type RecruitMailKind =
  /** 笔试邀请函 */
  | 'written_invite'
  /** 面试邀请函 */
  | 'interview_invite'
  /** 面试通过 · 进入预备期 */
  | 'interview_passed'
  /** 正式成员邀请函（含确认链接） */
  | 'offer'
  /** 感谢信 · 笔试未通过 */
  | 'thanks_written'
  /** 感谢信 · 面试未通过 */
  | 'thanks_interview'
  /** 感谢信 · 答辩未通过 */
  | 'thanks_defense'

export const RECRUIT_MAIL_KINDS: readonly RecruitMailKind[] = [
  'written_invite',
  'interview_invite',
  'interview_passed',
  'offer',
  'thanks_written',
  'thanks_interview',
  'thanks_defense',
]

export interface RecruitMailMeta {
  label: string
  /** 收到这封信的人处于什么状态 */
  audience: string
  /** 什么时候会发出 */
  trigger: string
}

export const RECRUIT_MAIL_META: Record<RecruitMailKind, RecruitMailMeta> = {
  written_invite: { label: '笔试邀请函', audience: '笔试名单中的同学', trigger: '确认笔试名单时发出' },
  interview_invite: { label: '面试邀请函', audience: '笔试通过的同学', trigger: '按成绩生成面试名单时发出' },
  interview_passed: { label: '面试通过通知', audience: '面试录取的同学', trigger: '确认面试录取名单时发出' },
  offer: {
    label: '正式成员邀请函',
    audience: '答辩通过的同学',
    trigger: '确认答辩名单时发出，邮件内含一次性确认链接',
  },
  thanks_written: { label: '感谢信 · 笔试', audience: '笔试未通过的同学', trigger: '按成绩生成面试名单时发出' },
  thanks_interview: { label: '感谢信 · 面试', audience: '面试未录取的同学', trigger: '确认面试录取名单时发出' },
  thanks_defense: { label: '感谢信 · 答辩', audience: '答辩未通过的同学', trigger: '确认答辩名单时发出' },
}

export interface MailTemplate {
  subject: string
  body: string
  /** 关掉后这条信不会发出（状态照常流转） */
  enabled: boolean
}

export type RecruitTemplates = Record<RecruitMailKind, MailTemplate>

/** 模板里可用的变量；后台「邮件模板」页会把这份清单显示给人看 */
export const RECRUIT_MAIL_VARIABLES: ReadonlyArray<{ token: string; desc: string }> = [
  { token: '{name}', desc: '同学姓名' },
  { token: '{studentId}', desc: '学号' },
  { token: '{cycleName}', desc: '本届招新名称' },
  { token: '{writtenSessions}', desc: '笔试全部场次（每场一行：名称 · 时间 · 地点）' },
  { token: '{writtenAt}', desc: '笔试第一场的时间' },
  { token: '{writtenPlace}', desc: '笔试第一场的地点 / 形式' },
  { token: '{interviewSessions}', desc: '面试全部场次（每场一行：名称 · 时间 · 地点）' },
  { token: '{interviewAt}', desc: '面试第一场的时间' },
  { token: '{interviewPlace}', desc: '面试第一场的地点 / 形式' },
  { token: '{defenseStart}', desc: '预备期开始时间' },
  { token: '{defenseEnd}', desc: '预备期结束时间' },
  { token: '{onboardDeadline}', desc: '转正确认截止时间' },
  { token: '{inviteLink}', desc: '邀请函确认链接（仅正式邀请函有值）' },
  { token: '{studio}', desc: '工作室名称' },
  { token: '{contactEmail}', desc: '工作室联系邮箱' },
  { token: '{contactAddress}', desc: '工作室地址' },
]

const SIGN_DEFAULT = '{studio}\n{contactEmail}'

export const DEFAULT_RECRUIT_TEMPLATES: RecruitTemplates = {
  written_invite: {
    enabled: true,
    subject: '【{studio}】笔试邀请 · {name}',
    body: [
      '{name} 同学：',
      '',
      '你好！感谢你报名 {cycleName}，你的报名表我们已经收到并通过初筛。',
      '现邀请你参加招新笔试，安排如下：',
      '',
      '笔试安排（下面几场任选一场参加即可）：',
      '{writtenSessions}',
      '',
      '请提前 10 分钟到达（线上笔试请提前登录）。如需调整时间，直接回复本邮件即可。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  interview_invite: {
    enabled: true,
    subject: '【{studio}】面试邀请 · {name}',
    body: [
      '{name} 同学：',
      '',
      '恭喜你通过了笔试！接下来是与我们面对面的环节。',
      '',
      '面试安排（下面几场任选一场参加即可）：',
      '{interviewSessions}',
      '',
      '请在约定时间前 5 分钟到达。如需调整时间，直接回复本邮件即可。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  interview_passed: {
    enabled: true,
    subject: '【{studio}】面试通过 · 欢迎进入预备期',
    body: [
      '{name} 同学：',
      '',
      '恭喜！你已通过面试，正式进入 {studio} 的预备期。',
      '',
      '预备期时间：{defenseStart} 至 {defenseEnd}',
      '预备期结束后会安排答辩考核，具体时间另行通知。',
      '',
      '预备期里你会加入一个真实项目小组，跟着学长学姐一起做东西。',
      '欢迎随时回复本邮件提问。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  offer: {
    enabled: true,
    subject: '【{studio}】正式邀请函 · 请确认加入',
    body: [
      '{name} 同学：',
      '',
      '恭喜！经过笔试、面试与答辩的考核，我们决定正式邀请你加入 {studio}。',
      '',
      '请点击下面的专属链接，填写你的成员信息并确认加入：',
      '{inviteLink}',
      '',
      '链接在 {onboardDeadline} 前有效，且仅可使用一次；',
      '确认后你会立即出现在官网「团队成员」页面。',
      '如果链接失效，或者你对加入还有疑问，直接回复本邮件即可。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  thanks_written: {
    enabled: true,
    subject: '【{studio}】感谢你参加本次笔试',
    body: [
      '{name} 同学：',
      '',
      '你好。感谢你报名 {cycleName}，并认真完成了这一轮笔试。',
      '',
      '很遗憾，本次笔试你没能进入下一轮。招新名额有限，这个结果并不代表对你的评价。',
      '我们后续的技术分享与公开活动依旧欢迎你参加，也欢迎下一轮招新再次报名。',
      '',
      '祝你学习顺利。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  thanks_interview: {
    enabled: true,
    subject: '【{studio}】感谢你参加本次面试',
    body: [
      '{name} 同学：',
      '',
      '你好。感谢你报名 {cycleName}，并抽出时间参加面试。',
      '',
      '很遗憾，本次面试你没能进入预备期。名额有限，这个结果并不代表对你的评价。',
      '欢迎关注我们后续的公开活动，也欢迎下一轮招新再次报名。',
      '',
      '祝你学习顺利。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  thanks_defense: {
    enabled: true,
    subject: '【{studio}】感谢你在预备期的付出',
    body: [
      '{name} 同学：',
      '',
      '你好。感谢你在 {studio} 预备期里的投入与付出。',
      '',
      '很遗憾，本次预备期答辩你没能通过。这个结果并不代表对你的评价，',
      '希望这段时间的项目经历对你之后的成长有所帮助。',
      '',
      '祝你学习顺利，也请继续与我们保持联系。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },
}

const VARIABLE_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
const KNOWN_VARIABLES = new Set(RECRUIT_MAIL_VARIABLES.map((item) => item.token.slice(1, -1)))

/**
 * 变量替换。已知变量即使没有值也替换成空串（避免把 `{inviteLink}` 这种原文发出去），
 * 未知变量（多半是打错字）**原样保留**，好让后台预览时一眼看出来。
 */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(VARIABLE_PATTERN, (whole, key: string) => {
    if (!KNOWN_VARIABLES.has(key)) return whole
    return vars[key] ?? ''
  })
}

/** 模板里写了但系统不认识的变量，后台用来提示 */
export function unknownTemplateVariables(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (!KNOWN_VARIABLES.has(match[1])) found.add(match[0])
  }
  return [...found]
}

// ============================================================================
// 九、自动流程
// ============================================================================

export type RecruitAutoTask =
  /** 确认笔试名单：把报名阶段的人推进到笔试并发笔试邀请函 */
  | 'confirm_written'
  /** 笔试结束仍未签到 → 标记为未参加，流程结束 */
  | 'mark_absent'
  /** 按成绩生成面试名单：通过者发面试邀请，其余发感谢信 */
  | 'advance_written'
  /** 面试录取：录取者进入预备期并发面试通过通知，其余发感谢信 */
  | 'advance_interview'
  /** 答辩通过：转正并签发邀请函，其余发感谢信 */
  | 'advance_defense'
  /** 关闭本届：导出存档 → 清空报名数据 → 周期置为已结束 */
  | 'close_cycle'

/** 顺序即招新期实际的操作顺序，后台「自动流程」页也按这个顺序排卡片 */
export const RECRUIT_AUTO_TASKS: readonly RecruitAutoTask[] = [
  'confirm_written',
  'mark_absent',
  'advance_written',
  'advance_interview',
  'advance_defense',
  'close_cycle',
]

export interface RecruitAutoMeta {
  label: string
  description: string
  /** 是否必须人工勾选名单才能执行（成绩晋级 / 录取） */
  needsSelection: boolean
}

export const RECRUIT_AUTO_META: Record<RecruitAutoTask, RecruitAutoMeta> = {
  confirm_written: {
    label: '确认笔试名单',
    description: '把已报名的同学推进到笔试环节，并发出笔试邀请函（含时间地点）。',
    needsSelection: false,
  },
  mark_absent: {
    label: '标记未参加笔试',
    description: '笔试结束并过了宽限期仍未签到的同学，标记为「未参加」，流程到此结束。',
    needsSelection: false,
  },
  advance_written: {
    label: '生成面试名单',
    description: '按分数规则算出晋级名单：通过者进入面试并收到面试邀请函，其余同学收到感谢信。',
    needsSelection: false,
  },
  advance_interview: {
    label: '确认面试录取',
    description: '在面试环节勾选录取的同学：进入预备期并收到面试通过通知，其余同学收到感谢信。',
    needsSelection: true,
  },
  advance_defense: {
    label: '确认答辩结果',
    description: '在答辩环节勾选通过的同学：转为正式成员并收到邀请函，其余同学收到感谢信。',
    needsSelection: true,
  },
  close_cycle: {
    label: '关闭本届招新',
    description: '导出本届完整名单存档，然后清空报名数据与报名表文件，招新模块收起。',
    needsSelection: false,
  },
}

/** 自动流程预览里的一行 */
export interface RecruitAutoItem {
  applicationId: string
  name: string
  studentId: string
  email: string
  /** 执行后会变成的 stage / result */
  targetStage: RecruitStage
  targetResult: RecruitResult
  /** 会发出的信；null 表示不发 */
  mail: RecruitMailKind | null
  /** 一句话说明为什么这样处理 */
  reason: string
}

export interface RecruitAutoPreview {
  task: RecruitAutoTask
  label: string
  description: string
  items: RecruitAutoItem[]
  /** 汇总，便于页面上直接显示 */
  summary: { total: number; mailed: number }
  /** 不能执行时的原因（例如还没到时间、没有可处理的人）；空串表示可执行 */
  blocked: string
}

// ============================================================================
// 十、看板与导出
// ============================================================================

export interface RecruitBoard {
  /** 各阶段的在池人数（未结束的） */
  funnel: Record<RecruitStage, number>
  /** 各派生状态的人数（含已结束的） */
  byLabel: Record<string, number>
  /** 待处理事项数量（自动流程页的角标） */
  pending: Record<RecruitAutoTask, number>
  total: number
  members: number
  cycleName: string
  phase: RecruitPhase
}

/** 导出 CSV 时的列（顺序即表头顺序） —— 后台「导出名单」与关闭归档共用 */
export const RECRUIT_EXPORT_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'name', label: '姓名' },
  { key: 'studentId', label: '学号' },
  { key: 'email', label: '邮箱' },
  { key: 'phone', label: '手机号' },
  { key: 'qq', label: 'QQ' },
  { key: 'stageLabel', label: '当前阶段' },
  { key: 'resultLabel', label: '阶段结果' },
  { key: 'statusLabel', label: '当前状态' },
  { key: 'writtenScore', label: '笔试成绩' },
  { key: 'interviewScore', label: '面试成绩' },
  { key: 'defenseScore', label: '答辩成绩' },
  { key: 'writtenCheckinAt', label: '笔试签到' },
  { key: 'interviewCheckinAt', label: '面试签到' },
  { key: 'defenseCheckinAt', label: '答辩签到' },
  { key: 'fileName', label: '报名表文件' },
  { key: 'invitedAt', label: '邀请函发出' },
  { key: 'confirmedAt', label: '确认加入' },
  { key: 'createdAt', label: '报名时间' },
  { key: 'note', label: '管理员备注' },
]

/** CSV 单元格转义：含逗号/引号/换行就包一层引号 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 生成 CSV 文本（带 BOM，Excel 打开中文不乱码） */
export function buildCsv(rows: Array<Record<string, unknown>>): string {
  const header = RECRUIT_EXPORT_COLUMNS.map((column) => csvCell(column.label)).join(',')
  const lines = rows.map((row) =>
    RECRUIT_EXPORT_COLUMNS.map((column) => csvCell(row[column.key])).join(','),
  )
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`
}
