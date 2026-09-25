/**
 * 招新报名的**后台明细接口**（全部需要管理员会话）。
 *
 *   GET    /api/admin/applications              列表（阶段 / 结果 / 关键词筛选 + 分页）
 *   GET    /api/admin/applications/:id          单条详情（含该同学的发信记录）
 *   PUT    /api/admin/applications/:id          改状态 / 记成绩 / 勾签到 / 补发某封信
 *   POST   /api/admin/applications/bulk         批量：签到、标记未参加、退出报名
 *   POST   /api/admin/applications/notify       批量通知信（自定义主题与正文）
 *   GET    /api/admin/applications/:id/file     下载报名表（唯一能拿到该文件的入口）
 *   DELETE /api/admin/applications/:id          删除记录（连带清理报名表与发信日志）
 *
 * 状态只有两列（stage + result），所以校验也很直接：
 *   1. result 必须是该 stage 允许的取值（STAGE_RESULTS）；
 *   2. 跨阶段只能相邻一步（canMoveStage），允许退回一步改判。
 * 成绩晋级、录取、答辩结果等批量推进走 `/api/admin/recruit/auto`（预览后执行），
 * 那里会把名单、邮件与状态一次性处理完。
 */

import {
  applicationLabel,
  APPLICATION_EMAIL_PATTERN,
  APPLICATION_PHONE_PATTERN,
  APPLICATION_QQ_PATTERN,
  canMoveStage,
  isRecruitResult,
  isRecruitStage,
  isValidStageResult,
  renderTemplate,
  RECRUIT_STAGE_LABELS,
  type CheckinStage,
  type RecruitMailKind,
  type RecruitResult,
  type RecruitStage,
} from '../../shared/recruit'
import {
  createApplication,
  deleteApplication,
  getApplication,
  getApplicationByStudentId,
  listApplications,
  listMailLogs,
  updateApplication,
  updateApplications,
  writeMailLog,
  type ApplicationPatch,
  type ApplicationRecord,
} from '../lib/applications'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { isMailConfigured, sendMail } from '../lib/mailer'
import { getRecruitSettings } from '../lib/recruit-config'
import {
  buildNoticeVars,
  isNoticeKind,
  sendApplicationNotice,
  summarizeMailResults,
  type NoticeContext,
  type SendNoticeResult,
} from '../lib/recruit-mail'
import { getSiteConfig, writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { deleteStoredFile, getStorage, resolveFileRef } from '../lib/storage'
import { resolveRuntimeConfig } from './config'

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

/** 签到时间写入哪一列 */
const CHECKIN_COLUMN: Record<CheckinStage, 'writtenCheckinAt' | 'interviewCheckinAt' | 'defenseCheckinAt'> = {
  written: 'writtenCheckinAt',
  interview: 'interviewCheckinAt',
  defense: 'defenseCheckinAt',
}

async function noticeContext(ctx: RequestContext): Promise<NoticeContext> {
  const [settings, studio] = await Promise.all([getRecruitSettings(ctx.env), getSiteConfig(ctx.env)])
  return {
    studio,
    cycle: settings.cycle,
    templates: settings.templates,
    origin: ctx.url.origin,
  }
}

/** 后台视图：补上派生标签，省得前端再算一遍 */
export interface AdminApplicationView extends ApplicationRecord {
  inviteUrl: string
  stageLabel: string
  resultLabel: string
  statusLabel: string
}

function toAdminView(record: ApplicationRecord, origin: string): AdminApplicationView {
  return {
    ...record,
    inviteUrl: record.inviteToken ? `${origin.replace(/\/+$/, '')}/invite/${record.inviteToken}` : '',
    stageLabel: RECRUIT_STAGE_LABELS[record.stage],
    resultLabel: record.result === '' ? '待定' : record.result,
    statusLabel: applicationLabel(record.stage, record.result),
  }
}

// ===== 列表 / 详情 =====

export async function listApplicationsAdmin(ctx: RequestContext): Promise<Response> {
  const stageParam = (ctx.url.searchParams.get('stage') ?? '').trim()
  const stages = stageParam
    ? (stageParam.split(',').filter((value) => isRecruitStage(value)) as RecruitStage[])
    : undefined

  const resultParam = ctx.url.searchParams.get('result')
  const results =
    resultParam === null
      ? undefined
      : (resultParam.split(',').filter((value) => isRecruitResult(value)) as RecruitResult[])

  const result = await listApplications(ctx.env, {
    stages,
    results,
    search: ctx.url.searchParams.get('q') ?? undefined,
    limit: Number(ctx.url.searchParams.get('limit') ?? 500),
    offset: Number(ctx.url.searchParams.get('offset') ?? 0),
  })

  return ok({
    items: result.items.map((item) => toAdminView(item, ctx.url.origin)),
    total: result.total,
  })
}

export async function getApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const logs = await listMailLogs(ctx.env, { applicationId: record.id, limit: 50 })
  return ok({ application: toAdminView(record, ctx.url.origin), mails: logs })
}

// ===== 单条更新 =====

interface UpdateApplicationBody {
  stage?: string
  result?: string
  /** 勾选 / 取消签到；取消时传 value: false */
  checkin?: { stage?: string; value?: boolean }
  writtenScore?: string
  interviewScore?: string
  defenseScore?: string
  writtenNote?: string
  interviewNote?: string
  defenseNote?: string
  note?: string
  /** 补发某封信（状态不变也能发） */
  notice?: string
  /** 编辑时是否顺手改联系方式 */
  email?: string
  phone?: string
  qq?: string
}

export async function updateApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const body = await readJsonBody<UpdateApplicationBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const nowIso = new Date().toISOString()
  const patch: ApplicationPatch = {}

  // ---- 文字字段 ----
  for (const key of [
    'writtenScore',
    'interviewScore',
    'defenseScore',
    'writtenNote',
    'interviewNote',
    'defenseNote',
    'note',
    'email',
    'phone',
    'qq',
  ] as const) {
    if (body[key] !== undefined) patch[key] = String(body[key] ?? '').trim()
  }

  // ---- 状态：stage + result ----
  const nextStageRaw = (body.stage ?? '').trim()
  const nextResultRaw = body.result
  let nextStage: RecruitStage = record.stage
  let nextResult: RecruitResult = record.result

  if (nextStageRaw && nextStageRaw !== record.stage) {
    if (!isRecruitStage(nextStageRaw)) return fail(400, 'INVALID_STAGE', `未知的阶段：${nextStageRaw}`)
    if (!canMoveStage(record.stage, nextStageRaw)) {
      return fail(
        409,
        'INVALID_TRANSITION',
        `只能推进到相邻阶段：当前「${RECRUIT_STAGE_LABELS[record.stage]}」。如需跳阶段，请逐步操作。`,
      )
    }
    nextStage = nextStageRaw
  }

  if (nextResultRaw !== undefined && nextResultRaw !== record.result) {
    if (!isRecruitResult(nextResultRaw)) {
      return fail(400, 'INVALID_RESULT', `未知的结果：${nextResultRaw}`)
    }
    nextResult = nextResultRaw
  }

  const statusChanged = nextStage !== record.stage || nextResult !== record.result
  if (statusChanged) {
    // 跨阶段迁移时，结果回到「尚无结论」是默认行为；显式传了就按传的来
    if (nextStage !== record.stage && nextResultRaw === undefined) nextResult = ''
    if (!isValidStageResult(nextStage, nextResult)) {
      return fail(
        400,
        'INVALID_STAGE_RESULT',
        `「${RECRUIT_STAGE_LABELS[nextStage]}」阶段不支持「${nextResult === '' ? '待定' : nextResult}」这个结果`,
      )
    }
    patch.stage = nextStage
    patch.result = nextResult
    patch.stageChangedAt = nowIso
  }

  // ---- 签到 ----
  const checkinStage = (body.checkin?.stage ?? '').trim()
  if (checkinStage) {
    const column = CHECKIN_COLUMN[checkinStage as CheckinStage]
    if (!column) return fail(400, 'INVALID_STAGE', `未知的签到阶段：${checkinStage}`)
    const on = body.checkin?.value !== false
    patch[column] = on ? nowIso : ''
    // 补勾签到：结果推进到「已参加」（已有结论的不覆盖）
    if (on && patch.result === undefined && record.result === '') {
      patch.result = 'attended'
      patch.stageChangedAt = nowIso
    }
  }

  const updated = await updateApplication(ctx.env, record.id, patch)
  if (!updated) return fail(404, 'NOT_FOUND', '报名记录不存在')

  // ---- 邮件 ----
  let mail = null as Awaited<ReturnType<typeof sendApplicationNotice>> | null
  const noticeRaw = (body.notice ?? '').trim()
  if (noticeRaw && isNoticeKind(noticeRaw)) {
    const runtime = await resolveRuntimeConfig(ctx)
    mail = await sendApplicationNotice(
      ctx.env,
      runtime.mail,
      updated,
      noticeRaw as RecruitMailKind,
      await noticeContext(ctx),
      actorOf(ctx),
    )
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: statusChanged ? 'advance_application' : 'update_application',
    resource: 'applications',
    targetId: record.id,
    detail: [
      `${record.name}(${record.studentId})`,
      statusChanged
        ? `${applicationLabel(record.stage, record.result)} → ${applicationLabel(nextStage, nextResult)}`
        : '字段更新',
      mail ? `mail=${mail.code}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    ...requestMeta(ctx),
  })

  return ok({ application: toAdminView(updated, ctx.url.origin), mail })
}

// ===== 手动补录考生 =====

interface CreateApplicationBody {
  name?: string
  studentId?: string
  email?: string
  phone?: string
  qq?: string
}

/**
 * 手动补录考生：**没有在官网报名、但现场来考的人**。
 *
 * 开放参加制下这种人是常态（看到海报就来了），签到页也允许他们直接填姓名学号，
 * 但那样他们的信息不会进名单、后面发通知也找不到人 —— 所以给管理员一个补录入口。
 *
 * 与官网报名的差别（刻意的）：
 *   - **不要求报名表文件**：人已经站在考场里了，材料可以后补或不要；
 *   - 联系方式全部可选（签到页只要求姓名 + 学号，邮箱可能是后问到的）；
 *   - `source = 'manual'`，名单里会带「补录」标记，一眼能和官网报名区分开。
 * 补录完他们就处在报名阶段，确认笔试名单时和官网报名的人一起推进、一起收邀请函。
 */
export async function createApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<CreateApplicationBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const name = String(body.name ?? '').trim()
  const studentId = String(body.studentId ?? '').trim()
  if (!name) return fail(400, 'VALIDATION_FAILED', '请填写姓名')
  if (!studentId) return fail(400, 'VALIDATION_FAILED', '请填写学号')

  const email = String(body.email ?? '').trim()
  const phone = String(body.phone ?? '').trim()
  const qq = String(body.qq ?? '').trim()
  // 可选字段只在填了的时候校验格式，避免「不知道邮箱就补不了录」
  if (email && !APPLICATION_EMAIL_PATTERN.test(email)) {
    return fail(400, 'VALIDATION_FAILED', '邮箱格式不正确')
  }
  if (phone && !APPLICATION_PHONE_PATTERN.test(phone)) {
    return fail(400, 'VALIDATION_FAILED', '手机号应为 11 位数字')
  }
  if (qq && !APPLICATION_QQ_PATTERN.test(qq)) {
    return fail(400, 'VALIDATION_FAILED', 'QQ 号应为 5–12 位数字')
  }

  let created
  try {
    created = await createApplication(ctx.env, {
      studentId,
      name,
      email,
      phone,
      qq,
      fileUrl: '',
      fileName: '',
      fileSize: 0,
      source: 'manual',
    })
  } catch (error) {
    // student_id 有唯一约束，撞上就是这位同学已经存在（官网报过或已被补录过）
    if (await getApplicationByStudentId(ctx.env, studentId)) {
      return fail(409, 'ALREADY_EXISTS', '这个学号已经在名单里了，无需重复补录')
    }
    console.error('[applications] 补录失败', { studentId, error })
    return fail(500, 'CREATE_FAILED', '补录失败，请稍后重试')
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'create',
    resource: 'applications',
    targetId: created.id,
    detail: `补录考生 ${name}（${studentId}）`,
    ...requestMeta(ctx),
  })

  return ok({ application: toAdminView(created, ctx.url.origin) }, { status: 201 })
}

// ===== 批量操作 =====

interface BulkBody {
  ids?: string[]
  /** checkin 勾签到 / absent 标记未参加 / withdraw 退出报名 */
  action?: string
  /** checkin 需要指定阶段 */
  stage?: string
}

export async function bulkApplicationsAdmin(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<BulkBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const ids = (body.ids ?? []).map((id) => String(id).trim()).filter(Boolean)
  if (ids.length === 0) return fail(400, 'NO_SELECTION', '请先勾选要处理的同学')

  const action = (body.action ?? '').trim()
  const nowIso = new Date().toISOString()
  const updates: Array<{ id: string } & ApplicationPatch> = []

  switch (action) {
    case 'checkin': {
      const stage = (body.stage ?? '').trim() as CheckinStage
      const column = CHECKIN_COLUMN[stage]
      if (!column) return fail(400, 'INVALID_STAGE', '批量签到需要指定阶段')
      for (const id of ids) {
        const record = await getApplication(ctx.env, id)
        if (!record) continue
        const patch: { id: string } & ApplicationPatch = { id, [column]: nowIso }
        if (record.result === '') {
          patch.result = 'attended'
          patch.stageChangedAt = nowIso
        }
        updates.push(patch)
      }
      break
    }
    case 'absent':
    case 'withdraw': {
      const result: RecruitResult = action === 'absent' ? 'absent' : 'withdrawn'
      for (const id of ids) {
        const record = await getApplication(ctx.env, id)
        if (!record) continue
        if (!isValidStageResult(record.stage, result)) continue
        updates.push({ id, result, stageChangedAt: nowIso })
      }
      break
    }
    default:
      return fail(400, 'INVALID_ACTION', `未知的批量操作：${action}`)
  }

  const moved = await updateApplications(ctx.env, updates)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: `bulk_${action}`,
    resource: 'applications',
    targetId: action,
    detail: `勾选 ${ids.length} 条，实际改动 ${moved} 条`,
    ...requestMeta(ctx),
  })

  return ok({ moved })
}

// ===== 批量通知信 =====

interface NotifyBody {
  ids?: string[]
  subject?: string
  body?: string
}

/**
 * 给勾选的同学群发一封自定义邮件（如「面试地点改了」）。
 * 主题与正文同样支持 `{变量}`，渲染规则与系统通知一致。
 */
export async function notifyApplicationsAdmin(ctx: RequestContext): Promise<Response> {
  const payload = await readJsonBody<NotifyBody>(ctx.request)
  if (!payload) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const ids = (payload.ids ?? []).map((id) => String(id).trim()).filter(Boolean)
  if (ids.length === 0) return fail(400, 'NO_SELECTION', '请先勾选要通知的同学')

  const subject = (payload.subject ?? '').trim()
  const text = (payload.body ?? '').trim()
  if (!subject) return fail(400, 'VALIDATION_FAILED', '请填写邮件主题')
  if (!text) return fail(400, 'VALIDATION_FAILED', '请填写邮件正文')

  const [settings, studio, runtime] = await Promise.all([
    getRecruitSettings(ctx.env),
    getSiteConfig(ctx.env),
    resolveRuntimeConfig(ctx),
  ])
  const context: NoticeContext = {
    studio,
    cycle: settings.cycle,
    templates: settings.templates,
    origin: ctx.url.origin,
  }

  const results: SendNoticeResult[] = []
  for (const id of ids) {
    const record = await getApplication(ctx.env, id)
    if (!record) continue

    // 自定义通知复用系统通知的变量与渲染规则，只是换了文案
    const to = record.email.trim()
    if (!to) {
      results.push({
        kind: 'written_invite',
        sent: false,
        code: 'NO_RECIPIENT',
        message: `${record.name} 没有邮箱，未发送`,
        to: '',
      })
      continue
    }

    const vars = buildNoticeVars(record, context)
    const built = {
      to,
      subject: renderTemplate(subject, vars).trim() || subject,
      text: renderTemplate(text, vars),
    }

    const outcome = isMailConfigured(ctx.env, runtime.mail)
      ? await sendMail(ctx.env, runtime.mail, {
          to: built.to,
          subject: built.subject,
          text: built.text,
          replyTo: studio.contactEmail.trim() || undefined,
        })
      : {
          ok: false as const,
          code: 'NOT_CONFIGURED' as const,
          message: '邮件通道未接通，本封信未发送',
        }

    const result: SendNoticeResult = {
      kind: 'written_invite',
      sent: outcome.ok,
      code: outcome.ok ? 'OK' : outcome.code,
      message: outcome.ok ? `已发送至 ${built.to}` : outcome.message,
      to: built.to,
    }
    results.push(result)

    // 自定义通知同样进发信日志，后台能看到「谁收到过什么」
    await writeMailLog(ctx.env, {
      applicationId: record.id,
      kind: 'custom',
      recipient: built.to,
      subject: built.subject,
      ok: result.sent,
      code: result.code,
      message: result.sent ? '自定义通知' : result.message,
      actor: actorOf(ctx),
    })
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'notify_applications',
    resource: 'applications',
    targetId: 'notify',
    detail: `群发「${subject}」给 ${ids.length} 人：${summarizeMailResults(results)}`,
    ...requestMeta(ctx),
  })

  return ok({ summary: summarizeMailResults(results), results })
}

// ===== 下载 / 删除 =====

/** 报名表下载：这是唯一能取到 `applications/` 文件内容的接口（学生隐私不外泄） */
export async function downloadApplicationFile(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const ref = await resolveFileRef(ctx.env, record.fileUrl)
  if (!ref) return fail(404, 'FILE_MISSING', '该记录没有报名表文件')

  const storage = await getStorage(ctx.env, ref.purpose)
  const object = await storage.get(ref.key)
  if (!object) return fail(404, 'FILE_NOT_FOUND', '报名表文件已丢失')

  const fallbackName = record.fileName || ref.key.split('/').pop() || 'application'
  const headers = new Headers({
    'content-type': object.contentType ?? 'application/octet-stream',
    // 隐私材料，禁止任何中间缓存
    'cache-control': 'no-store',
    // 中文文件名必须走 RFC 5987 的 filename*，只给 filename 在部分浏览器会乱码
    'content-disposition': `attachment; filename="application"; filename*=UTF-8''${encodeURIComponent(
      fallbackName,
    )}`,
  })

  return new Response(object.body as unknown as BodyInit, { headers })
}

export async function deleteApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const removed = await deleteApplication(ctx.env, record.id)
  if (!removed) return fail(404, 'NOT_FOUND', '报名记录不存在')

  // 顺手清掉存储桶里的报名表，避免留下含个人信息的孤儿文件
  await deleteStoredFile(ctx.env, record.fileUrl)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'delete',
    resource: 'applications',
    targetId: record.id,
    detail: `${record.name}(${record.studentId})`,
    ...requestMeta(ctx),
  })

  return ok({ id: record.id })
}


