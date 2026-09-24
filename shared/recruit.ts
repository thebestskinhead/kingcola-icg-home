/**
 * 招新报名（`applications`）契约 —— 状态机、报名表校验、材料上传限制、邮件触发规则。
 *
 * 为什么单独一个文件而不是塞进 `resources.ts`：报名**不是**后台的普通内容类型，
 * 它是「学生匿名写、管理员读」的流水线，有自己的状态机与侧效（发邮件、写成员表）。
 * 后台的通用 CRUD（`shared/resources.ts`）不接管它，但中文名、阶段、流转规则
 * 仍在这里集中定义一份，Worker 与前端都引它，避免两端各写一套。
 *
 * 状态：14 个，覆盖「报名 → 笔试 → 面试 → 预备期 → 转正」全流程（见下表）。
 */

import { formatLimit } from './resources'
import type { ApplicationStatus } from './types'

// ===== 阶段 =====

/** 进度分成 5 段，用于前台进度条与后台分组筛选 */
export type ApplicationStage = 'apply' | 'written' | 'interview' | 'probation' | 'onboard'

export const APPLICATION_STAGES: readonly ApplicationStage[] = [
  'apply',
  'written',
  'interview',
  'probation',
  'onboard',
]

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  apply: '报名',
  written: '笔试',
  interview: '面试',
  probation: '预备期',
  onboard: '转正',
}

/** 该状态在流程中的性质：待处理 / 进行中 / 通过 / 未通过 / 已完成 */
export type ApplicationTone = 'pending' | 'active' | 'passed' | 'failed' | 'done'

export interface ApplicationStatusMeta {
  label: string
  stage: ApplicationStage
  tone: ApplicationTone
  /** 给报名同学看的一句话解释（前台进度页展示） */
  hint: string
}

export const APPLICATION_STATUS_META: Record<ApplicationStatus, ApplicationStatusMeta> = {
  submitted: { label: '已提交报名', stage: 'apply', tone: 'pending', hint: '报名表已收到，我们会尽快安排笔试' },
  rejected: { label: '未通过初筛', stage: 'apply', tone: 'failed', hint: '本次报名材料未通过初筛，感谢关注' },

  written_scheduled: { label: '已安排笔试', stage: 'written', tone: 'active', hint: '笔试安排已发出，请留意报名时填的邮箱' },
  written_passed: { label: '笔试通过', stage: 'written', tone: 'passed', hint: '笔试已通过，等待面试安排' },
  written_failed: { label: '笔试未通过', stage: 'written', tone: 'failed', hint: '本次笔试未通过，感谢参与' },

  interview_scheduled: { label: '已安排面试', stage: 'interview', tone: 'active', hint: '面试安排已发出，请按约定时间参加' },
  interview_passed: { label: '面试通过', stage: 'interview', tone: 'passed', hint: '面试已通过，即将进入预备期' },
  interview_failed: { label: '面试未通过', stage: 'interview', tone: 'failed', hint: '本次面试未通过，感谢参与' },

  probation: { label: '预备成员', stage: 'probation', tone: 'active', hint: '已进入预备期，参与真实项目并接受答辩考核' },
  probation_failed: { label: '预备期未通过', stage: 'probation', tone: 'failed', hint: '本次预备期考核未通过，感谢这段时间的付出' },

  invited: { label: '已发送邀请函', stage: 'onboard', tone: 'active', hint: '邀请函已发出，请查收邮箱并填写信息确认加入' },
  member: { label: '正式成员', stage: 'onboard', tone: 'done', hint: '欢迎加入工作室！' },
  declined: { label: '已婉拒邀请', stage: 'onboard', tone: 'failed', hint: '已收到你的回复，祝一切顺利' },

  withdrawn: { label: '已退出报名', stage: 'apply', tone: 'failed', hint: '报名已撤销' },
}

export const APPLICATION_STATUSES = Object.keys(APPLICATION_STATUS_META) as ApplicationStatus[]

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return Object.prototype.hasOwnProperty.call(APPLICATION_STATUS_META, value)
}

export function applicationStageOf(status: ApplicationStatus): ApplicationStage {
  return APPLICATION_STATUS_META[status].stage
}

export function applicationToneOf(status: ApplicationStatus): ApplicationTone {
  return APPLICATION_STATUS_META[status].tone
}

/** 阶段序号（0 起），用于进度条 */
export function applicationStageIndex(status: ApplicationStatus): number {
  return APPLICATION_STAGES.indexOf(applicationStageOf(status))
}

// ===== 状态流转 =====

/**
 * 允许的流转。**只有这张表里的边才准走**，其余一律拒绝（含「退回上一步」的改判）。
 * 设计取舍：
 * - 每一步都能 `withdrawn`（学生主动放弃 / 失联）；
 * - 未通过的状态可以改判回通过（录错成绩的补救），但**不会**因此重发邀请邮件；
 * - `member` 是终态 —— 正式成员的退出请直接在「团队成员」里处理，避免两边数据打架。
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  submitted: ['rejected', 'written_scheduled', 'withdrawn'],
  rejected: ['submitted', 'withdrawn'],

  written_scheduled: ['written_passed', 'written_failed', 'withdrawn'],
  written_passed: ['interview_scheduled', 'written_failed', 'withdrawn'],
  written_failed: ['written_passed', 'withdrawn'],

  interview_scheduled: ['interview_passed', 'interview_failed', 'withdrawn'],
  interview_passed: ['probation', 'interview_failed', 'withdrawn'],
  interview_failed: ['interview_passed', 'withdrawn'],

  probation: ['invited', 'probation_failed', 'withdrawn'],
  probation_failed: ['probation', 'withdrawn'],

  invited: ['member', 'declined', 'probation', 'withdrawn'],
  member: [],
  declined: ['invited', 'withdrawn'],

  withdrawn: ['submitted'],
}

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return false
  return APPLICATION_TRANSITIONS[from].includes(to)
}

/** 当前状态下可选的下一步（后台状态流转按钮直接用这个渲染） */
export function nextApplicationStatuses(from: ApplicationStatus): readonly ApplicationStatus[] {
  return APPLICATION_TRANSITIONS[from]
}

/** 终态：不会再自发往下走的状态 */
export function isTerminalApplicationStatus(status: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[status].length === 0
}

// ===== 邮件通知 =====

export type ApplicationNoticeKind =
  /** 笔试邀请 */
  | 'written_invite'
  /** 面试邀请 */
  | 'interview_invite'
  /** 邀请函（含一次性确认链接） */
  | 'offer'
  /** 感谢信（笔试未通过） */
  | 'thanks_written'
  /** 感谢信（面试未通过） */
  | 'thanks_interview'
  /** 感谢信（预备期未通过） */
  | 'thanks_probation'

export interface ApplicationNoticeMeta {
  label: string
  /** 后台提示用：这封信为什么发 */
  trigger: string
}

export const APPLICATION_NOTICE_META: Record<ApplicationNoticeKind, ApplicationNoticeMeta> = {
  written_invite: { label: '笔试邀请', trigger: '状态改为「已安排笔试」时发送' },
  interview_invite: { label: '面试邀请', trigger: '状态改为「已安排面试」时发送' },
  offer: { label: '邀请函', trigger: '状态改为「已发送邀请函」时发送，邮件内含一次性确认链接' },
  thanks_written: { label: '感谢信 · 笔试', trigger: '状态改为「笔试未通过」时发送' },
  thanks_interview: { label: '感谢信 · 面试', trigger: '状态改为「面试未通过」时发送' },
  thanks_probation: { label: '感谢信 · 预备期', trigger: '状态改为「预备期未通过」时发送' },
}

export const APPLICATION_NOTICE_KINDS = Object.keys(APPLICATION_NOTICE_META) as ApplicationNoticeKind[]

/**
 * 转到某个状态时该发哪封信（不改状态、或改判回通过时返回 null）。
 * 只按「目标状态」判定：`written_failed → written_passed` 这类改判不会误发邮件。
 */
export function noticeForStatus(status: ApplicationStatus): ApplicationNoticeKind | null {
  switch (status) {
    case 'written_scheduled':
      return 'written_invite'
    case 'interview_scheduled':
      return 'interview_invite'
    case 'invited':
      return 'offer'
    case 'written_failed':
      return 'thanks_written'
    case 'interview_failed':
      return 'thanks_interview'
    case 'probation_failed':
      return 'thanks_probation'
    default:
      return null
  }
}

// ===== 报名表单 =====

/** 报名表（PDF / DOCX）体积上限 —— 前端提示与 Worker 校验共用 */
export const APPLICATION_DOC_LIMIT = 20 * 1024 * 1024

/** R2 子目录；同时是「仅管理员可下载」的判定前缀 */
export const APPLICATION_DOC_SCOPE = 'applications'

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

// ===== 邀请函 =====

/** 邀请函链接有效期：14 天（覆盖出结果到开学的时间差） */
export const APPLICATION_INVITE_TTL_HOURS = 14 * 24

/** 邀请函过期时间（ISO 字符串） */
export function applicationInviteExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + APPLICATION_INVITE_TTL_HOURS * 3600 * 1000).toISOString()
}

/** 邀请函是否仍可用 */
export function isInviteUsable(expiresAt: string, status: ApplicationStatus): boolean {
  if (status === 'member') return false
  const expires = Date.parse(expiresAt)
  return Number.isFinite(expires) && expires > Date.now()
}

// ===== 统计 =====

/** 进行中的状态（未被淘汰、也还没转正）—— 后台「正在跟进」计数用 */
export function isApplicationInProgress(status: ApplicationStatus): boolean {
  const tone = applicationToneOf(status)
  return tone === 'pending' || tone === 'active' || tone === 'passed'
}
