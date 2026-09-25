/**
 * 招新模块的后台接口（全部需要管理员会话）。
 *
 *   GET  /api/admin/recruit                周期配置 + 邮件模板 + 存档 + 当前阶段
 *   PUT  /api/admin/recruit                保存周期 / 模板
 *   GET  /api/admin/recruit/board          招新看板：漏斗、待办数量
 *   GET  /api/admin/recruit/auto?task=…    自动流程预览（只算不改）
 *   POST /api/admin/recruit/auto           执行自动流程（改状态 + 发信 + 写日志）
 *   GET  /api/admin/recruit/export         导出当前名单 CSV
 *   GET  /api/admin/recruit/mails          发信日志
 *
 * 周期与模板存 D1 `site_config['recruit']`（JSON 合并默认值，新增配置项不需要迁移）。
 */

import {
  applicationLabel,
  buildCsv,
  isApplicationFinished,
  isRecruitModuleOpen,
  isRecruitResult,
  recruitNotice,
  recruitPhase,
  RECRUIT_AUTO_META,
  RECRUIT_AUTO_TASKS,
  RECRUIT_STAGE_LABELS,
  RECRUIT_STAGES,
  unknownTemplateVariables,
  type RecruitAutoTask,
  type RecruitBoard,
  type RecruitCycleConfig,
  type RecruitMailKind,
  type RecruitResult,
  type RecruitStage,
  type RecruitTemplates,
} from '../../shared/recruit'
import {
  listAllApplications,
  listApplications,
  listMailLogs,
  type ApplicationRecord,
} from '../lib/applications'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { buildAutoPreview, executeAutoTask } from '../lib/recruit-auto'
import { getRecruitSettings, saveRecruitSettings } from '../lib/recruit-config'
import { writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

// ===== 周期与模板 =====

export async function getRecruitSettingsRoute(ctx: RequestContext): Promise<Response> {
  const settings = await getRecruitSettings(ctx.env)
  const phase = recruitPhase(settings.cycle)

  // 模板里写错的变量要在后台直接提示出来，避免发出去才发现少了内容
  const unknownVariables = Object.fromEntries(
    Object.entries(settings.templates).map(([kind, template]) => [
      kind,
      [...new Set([...unknownTemplateVariables(template.subject), ...unknownTemplateVariables(template.body)])],
    ]),
  )

  return ok({
    cycle: settings.cycle,
    templates: settings.templates,
    phase,
    /** 招新模块现在对管理员是否开放（非招新期收起） */
    moduleOpen: isRecruitModuleOpen(phase),
    notice: recruitNotice(settings.cycle),
    unknownVariables,
  })
}

interface SaveRecruitBody {
  cycle?: Partial<RecruitCycleConfig>
  templates?: Partial<Record<RecruitMailKind, { subject?: string; body?: string; enabled?: boolean }>>
}

export async function updateRecruitSettings(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<SaveRecruitBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  if (body.cycle) {
    const cycle = body.cycle
    const start = (cycle.applyStart ?? '').trim()
    const end = (cycle.applyEnd ?? '').trim()
    if (start && end && end <= start) {
      return fail(400, 'VALIDATION_FAILED', '报名截止时间必须晚于开始时间')
    }
    if (cycle.absentGraceHours !== undefined && Number(cycle.absentGraceHours) < 0) {
      return fail(400, 'VALIDATION_FAILED', '缺考宽限期不能是负数')
    }
  }

  const saved = await saveRecruitSettings(ctx.env, {
    cycle: body.cycle,
    templates: body.templates as Partial<RecruitTemplates> | undefined,
  })
  const phase = recruitPhase(saved.cycle)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'save_recruit_config',
    resource: 'recruit',
    detail: [
      body.cycle ? `cycle=${saved.cycle.name || '(未命名)'} phase=${phase}` : '',
      body.templates ? 'templates' : '',
    ]
      .filter(Boolean)
      .join(' '),
    ...requestMeta(ctx),
  })

  return ok({ cycle: saved.cycle, templates: saved.templates, phase })
}

// ===== 看板 =====

export async function getRecruitBoard(ctx: RequestContext): Promise<Response> {
  const [settings, records, previews] = await Promise.all([
    getRecruitSettings(ctx.env),
    listAllApplications(ctx.env),
    Promise.all(RECRUIT_AUTO_TASKS.map((task) => buildAutoPreview(ctx.env, task))),
  ])

  const funnel = Object.fromEntries(RECRUIT_STAGES.map((stage) => [stage, 0])) as Record<
    RecruitStage,
    number
  >
  const byLabel: Record<string, number> = {}
  let members = 0

  for (const record of records) {
    const label = applicationLabel(record.stage, record.result)
    byLabel[label] = (byLabel[label] ?? 0) + 1
    if (!isApplicationFinished(record.stage, record.result)) funnel[record.stage] += 1
    if (record.stage === 'onboard' && record.result === 'passed') members += 1
  }

  const pending = Object.fromEntries(
    RECRUIT_AUTO_TASKS.map((task, index) => [task, previews[index]?.items.length ?? 0]),
  ) as Record<RecruitAutoTask, number>

  const board: RecruitBoard = {
    funnel,
    byLabel,
    pending,
    total: records.length,
    members,
    cycleName: settings.cycle.name,
    phase: recruitPhase(settings.cycle),
  }

  return ok(board)
}

// ===== 自动流程 =====

const AUTO_TASKS = new Set<string>(RECRUIT_AUTO_TASKS)

function parseSelected(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export async function previewRecruitAuto(ctx: RequestContext): Promise<Response> {
  const task = (ctx.url.searchParams.get('task') ?? '').trim()
  if (!AUTO_TASKS.has(task)) return fail(400, 'INVALID_TASK', `未知的自动任务：${task}`)

  const preview = await buildAutoPreview(ctx.env, task as RecruitAutoTask, {
    selectedIds: parseSelected(ctx.url.searchParams.get('selected')),
  })
  return ok(preview)
}

interface RunAutoBody {
  task?: string
  selectedIds?: string[]
  /** 忽略截止时间立即关闭（管理员手动关闭本届） */
  force?: boolean
}

export async function runRecruitAuto(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<RunAutoBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const task = (body.task ?? '').trim()
  if (!AUTO_TASKS.has(task)) return fail(400, 'INVALID_TASK', `未知的自动任务：${task}`)
  const typed = task as RecruitAutoTask

  // 预览为空且被 block 时直接回错误，避免「点了执行但什么都没发生」
  const preview = await buildAutoPreview(ctx.env, typed, {
    selectedIds: body.selectedIds,
    force: body.force,
  })
  if (preview.blocked && preview.items.length === 0) {
    return fail(409, 'BLOCKED', preview.blocked)
  }

  const result = await executeAutoTask(ctx, typed, {
    selectedIds: body.selectedIds,
    force: body.force,
  })

  return ok({
    task: result.task,
    moved: result.moved,
    mail: {
      sent: result.mail.sent,
      failed: result.mail.failed,
      summary: result.mail.summary,
      /** 只回前 50 条明细，够后台列出来看，也不至于把响应撑爆 */
      results: result.mail.results.slice(0, 50),
    },
    archive: result.archive ?? null,
    preview: result.preview,
  })
}

// ===== 导出与日志 =====

/** 当前名单导出（按后台的筛选条件走），直接返回 CSV 文件供浏览器下载 */
export async function exportRecruitCsv(ctx: RequestContext): Promise<Response> {
  const stageParam = (ctx.url.searchParams.get('stage') ?? '').trim()
  const stages = stageParam
    ? (stageParam.split(',').filter((s) => RECRUIT_STAGES.includes(s as RecruitStage)) as RecruitStage[])
    : undefined
  const resultParam = ctx.url.searchParams.get('result')
  // 结果筛选里允许显式写空串（表示「尚无结论」），所以用 null 与 '' 区分「没传」和「传了空」
  const results =
    resultParam === null
      ? undefined
      : (resultParam.split(',').filter((value) => isRecruitResult(value)) as RecruitResult[])

  const [settings, rows] = await Promise.all([
    getRecruitSettings(ctx.env),
    listApplications(ctx.env, {
      stages,
      results,
      search: ctx.url.searchParams.get('q') ?? undefined,
      limit: 2000,
    }),
  ])

  const csv = buildCsv(
    rows.items.map((record: ApplicationRecord) => ({
      ...record,
      stageLabel: RECRUIT_STAGE_LABELS[record.stage],
      resultLabel: record.result === '' ? '待定' : record.result,
      statusLabel: applicationLabel(record.stage, record.result),
    })),
  )

  const name = `${settings.cycle.name || '招新'}-名单-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="recruit.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    },
  })
}

export async function getRecruitMails(ctx: RequestContext): Promise<Response> {
  const limit = Number(ctx.url.searchParams.get('limit') ?? 200)
  const logs = await listMailLogs(ctx.env, { limit })
  return ok({ logs })
}

/** 自动流程任务清单（前端渲染卡片用，避免前端硬编码） */
export async function getRecruitAutoTasks(ctx: RequestContext): Promise<Response> {
  void ctx
  return ok({
    tasks: RECRUIT_AUTO_TASKS.map((task) => ({ id: task, ...RECRUIT_AUTO_META[task] })),
  })
}
