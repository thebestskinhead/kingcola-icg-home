/**
 * 招新后台演示页的假数据、常量与纯函数。
 *
 * 单独成文件的原因：状态容器（`useDemoRecruit`）与四个视图（流程 / 名单 / 邮件日志 / 设置）
 * 都要用这些类型和常量，挂在组件文件里会互相 import 成环。
 *
 * 这里的文案与规则**就是接真数据时要落地的目标形态**：
 * 整届没有任何时间字段，时间与地点一律通过对应的 QQ 群通知，邮件里不出现。
 */

import {
  applicationLabel,
  buildCsv,
  RECRUIT_EXPORT_COLUMNS,
  RECRUIT_MAIL_KINDS,
  RECRUIT_RESULT_LABELS,
  RECRUIT_STAGE_LABELS,
  type RecruitMailKind,
  type RecruitResult,
  type RecruitStage,
  type RecruitTemplates,
} from '@shared/recruit'

// ---------------------------------------------------------------------------
// 阶段与步进
// ---------------------------------------------------------------------------

export type StageKey = RecruitStage
export type StageKeyOrArchive = StageKey | 'archive' | 'prepare'
/** 签到二维码只绑阶段 —— 没有场次概念 */
export type QrStage = 'written' | 'interview' | 'defense'
export type TopView = 'flow' | 'roster' | 'mails' | 'settings'

export const CHECKIN_STAGE_LABELS: Record<QrStage, string> = {
  written: '笔试',
  interview: '面试',
  defense: '答辩',
}

export const STAGE_LABEL: Record<StageKeyOrArchive, string> = {
  prepare: '备招',
  apply: '报名',
  written: '笔试',
  interview: '面试',
  defense: '答辩',
  onboard: '转正',
  archive: '归档',
}

/** 时间线节点（顺序即流程） */
export const TIMELINE: ReadonlyArray<{ key: StageKeyOrArchive; label: string; hint: string }> = [
  { key: 'prepare', label: '备招', hint: '填名称与 QQ 群号 · 手动开启报名' },
  { key: 'apply', label: '报名', hint: '收表 · 替换 · 补录 · 剔除' },
  { key: 'written', label: '笔试', hint: '二维码/补签/补录 → 结束后录成绩、定面试名单' },
  { key: 'interview', label: '面试', hint: '二维码/补签 → 结束后录评语、确认录取' },
  { key: 'defense', label: '答辩', hint: '二维码/补签 → 结束后定最终名单' },
  { key: 'onboard', label: '转正', hint: '等本人确认加入' },
  { key: 'archive', label: '归档', hint: '导出存档 · 清空' },
]

/**
 * 流程步进：奇数 = 该阶段进行中，偶数 = 该阶段已结束（待收尾）。
 * 这一个数字就是「事件驱动」的全部门禁 —— 没有任何时间参与判断。
 */
export const STEP = {
  prepare: 0,
  applyOngoing: 1,
  applyEnded: 2,
  writtenOngoing: 3,
  writtenEnded: 4,
  interviewOngoing: 5,
  interviewEnded: 6,
  defenseOngoing: 7,
  defenseEnded: 8,
  onboard: 9,
  archive: 10,
} as const

/** 步数 → 时间线上的当前节点 */
export function stepToStage(step: number): StageKeyOrArchive {
  if (step === 0) return 'prepare'
  if (step <= 2) return 'apply'
  if (step <= 4) return 'written'
  if (step <= 6) return 'interview'
  if (step <= 8) return 'defense'
  if (step === 9) return 'onboard'
  return 'archive'
}

/** 当前正在处理的阶段（备招与归档都算「转正」之后收尾，给成绩字段兜底用） */
export function stageOfStep(step: number): StageKey {
  const stage = stepToStage(step)
  return stage === 'archive' || stage === 'prepare' ? 'onboard' : stage
}

/** 该阶段的成绩字段（报名与转正没有成绩） */
export function scoreFieldOf(stage: StageKey): QrStage | null {
  return stage === 'written' || stage === 'interview' || stage === 'defense' ? stage : null
}

/** 该阶段的签到字段（同上） */
export function checkinFieldOf(stage: StageKey): QrStage | null {
  return scoreFieldOf(stage)
}

export function parseScore(value: string): number {
  return Number(value.match(/-?\d+(\.\d+)?/)?.[0] ?? NaN)
}

// ---------------------------------------------------------------------------
// 四个 QQ 群号（每封邀请函只引导进自己对应的那一个）
// ---------------------------------------------------------------------------

export type GroupKey = 'writtenGroup' | 'interviewGroup' | 'probationGroup' | 'formalGroup'

export const QQ_GROUPS: ReadonlyArray<{ key: GroupKey; label: string; hint: string }> = [
  { key: 'writtenGroup', label: '笔试通知群', hint: '笔试邀请函里给的就是它' },
  { key: 'interviewGroup', label: '面试通知群', hint: '面试邀请函里给的就是它' },
  { key: 'probationGroup', label: '预备成员群', hint: '面试通过通知里给的就是它' },
  { key: 'formalGroup', label: '正式成员群', hint: '正式邀请函里给的就是它' },
]

export type GroupNumbers = Record<GroupKey, string>

export const DEFAULT_GROUPS: GroupNumbers = {
  writtenGroup: '710000001',
  interviewGroup: '710000002',
  probationGroup: '710000003',
  formalGroup: '710000004',
}

/** 群号是 5–12 位数字；空着也允许（先建群后补） */
export function validateGroupNumbers(groups: GroupNumbers): string | null {
  for (const group of QQ_GROUPS) {
    const value = (groups[group.key] ?? '').trim()
    if (!value) continue
    if (!/^\d{5,12}$/.test(value)) return `${group.label}应是 5–12 位数字`
  }
  return null
}

// ---------------------------------------------------------------------------
// 假数据
// ---------------------------------------------------------------------------

export interface MockApp {
  id: string
  name: string
  studentId: string
  email: string
  phone: string
  qq: string
  source: 'web' | 'manual'
  stage: StageKey
  result: RecruitResult
  scores: Record<QrStage, string>
  notes: Record<QrStage, string>
  remark: string
  checkins: Record<QrStage, boolean>
  /** 只有答辩通过、邀请函已发出的人才有 */
  inviteUrl: string
  invitedAt: string
  confirmedAt: string
  fileName: string
  fileSize: number
  createdAt: string
}

export interface MockMail {
  id: string
  /** 收到这封信的那条报名记录（单人详情里按它筛） */
  appId: string
  at: string
  /** 空串 = 管理员自定义的群发通知 */
  kind: RecruitMailKind | ''
  label: string
  to: string
  ok: boolean
  error: string
  subject: string
}

/** 每阶段同时至多一张有效码；生成新码会自动作废旧码 */
export interface ActiveCode {
  token: string
  expiresAt: string
}

export const INITIAL_CODES: Record<QrStage, ActiveCode | null> = {
  written: null,
  interview: null,
  defense: null,
}

function mockApp(input: Partial<MockApp> & Pick<MockApp, 'id' | 'name' | 'studentId'>): MockApp {
  return {
    email: `${input.studentId.toLowerCase()}@example.edu.cn`,
    phone: '13800000001',
    qq: '100000001',
    source: 'web',
    stage: 'apply',
    result: '',
    scores: { written: '', interview: '', defense: '' },
    notes: { written: '', interview: '', defense: '' },
    remark: '',
    checkins: { written: false, interview: false, defense: false },
    inviteUrl: '',
    invitedAt: '',
    confirmedAt: '',
    fileName: `${input.name}+${input.studentId}+报名表.pdf`,
    fileSize: 524288,
    createdAt: '2026-09-20T10:12:00.000Z',
    ...input,
  }
}

export const INITIAL_APPS: MockApp[] = [
  mockApp({ id: 'a', name: '冒烟甲', studentId: 'SMA2026001' }),
  mockApp({ id: 'b', name: '冒烟乙', studentId: 'SMB2026002', phone: '13800000002', qq: '100000002' }),
  mockApp({
    id: 'c',
    name: '冒烟丙',
    studentId: 'SMC2026003',
    phone: '13800000003',
    qq: '100000003',
    fileName: '个人简历(1).docx',
    fileSize: 348160,
  }),
  mockApp({
    id: 'd',
    name: '现场补录丁',
    studentId: 'SMD2026004',
    source: 'manual',
    email: '',
    phone: '13800000004',
    qq: '100000004',
    fileName: '',
    fileSize: 0,
    createdAt: '2026-09-22T07:30:00.000Z',
  }),
]

// ---------------------------------------------------------------------------
// 派生文本与导出
// ---------------------------------------------------------------------------

export const appStatusLabel = (app: MockApp): string => applicationLabel(app.stage, app.result)
export const appStageLabel = (app: MockApp): string => RECRUIT_STAGE_LABELS[app.stage]
export const appResultLabel = (app: MockApp): string =>
  app.result ? (RECRUIT_RESULT_LABELS[app.result] ?? '—') : '待定'

/** 该阶段的合法结果（结果下拉用） */
export const RESULT_OPTIONS: Record<StageKey, RecruitResult[]> = {
  apply: ['', 'failed', 'withdrawn'],
  written: ['', 'attended', 'passed', 'failed', 'absent', 'withdrawn'],
  interview: ['', 'attended', 'passed', 'failed', 'absent', 'withdrawn'],
  defense: ['', 'passed', 'failed', 'withdrawn'],
  onboard: ['', 'passed', 'declined', 'withdrawn'],
}

export const RESULT_OPTION_LABELS: Record<string, string> = {
  '': '待定',
  ...RECRUIT_RESULT_LABELS,
}

/** 假的时间显示（北京时间，秒级） */
export function formatTime(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

/** 演示用的自增 id（真实现里由后端生成） */
export function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatSize(bytes: number): string {
  if (!bytes) return '—'
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/** 拼成 CSV 导出的那一行（列与真实导出完全一致，便于日后直接换接口） */
export function toExportRow(app: MockApp): Record<string, string> {
  return {
    name: app.name,
    studentId: app.studentId,
    email: app.email,
    phone: app.phone,
    qq: app.qq,
    stageLabel: appStageLabel(app),
    resultLabel: appResultLabel(app),
    statusLabel: appStatusLabel(app),
    writtenScore: app.scores.written,
    interviewScore: app.scores.interview,
    defenseScore: app.scores.defense,
    writtenCheckinAt: app.checkins.written ? '已签到' : '未签到',
    interviewCheckinAt: app.checkins.interview ? '已签到' : '未签到',
    defenseCheckinAt: app.checkins.defense ? '已签到' : '未签到',
    fileName: app.fileName,
    invitedAt: app.invitedAt ? formatTime(app.invitedAt) : '',
    confirmedAt: app.confirmedAt ? formatTime(app.confirmedAt) : '',
    createdAt: formatTime(app.createdAt),
    note: app.remark,
  }
}

/** 导出一份 CSV（带 BOM，Excel 打开中文不乱码） */
export function downloadCsv(rows: Array<Record<string, string>>, filename: string): void {
  const csv = buildCsv(rows)
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// 邮件模板（新模型：没有时间地点，只有对应的 QQ 群号）
// ---------------------------------------------------------------------------

const SIGN = '{studio}\n{contactEmail}'

export const DEMO_TEMPLATES: RecruitTemplates = {
  written_invite: {
    enabled: true,
    subject: '【{studio}】笔试邀请 · {name}',
    body: [
      '{name} 同学：',
      '',
      '你好！感谢你报名 {cycleName}，你的报名表我们已经收到并通过初筛。',
      '现邀请你参加招新笔试。',
      '',
      '笔试的确切时间与地点会通过「笔试通知群」公布，请务必加群并留意群公告：',
      '{writtenGroup}',
      '',
      '加群请备注「姓名 + 学号」。如时间有冲突，直接在群里说一声即可。',
      '',
      SIGN,
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
      '面试的确切时间与地点会通过「面试通知群」公布，请加群并留意群公告：',
      '{interviewGroup}',
      '',
      SIGN,
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
      '后续安排（包括答辩时间）都会在「预备成员群」里通知，请加群：',
      '{probationGroup}',
      '',
      '预备期里你会加入一个真实项目小组，跟着学长学姐一起做东西。',
      '欢迎随时回复本邮件提问。',
      '',
      SIGN,
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
      '链接仅可使用一次；确认后你会立即出现在官网「团队成员」页面。',
      '正式成员的通知都在「正式成员群」，也请一并加入：',
      '{formalGroup}',
      '',
      '如果链接失效，或者你对加入还有疑问，直接回复本邮件即可。',
      '',
      SIGN,
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
      SIGN,
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
      SIGN,
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
      SIGN,
    ].join('\n'),
  },
}

/** 模板里可用的变量（原系统里的时间 / 地点变量已全部去掉，换成对应 QQ 群号） */
export const DEMO_VARIABLES: ReadonlyArray<{ token: string; desc: string }> = [
  { token: '{name}', desc: '同学姓名' },
  { token: '{studentId}', desc: '学号' },
  { token: '{cycleName}', desc: '本届招新名称' },
  { token: '{writtenGroup}', desc: '笔试通知 QQ 群号' },
  { token: '{interviewGroup}', desc: '面试通知 QQ 群号' },
  { token: '{probationGroup}', desc: '预备成员 QQ 群号' },
  { token: '{formalGroup}', desc: '正式成员 QQ 群号' },
  { token: '{inviteLink}', desc: '邀请函确认链接（仅正式邀请函有值）' },
  { token: '{studio}', desc: '工作室名称' },
  { token: '{contactEmail}', desc: '工作室联系邮箱' },
  { token: '{contactAddress}', desc: '工作室地址' },
]

const VARIABLE_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
const KNOWN_VARIABLES = new Set(DEMO_VARIABLES.map((item) => item.token.slice(1, -1)))

/** 预览用的示例数据 */
export function sampleVars(cycleName: string, groups: GroupNumbers): Record<string, string> {
  return {
    name: '张同学',
    studentId: '2026001',
    cycleName,
    ...groups,
    inviteLink: 'https://studio.example.com/invite/abc123',
    studio: '拾光工作室',
    contactEmail: 'hr@example.edu.cn',
    contactAddress: '一教 305',
  }
}

/** 变量替换（与 shared/recruit 里的实现同规则：未知变量原样保留，好让人一眼看出拼错） */
export function renderDemo(text: string, vars: Record<string, string>): string {
  return text.replace(VARIABLE_PATTERN, (whole, key: string) =>
    KNOWN_VARIABLES.has(key) ? (vars[key] ?? '') : whole,
  )
}

/** 模板里写了但系统不认识的变量 */
export function unknownDemoVars(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (!KNOWN_VARIABLES.has(match[1])) found.add(match[0])
  }
  return [...found]
}

/** 信件名（邮件日志与详情页共用） */
export function mailLabel(kind: RecruitMailKind | ''): string {
  if (!kind) return '自定义通知'
  return DEMO_MAIL_LABELS[kind]
}

const DEMO_MAIL_LABELS: Record<RecruitMailKind, string> = {
  written_invite: '笔试邀请函',
  interview_invite: '面试邀请函',
  interview_passed: '面试通过通知',
  offer: '正式成员邀请函',
  thanks_written: '感谢信 · 笔试',
  thanks_interview: '感谢信 · 面试',
  thanks_defense: '感谢信 · 答辩',
}

/** 每条模板发给谁、什么时候发（设置页左侧列表与详情页下拉都用） */
export const DEMO_MAIL_META: Record<RecruitMailKind, { audience: string; trigger: string }> = {
  written_invite: { audience: '笔试名单中的同学', trigger: '确认笔试名单时发出' },
  interview_invite: { audience: '笔试通过的同学', trigger: '确认面试名单时发出' },
  interview_passed: { audience: '面试录取的同学', trigger: '确认录取名单时发出' },
  offer: { audience: '答辩通过的同学', trigger: '确认最终名单时发出，含一次性确认链接' },
  thanks_written: { audience: '笔试未通过的同学', trigger: '确认面试名单时发出' },
  thanks_interview: { audience: '面试未录取的同学', trigger: '确认录取名单时发出' },
  thanks_defense: { audience: '答辩未通过的同学', trigger: '确认最终名单时发出' },
}

export const MAIL_KINDS = RECRUIT_MAIL_KINDS
export const EXPORT_COLUMNS = RECRUIT_EXPORT_COLUMNS
