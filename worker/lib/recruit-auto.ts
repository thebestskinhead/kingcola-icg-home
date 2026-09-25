/**
 * 招新自动流程引擎：**先算名单给人看，确认后再执行**。
 *
 * 五个任务（见 shared/recruit.ts 的 RECRUIT_AUTO_META）：
 *   mark_absent        笔试结束过了宽限期仍未签到 → 标记「未参加」，流程结束
 *   advance_written    人工勾选晋级名单（可按分数线批量预选）：晋级者进面试并发面试邀请，其余发感谢信
 *   advance_interview  人工勾选录取 → 进预备期并发面试通过通知，其余发感谢信
 *   advance_defense    人工勾选通过 → 转正签发邀请函，其余发感谢信
 *   close_cycle        导出名单存档 → 清空报名数据 → 周期置为已结束
 *
 * 为什么「预览 → 执行」两步走：邮件发出去收不回来，参数设错会整批误发。
 * 预览里每一行都会写清「会变成什么状态、会发哪封信、为什么这样处理」。
 */

import {
  applicationInviteExpiry,
  applicationLabel,
  buildCsv,
  isAbsentWindowPassed,
  isOnboardDeadlinePassed,
  isRecruitModuleOpen,
  recruitPhase,
  RECRUIT_AUTO_META,
  RECRUIT_ARCHIVE_SCOPE,
  RECRUIT_STAGE_LABELS,
  type RecruitAutoItem,
  type RecruitAutoPreview,
  type RecruitAutoTask,
  type RecruitCycleConfig,
  type RecruitMailKind,
} from '../../shared/recruit'
import { cnTimeToEpoch, cnTimeToShort, nowCnTime } from '../../shared/time'
import type { Env } from '../env'
import {
  clearRecruitData,
  listAllApplications,
  updateApplications,
  writeMailLog,
  type ApplicationPatch,
  type ApplicationRecord,
} from './applications'
import { getRecruitSettings, saveRecruitSettings } from './recruit-config'
import {
  sendApplicationNotice,
  summarizeMailResults,
  type NoticeContext,
  type SendNoticeResult,
} from './recruit-mail'
import { getSiteConfig, writeAudit } from './repo'
import { getStorage, resolveFileRef, storageReady } from './storage'
import { resolveRuntimeConfig } from '../routes/config'
import type { RequestContext } from './router'

export interface AutoRunOptions {
  /** 人工勾选的记录 id（面试录取 / 答辩通过） */
  selectedIds?: string[]
  /** 忽略截止时间立即关闭（管理员手动关闭） */
  force?: boolean
}

export interface AutoExecuteResult {
  task: RecruitAutoTask
  preview: RecruitAutoPreview
  /** 实际改动的记录数 */
  moved: number
  mail: {
    sent: number
    failed: number
    results: SendNoticeResult[]
    summary: string
  }
  /** 关闭任务特有：存档地址与导出人数 */
  archive?: { url: string; total: number }
}

/** 成绩字符串 → 数字；空字符串与「78/100」这类写法都要能吃下 */
export function parseScore(value: string): number | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  const first = /-?\d+(\.\d+)?/.exec(raw)
  if (!first) return null
  const parsed = Number(first[0])
  return Number.isFinite(parsed) ? parsed : null
}

/** 已发出邀请函但还没确认的人 */
function pendingOnboard(records: ApplicationRecord[]): ApplicationRecord[] {
  return records.filter((r) => r.stage === 'onboard' && r.result === '')
}

/** 所有发出邀请的人都已经给出结论（确认或婉拒）→ 可以自动关闭了 */
function allOnboardDecided(records: ApplicationRecord[]): boolean {
  const onboard = records.filter((r) => r.stage === 'onboard')
  if (onboard.length === 0) return false
  return onboard.every((r) => r.result === 'passed' || r.result === 'declined')
}

// ============================================================================
// 预览
// ============================================================================

interface PreviewDraft {
  items: RecruitAutoItem[]
  blocked: string
}

function makeItem(
  record: ApplicationRecord,
  targetStage: RecruitAutoItem['targetStage'],
  targetResult: RecruitAutoItem['targetResult'],
  mail: RecruitMailKind | null,
  reason: string,
): RecruitAutoItem {
  return {
    applicationId: record.id,
    name: record.name,
    studentId: record.studentId,
    email: record.email,
    // 当前环节的成绩（原始字符串，没录就是空串）—— 前台的「按分数线批量勾选」靠它
    score: scoreOf(record),
    targetStage,
    targetResult,
    mail,
    reason,
  }
}

/** 这条记录在它当前环节的成绩；apply 阶段还没有成绩，返回空串 */
function scoreOf(record: ApplicationRecord): string {
  if (record.stage === 'written') return record.writtenScore
  if (record.stage === 'interview') return record.interviewScore
  if (record.stage === 'defense') return record.defenseScore
  return ''
}

function draftPreview(task: RecruitAutoTask, draft: PreviewDraft): RecruitAutoPreview {
  const meta = RECRUIT_AUTO_META[task]
  return {
    task,
    label: meta.label,
    description: meta.description,
    items: draft.items,
    summary: {
      total: draft.items.length,
      mailed: draft.items.filter((item) => item.mail !== null).length,
    },
    blocked: draft.blocked,
  }
}

/**
 * 算出一个任务将要做什么。**不产生任何写入**，后台据此渲染「待处理清单」。
 */
export async function buildAutoPreview(
  env: Env,
  task: RecruitAutoTask,
  options: AutoRunOptions = {},
  now: Date = new Date(),
): Promise<RecruitAutoPreview> {
  const settings = await getRecruitSettings(env)
  const phase = recruitPhase(settings.cycle, now)
  const records = await listAllApplications(env)

  switch (task) {
    case 'confirm_written': {
      const targets = records.filter((r) => r.stage === 'apply' && r.result === '')
      return draftPreview(task, {
        items: targets.map((r) =>
          makeItem(r, 'written', '', 'written_invite', '进入笔试环节，发送笔试邀请函'),
        ),
        blocked: targets.length === 0 ? '报名阶段没有待确认的同学。' : '',
      })
    }

    case 'mark_absent': {
      if (!isAbsentWindowPassed(settings.cycle, now)) {
        const end = cnTimeToShort(settings.cycle.writtenEnd)
        return draftPreview(task, {
          items: [],
          blocked: end
            ? `笔试结束时间（${end}）加宽限期（${settings.cycle.absentGraceHours} 小时）还没到，暂时不用标记。`
            : '还没配置笔试结束时间，无法判断谁没来。',
        })
      }
      const targets = records.filter(
        (r) => r.stage === 'written' && r.result === '' && !r.writtenCheckinAt,
      )
      return draftPreview(task, {
        items: targets.map((r) =>
          makeItem(r, 'written', 'absent', null, '笔试未签到，标记为未参加，流程结束'),
        ),
        blocked: targets.length === 0 ? '没有需要标记的同学。' : '',
      })
    }

    case 'advance_written': {
      const candidates = records.filter(
        (r) => r.stage === 'written' && (r.result === '' || r.result === 'attended'),
      )
      if (candidates.length === 0) {
        return draftPreview(task, { items: [], blocked: '笔试环节没有待分流的同学。' })
      }
      const scored = candidates.filter((r) => parseScore(r.writtenScore) !== null)
      const missing = candidates.filter((r) => parseScore(r.writtenScore) === null)

      // 面试名单由管理员**人工确认**（支持按分数线批量预选 + 单人勾选）。
      // 与录取 / 答辩一致：没勾就执行会被拦下 —— 晋级是决定别人命运的动作，不该有默认值。
      const selected = new Set(options.selectedIds ?? [])
      const items: RecruitAutoItem[] = scored.map((r) =>
        selected.has(r.id)
          ? makeItem(r, 'interview', '', 'interview_invite', `已勾选晋级（成绩 ${r.writtenScore}），进入面试名单`)
          : makeItem(r, 'written', 'failed', 'thanks_written', `成绩 ${r.writtenScore}，未进入面试名单`),
      )
      for (const r of missing) {
        items.push(makeItem(r, r.stage, r.result, null, '尚未录入成绩，本次跳过（补齐后再执行）'))
      }
      return draftPreview(task, {
        items,
        blocked:
          scored.length === 0
            ? '还没有人录入笔试成绩，先到笔试阶段页填分。'
            : selected.size === 0
              ? '还没有勾选晋级名单：可按分数线批量勾选，或逐个勾选。未勾选的同学会被视为未通过并收到感谢信。'
              : missing.length > 0
                ? `有 ${missing.length} 位同学没录成绩，他们本次不会被处理。`
                : '',
      })
    }

    case 'advance_interview': {
      const candidates = records.filter(
        (r) => r.stage === 'interview' && (r.result === '' || r.result === 'attended'),
      )
      if (candidates.length === 0) {
        return draftPreview(task, { items: [], blocked: '面试环节没有待处理的同学。' })
      }
      const selected = new Set(options.selectedIds ?? [])
      const items = candidates.map((r) =>
        selected.has(r.id)
          ? makeItem(r, 'defense', '', 'interview_passed', '已勾选录取，进入预备期')
          : makeItem(r, 'interview', 'failed', 'thanks_interview', '未录取，发送感谢信'),
      )
      return draftPreview(task, {
        items,
        blocked:
          selected.size === 0
            ? '还没有勾选录取名单：勾选后执行，未勾选的同学会被视为未录取并收到感谢信。'
            : '',
      })
    }

    case 'advance_defense': {
      const candidates = records.filter(
        (r) => r.stage === 'defense' && (r.result === '' || r.result === 'attended'),
      )
      if (candidates.length === 0) {
        return draftPreview(task, { items: [], blocked: '答辩环节没有待处理的同学。' })
      }
      const selected = new Set(options.selectedIds ?? [])
      const items = candidates.map((r) =>
        selected.has(r.id)
          ? makeItem(r, 'onboard', '', 'offer', '已勾选通过，转正并发送正式邀请函')
          : makeItem(r, 'defense', 'failed', 'thanks_defense', '未通过，发送感谢信'),
      )
      return draftPreview(task, {
        items,
        blocked:
          selected.size === 0
            ? '还没有勾选通过名单：勾选后执行，未勾选的同学会被视为未通过并收到感谢信。'
            : '',
      })
    }

    case 'close_cycle': {
      if (phase === 'closed') {
        return draftPreview(task, { items: [], blocked: '本届已经关闭过了。' })
      }
      if (!isRecruitModuleOpen(phase)) {
        return draftPreview(task, { items: [], blocked: '本届还没开始或时间窗没配好，无需关闭。' })
      }
      const pending = pendingOnboard(records)
      const deadlinePassed = isOnboardDeadlinePassed(settings.cycle, now)
      const decided = allOnboardDecided(records)
      const canAuto = settings.cycle.autoClose && (deadlinePassed || decided)

      if (!canAuto && !options.force) {
        return draftPreview(task, {
          items: pending.map((r) =>
            makeItem(r, 'onboard', 'absent', null, '尚未确认邀请；到期后会被视为放弃'),
          ),
          blocked: `还有 ${pending.length} 位同学没确认邀请，且未到转正截止时间（${
            cnTimeToShort(settings.cycle.onboardDeadline) || '未设置'
          }）。`,
        })
      }

      return draftPreview(task, {
        items: pending.map((r) =>
          makeItem(r, 'onboard', 'absent', null, '确认期已结束仍未确认，归档时记为未确认'),
        ),
        blocked: '',
      })
    }
  }
}

// ============================================================================
// 执行
// ============================================================================

async function noticeContext(ctx: RequestContext): Promise<NoticeContext> {
  const [settings, studio] = await Promise.all([getRecruitSettings(ctx.env), getSiteConfig(ctx.env)])
  return {
    studio,
    cycle: settings.cycle,
    templates: settings.templates,
    origin: ctx.url.origin,
  }
}

/**
 * 执行一个任务。流程：算预览 → 批量改状态 → 按预览发信（含日志）→ 写审计。
 * 状态与邮件一一对应，所以先落状态再发信也不会出现「状态没改却发了信」。
 */
export async function executeAutoTask(
  ctx: RequestContext,
  task: RecruitAutoTask,
  options: AutoRunOptions = {},
): Promise<AutoExecuteResult> {
  const preview = await buildAutoPreview(ctx.env, task, options)
  if (preview.blocked && preview.items.length === 0) {
    return { task, preview, moved: 0, mail: { sent: 0, failed: 0, results: [], summary: preview.blocked } }
  }

  const actor = ctx.admin?.username ?? 'system'
  const nowIso = new Date().toISOString()
  const settings = await getRecruitSettings(ctx.env)
  const before = await listAllApplications(ctx.env)
  const byId = new Map(before.map((r) => [r.id, r]))

  // ---- 关闭本届：单独一条路径（导出 → 清空 → 记存档） ----
  if (task === 'close_cycle') {
    return closeCycle(ctx, preview, actor, nowIso, before)
  }

  // ---- 其它任务：批量改状态 ----
  const updates: Array<{ id: string } & ApplicationPatch> = []
  for (const item of preview.items) {
    const record = byId.get(item.applicationId)
    if (!record) continue
    if (record.stage === item.targetStage && record.result === item.targetResult) continue

    const patch: { id: string } & ApplicationPatch = {
      id: item.applicationId,
      stage: item.targetStage,
      result: item.targetResult,
      stageChangedAt: nowIso,
    }
    // 转正时签发邀请函凭证（有效期取「默认 14 天」与「转正截止」中较早的那个）
    if (item.targetStage === 'onboard' && item.targetResult === '') {
      patch.inviteToken = randomToken()
      patch.invitedAt = nowIso
      patch.inviteExpiresAt = inviteExpiryFor(settings.cycle, new Date(nowIso))
    }
    updates.push(patch)
  }

  const moved = await updateApplications(ctx.env, updates)

  // ---- 发信（按预览，用更新后的记录渲染变量） ----
  const mailTargets = preview.items.filter((item) => item.mail !== null)
  const context = await noticeContext(ctx)
  const runtime = await resolveRuntimeConfig(ctx)
  const results: SendNoticeResult[] = []

  if (mailTargets.length > 0) {
    const fresh = await listAllApplications(ctx.env)
    const freshById = new Map(fresh.map((r) => [r.id, r]))
    for (const item of mailTargets) {
      const record = freshById.get(item.applicationId)
      if (!record || !item.mail) continue
      results.push(
        await sendApplicationNotice(ctx.env, runtime.mail, record, item.mail, context, actor),
      )
    }
  }

  const sent = results.filter((r) => r.sent).length
  const summary = summarizeMailResults(results)

  await writeAudit(ctx.env, {
    actor,
    action: `recruit_${task}`,
    resource: 'applications',
    targetId: task,
    detail: `改动 ${moved} 条，${summary}`,
    ip: '',
    ua: '',
  })

  return {
    task,
    preview,
    moved,
    mail: { sent, failed: results.length - sent, results, summary },
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 邀请函有效期：默认 14 天，但**不能晚于转正截止** ——
 * 否则会出现「链接还能用、本届却已经关了」的尴尬。
 */
function inviteExpiryFor(cycle: RecruitCycleConfig, now: Date): string {
  const ttl = applicationInviteExpiry(now)
  const deadline = cnTimeToEpoch(cycle.onboardDeadline)
  return deadline !== null && deadline < Date.parse(ttl) ? new Date(deadline).toISOString() : ttl
}

// ============================================================================
// 定时兜底（Cron）
// ============================================================================

/**
 * 定时任务里没有 HTTP 请求，但执行链需要 RequestContext（读 env、写审计、拼链接）。
 * 这里造一个最小上下文：origin 取自 SSO 回调地址（部署时必填），拿不到就用一个占位域名 ——
 * 定时任务只跑「标记未参加」与「关闭本届」这两个不发信的动作，占位域名不会漏进邮件。
 */
function systemContext(env: Env, exec: ExecutionContext): RequestContext {
  let origin = 'https://kingcola.invalid'
  const configured = (env.SSO_REDIRECT_URI ?? '').trim()
  if (configured) {
    try {
      origin = new URL(configured).origin
    } catch {
      // 配置值不合法就退回占位域名，不要让定时任务挂掉
    }
  }
  const url = new URL(`${origin}/`)
  return { request: new Request(url), env, url, params: {}, exec }
}

export interface ScheduledSummary {
  actions: string[]
  /** 被标记未参加的人数 */
  absent: number
  /** 是否关闭了本届 */
  closed: boolean
  closeDetail: string
}

/**
 * 每天跑一次：缺考兜底标记 + 到点关闭本届。
 * 两项都可在「招新周期」里关掉；模块不在招新期时直接跳过。
 */
export async function runRecruitScheduled(env: Env, exec: ExecutionContext): Promise<ScheduledSummary> {
  const summary: ScheduledSummary = { actions: [], absent: 0, closed: false, closeDetail: '' }

  const settings = await getRecruitSettings(env)
  const phase = recruitPhase(settings.cycle)
  if (!isRecruitModuleOpen(phase)) return summary

  const ctx = systemContext(env, exec)

  if (settings.cycle.autoAbsent) {
    const preview = await buildAutoPreview(env, 'mark_absent')
    if (preview.items.length > 0 && !preview.blocked) {
      const result = await executeAutoTask(ctx, 'mark_absent')
      summary.absent = result.moved
      summary.actions.push(`标记未参加 ${result.moved} 人`)
    }
  }

  if (settings.cycle.autoClose) {
    const preview = await buildAutoPreview(env, 'close_cycle')
    if (preview.blocked) {
      summary.closeDetail = preview.blocked
    } else {
      const result = await executeAutoTask(ctx, 'close_cycle')
      summary.closed = true
      summary.closeDetail = `归档 ${result.archive?.total ?? 0} 条记录`
      summary.actions.push(summary.closeDetail)
    }
  }

  return summary
}

/** 关闭本届：把未确认的人记为未确认 → 导出 CSV 存档 → 清空报名数据 → 周期置为已结束 */
async function closeCycle(
  ctx: RequestContext,
  preview: RecruitAutoPreview,
  actor: string,
  nowIso: string,
  records: ApplicationRecord[],
): Promise<AutoExecuteResult> {
  const emptyMail = { sent: 0, failed: 0, results: [], summary: '' }

  // 1. 未确认邀请的同学记为「未参加」，让存档如实反映结局
  const pending = records.filter((r) => r.stage === 'onboard' && r.result === '')
  if (pending.length > 0) {
    await updateApplications(
      ctx.env,
      pending.map((r) => ({ id: r.id, result: 'absent' as const, stageChangedAt: nowIso })),
    )
  }

  // 2. 导出名单存档（落在 applications/archives 下，与报名表同属私有前缀）
  const all = await listAllApplications(ctx.env)
  const rows = all.map((record) => ({
    ...record,
    stageLabel: RECRUIT_STAGE_LABELS[record.stage],
    resultLabel: record.result === '' ? '待定' : record.result,
    statusLabel: applicationLabel(record.stage, record.result),
  }))
  const csv = buildCsv(rows)

  let archiveUrl = ''
  if (await storageReady(ctx.env, 'applications')) {
    const storage = await getStorage(ctx.env, 'applications')
    const key = `${RECRUIT_ARCHIVE_SCOPE}/${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}.csv`
    await storage.put(key, new Blob([csv], { type: 'text/csv;charset=utf-8' }), {
      contentType: 'text/csv;charset=utf-8',
    })
    archiveUrl = storage.objectUrl(key)
  }

  // 3. 记存档并关闭周期
  const settings = await getRecruitSettings(ctx.env)
  const members = all.filter((r) => r.stage === 'onboard' && r.result === 'passed').length
  await saveRecruitSettings(ctx.env, {
    cycle: {
      ...settings.cycle,
      closedAt: nowIso,
      forceClosed: false,
      archives: [
        ...settings.cycle.archives,
        {
          name: settings.cycle.name || '未命名招新',
          url: archiveUrl,
          closedAt: nowCnTime(),
          total: all.length,
          members,
        },
      ],
    },
  })

  // 4. 清空报名数据（含报名表文件与发信日志）
  if (archiveUrl) {
    // 先把存档之外的报名表删掉：它们在归档后已无用途，留着只会持续暴露个人信息。
    // 地址 → key 的反解交给存储门面（pathPrefix、直链形态都归它管），
    // 不要自己切 '/api/files/' 前缀 —— 那样一旦换了桶配置就会删错对象或删不掉。
    const storage = await getStorage(ctx.env, 'applications')
    for (const record of all) {
      const ref = await resolveFileRef(ctx.env, record.fileUrl)
      // 只删报名表本身；归档 CSV 同样落在 applications/ 前缀下，要留着
      if (ref?.purpose === 'applications' && !ref.key.startsWith(RECRUIT_ARCHIVE_SCOPE)) {
        await storage.delete(ref.key).catch(() => {})
      }
    }
  }
  await clearRecruitData(ctx.env)

  await writeMailLog(ctx.env, {
    applicationId: '',
    kind: 'close_cycle',
    recipient: '',
    subject: '本届招新关闭',
    ok: true,
    code: 'OK',
    message: `归档 ${all.length} 条，转正 ${members} 人，存档：${archiveUrl || '未生成（对象存储未接通）'}`,
    actor,
  })

  await writeAudit(ctx.env, {
    actor,
    action: 'recruit_close_cycle',
    resource: 'applications',
    targetId: 'close_cycle',
    detail: `本届招新关闭：共 ${all.length} 人报名、${members} 人转正；存档 ${archiveUrl || '未生成'}`,
    ip: '',
    ua: '',
  })

  return {
    task: 'close_cycle',
    preview,
    moved: all.length,
    mail: emptyMail,
    archive: { url: archiveUrl, total: all.length },
  }
}
