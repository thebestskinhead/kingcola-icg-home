/**
 * 招新报名的**管理员侧**接口（全部需要管理员会话）。
 *
 *   GET    /api/admin/applications            列表（状态筛选 + 关键词搜索）
 *   GET    /api/admin/applications/:id        单条详情
 *   PUT    /api/admin/applications/:id        推进状态机 + 记录过程字段 + 发通知邮件
 *   GET    /api/admin/applications/:id/file   下载报名表（唯一能拿到该文件的入口）
 *   DELETE /api/admin/applications/:id        删除记录（连带清理 R2 文件）
 *
 * 状态流转**只走 PUT 这一个口**：改状态、写笔试/面试安排、发邮件是同一次操作，
 * 避免出现「状态改了但邮件没发」这种两头不一致。
 */

import type { SmtpConfig } from '../../shared/mail'
import {
  APPLICATION_NOTICE_META,
  APPLICATION_STATUS_META,
  APPLICATION_TRANSITIONS,
  applicationInviteExpiry,
  canTransition,
  isApplicationStatus,
  noticeForStatus,
  type ApplicationNoticeKind,
} from '../../shared/recruit'
import type { ApplicationStatus } from '../../shared/types'
import {
  countApplicationsByStatus,
  deleteApplication,
  getApplication,
  listApplications,
  updateApplication,
  type ApplicationRecord,
} from '../lib/applications'
import { randomHex } from '../lib/crypto'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { sendApplicationNotice } from '../lib/recruit-mail'
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

/** 管理端视图：把邀请凭证换成可直接复制的链接（凭证本身不外泄给前端） */
export interface AdminApplicationView extends ApplicationRecord {
  inviteUrl: string
  statusLabel: string
}

function toAdminView(record: ApplicationRecord, origin: string): AdminApplicationView {
  return {
    ...record,
    inviteUrl: record.inviteToken ? `${origin.replace(/\/+$/, '')}/invite/${record.inviteToken}` : '',
    statusLabel: APPLICATION_STATUS_META[record.status]?.label ?? record.status,
  }
}

// ===== 列表 / 详情 =====

export async function listApplicationsAdmin(ctx: RequestContext): Promise<Response> {
  const rawStatus = (ctx.url.searchParams.get('status') ?? '').trim()
  const statuses = rawStatus
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ApplicationStatus => Boolean(s) && isApplicationStatus(s))

  const [result, counts] = await Promise.all([
    listApplications(ctx.env, {
      statuses,
      search: ctx.url.searchParams.get('q') ?? undefined,
      limit: Number(ctx.url.searchParams.get('limit') ?? 200),
      offset: Number(ctx.url.searchParams.get('offset') ?? 0),
    }),
    countApplicationsByStatus(ctx.env),
  ])

  return ok({
    items: result.items.map((item) => toAdminView(item, ctx.url.origin)),
    total: result.total,
    counts,
  })
}

export async function getApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')
  return ok(toAdminView(record, ctx.url.origin))
}

// ===== 推进状态机 =====

interface UpdateApplicationBody {
  status?: string
  /** 管理员备注 */
  note?: string
  writtenAt?: string
  writtenScore?: string
  writtenNote?: string
  interviewAt?: string
  interviewNote?: string
  probationNote?: string
  /** 默认 true：状态推进后自动发对应的通知邮件 */
  sendMail?: boolean
  /** 显式指定要补发哪封信（状态不变也能重发） */
  notice?: string
}

export async function updateApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const body = await readJsonBody<UpdateApplicationBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  // ---- 1. 过程字段（与状态无关，随时可改） ----
  const patch: Record<string, string> = {}
  for (const key of [
    'note',
    'writtenAt',
    'writtenScore',
    'writtenNote',
    'interviewAt',
    'interviewNote',
    'probationNote',
  ] as const) {
    if (body[key] !== undefined) patch[key] = String(body[key] ?? '')
  }

  // ---- 2. 状态流转 ----
  const nextStatusRaw = (body.status ?? '').trim()
  let nextStatus: ApplicationStatus = record.status
  const changing = Boolean(nextStatusRaw) && nextStatusRaw !== record.status

  if (changing) {
    if (!isApplicationStatus(nextStatusRaw)) {
      return fail(400, 'INVALID_STATUS', `未知的状态：${nextStatusRaw}`)
    }
    nextStatus = nextStatusRaw
    if (!canTransition(record.status, nextStatus)) {
      const allowed = APPLICATION_TRANSITIONS[record.status]
        .map((s) => APPLICATION_STATUS_META[s].label)
        .join('、')
      return fail(
        409,
        'INVALID_TRANSITION',
        `不能从「${APPLICATION_STATUS_META[record.status].label}」直接改为「${
          APPLICATION_STATUS_META[nextStatus].label
        }」${allowed ? `，当前可改为：${allowed}` : '（该状态是终态）'}`,
      )
    }
    patch.status = nextStatus
  }

  // ---- 3. 邀请函：进入 invited 时签发一次性凭证 ----
  if (nextStatus === 'invited' && changing && !record.inviteToken) {
    patch.inviteToken = randomHex(24)
    patch.inviteExpiresAt = applicationInviteExpiry()
    patch.invitedAt = new Date().toISOString()
  }

  const updated =
    Object.keys(patch).length > 0 ? await updateApplication(ctx.env, record.id, patch) : record
  if (!updated) return fail(404, 'NOT_FOUND', '报名记录不存在')

  // ---- 4. 通知邮件 ----
  // 优先显式指定；否则按「状态推进」推导；状态没变又没指定就什么都不发
  const explicit = (body.notice ?? '').trim()
  const kind: ApplicationNoticeKind | null = explicit
    ? (explicit as ApplicationNoticeKind)
    : changing
      ? noticeForStatus(nextStatus)
      : null
  const known = kind !== null && Object.prototype.hasOwnProperty.call(APPLICATION_NOTICE_META, kind)

  let mail: Awaited<ReturnType<typeof sendApplicationNotice>> | null = null
  if (kind && known && body.sendMail !== false) {
    const [site, runtime] = await Promise.all([getSiteConfig(ctx.env), resolveRuntimeConfig(ctx)])
    mail = await sendApplicationNotice(ctx.env, runtime.mail as SmtpConfig, updated, kind, {
      studio: site,
      origin: ctx.url.origin,
    })
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: changing ? 'advance_application' : 'update_application',
    resource: 'applications',
    targetId: record.id,
    detail: [
      `${record.name}(${record.studentId})`,
      changing
        ? `${APPLICATION_STATUS_META[record.status].label} → ${APPLICATION_STATUS_META[nextStatus].label}`
        : '字段更新',
      mail ? `mail=${mail.code}` : kind ? 'mail=skipped' : '',
    ]
      .filter(Boolean)
      .join(' · '),
    ...requestMeta(ctx),
  })

  return ok({ application: toAdminView(updated, ctx.url.origin), mail })
}

// ===== 下载 / 删除 =====

/** 报名表下载：这是唯一能取到 `applications/` 文件内容的接口（学生隐私不外泄） */
export async function downloadApplicationFile(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const ref = await resolveFileRef(ctx.env, record.fileUrl)
  if (!ref) return fail(404, 'FILE_MISSING', '该记录没有报名表文件')

  const object = await (await getStorage(ctx.env, ref.purpose)).get(ref.key)
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
