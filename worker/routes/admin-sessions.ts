/**
 * 考试场次与签到二维码的**后台接口**（全部需要管理员会话）。
 *
 *   GET    /api/admin/recruit/sessions                     场次列表 + 各场签到人数 + 有效二维码
 *   POST   /api/admin/recruit/sessions                     新建场次
 *   PUT    /api/admin/recruit/sessions/:id                 修改场次
 *   DELETE /api/admin/recruit/sessions/:id                 删除场次（连带作废该场二维码、清签到归属）
 *   POST   /api/admin/recruit/sessions/:id/checkin-token   签发该场的签到二维码（旧码自动作废）
 *   POST   /api/admin/recruit/checkin-tokens/revoke        作废二维码（给 sessionId 只作废一场，否则全部）
 *
 * 为什么「重新生成二维码」要把旧码作废：二维码会被拍照转发，重发往往正是因为旧码泄出去了。
 * 如果只是再追加一张，作废按钮就形同虚设。
 *
 * 场次变化后统一调用 `syncDerivedSchedule()`，把首场时间 / 末场结束时间同步回周期配置 ——
 * 「笔试全部结束」是缺考标记的起点，必须与场次一致。
 */

import {
  CHECKIN_TOKEN_TTL_HOURS,
  checkinTokenPath,
  isCheckinStage,
  isCheckinTokenUsable,
  SESSION_STAGE_LABELS,
  sessionLabel,
  sessionTimeText,
  validateSession,
  type CheckinStage,
  type SessionStage,
} from '../../shared/recruit'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import {
  countCheckinsBySession,
  createSession,
  deleteSession,
  getSession,
  issueCheckinToken,
  listActiveCheckinTokens,
  listSessions,
  revokeCheckinTokens,
  syncDerivedSchedule,
  updateSession,
} from '../lib/recruit-sessions'
import { writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

/** 签到二维码要印出来给手机扫，必须是绝对地址 */
function absoluteCheckinUrl(ctx: RequestContext, token: string): string {
  return `${ctx.url.origin.replace(/\/+$/, '')}${checkinTokenPath(token)}`
}

/** 后台看到的场次：补上序号称呼、时间文本与到场人数 */
function toSessionView(
  session: Awaited<ReturnType<typeof listSessions>>[number],
  index: number,
  counts: Record<string, number>,
) {
  return {
    ...session,
    label: sessionLabel(session, index),
    stageLabel: SESSION_STAGE_LABELS[session.stage],
    timeText: sessionTimeText(session),
    checkinCount: counts[session.id] ?? 0,
  }
}

// ===== 列表 =====

export async function listSessionsAdmin(ctx: RequestContext): Promise<Response> {
  const [sessions, counts, tokens] = await Promise.all([
    listSessions(ctx.env),
    countCheckinsBySession(ctx.env),
    listActiveCheckinTokens(ctx.env),
  ])

  const labeled = sessions.map((session, index) => toSessionView(session, index, counts))
  const labelOf = new Map(labeled.map((session) => [session.id, session.label]))

  // 每个阶段的有效二维码（同一场次至多一张）
  const codes = tokens
    .filter((token) => isCheckinTokenUsable(token.expiresAt, token.revokedAt))
    .map((token) => ({
      sessionId: token.sessionId,
      stage: token.stage,
      sessionLabel: labelOf.get(token.sessionId) ?? '（场次已删除）',
      expiresAt: token.expiresAt,
      url: absoluteCheckinUrl(ctx, token.token),
      createdBy: token.createdBy,
      createdAt: token.createdAt,
    }))

  return ok({ sessions: labeled, codes })
}

// ===== 增删改 =====

interface SessionBody {
  stage?: string
  name?: string
  startsAt?: string
  endsAt?: string
  place?: string
  note?: string
  sortOrder?: number
}

function normalizeStage(raw: string | undefined): SessionStage | null {
  const stage = (raw ?? '').trim()
  return isCheckinStage(stage) ? (stage as CheckinStage) : null
}

export async function createSessionAdmin(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<SessionBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const stage = normalizeStage(body.stage)
  if (!stage) return fail(400, 'INVALID_STAGE', '场次阶段只能是笔试 / 面试 / 答辩之一')

  const input = {
    stage,
    name: body.name,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    place: body.place,
    note: body.note,
  }
  const invalid = validateSession(input)
  if (invalid) return fail(400, 'VALIDATION_FAILED', invalid)

  const created = await createSession(ctx.env, {
    ...input,
    startsAt: String(input.startsAt ?? ''),
    sortOrder: body.sortOrder,
  })
  await syncDerivedSchedule(ctx.env)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'create',
    resource: 'recruit_sessions',
    targetId: created.id,
    detail: `${SESSION_STAGE_LABELS[stage]}场次 ${created.name || created.startsAt}`,
    ...requestMeta(ctx),
  })

  return ok({ session: created }, { status: 201 })
}

export async function updateSessionAdmin(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id
  const current = await getSession(ctx.env, id)
  if (!current) return fail(404, 'NOT_FOUND', '场次不存在')

  const body = await readJsonBody<SessionBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  // 合并后再校验，保证「只改结束时间」这类局部修改也走同一套规则
  const merged = {
    stage: normalizeStage(body.stage) ?? current.stage,
    name: body.name ?? current.name,
    startsAt: body.startsAt ?? current.startsAt,
    endsAt: body.endsAt ?? current.endsAt,
    place: body.place ?? current.place,
    note: body.note ?? current.note,
  }
  const invalid = validateSession(merged)
  if (invalid) return fail(400, 'VALIDATION_FAILED', invalid)

  const updated = await updateSession(ctx.env, id, {
    stage: merged.stage,
    name: merged.name,
    startsAt: merged.startsAt,
    endsAt: merged.endsAt,
    place: merged.place,
    note: merged.note,
    sortOrder: body.sortOrder,
  })
  if (!updated) return fail(404, 'NOT_FOUND', '场次不存在')

  await syncDerivedSchedule(ctx.env)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'update',
    resource: 'recruit_sessions',
    targetId: id,
    detail: `${SESSION_STAGE_LABELS[updated.stage]}场次 ${updated.name || updated.startsAt}`,
    ...requestMeta(ctx),
  })

  return ok({ session: updated })
}

interface DeleteBody {
  /** 确认删除（前端二次确认后带上），避免误点 */
  confirm?: boolean
}

export async function deleteSessionAdmin(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id
  const session = await getSession(ctx.env, id)
  if (!session) return fail(404, 'NOT_FOUND', '场次不存在')

  const body = await readJsonBody<DeleteBody>(ctx.request).catch(() => null)
  if (body && body.confirm === false) {
    return fail(400, 'CONFIRM_REQUIRED', '删除场次会作废该场二维码，请确认后再试')
  }

  const removed = await deleteSession(ctx.env, id)
  if (!removed) return fail(404, 'NOT_FOUND', '场次不存在')

  await syncDerivedSchedule(ctx.env)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'delete',
    resource: 'recruit_sessions',
    targetId: id,
    detail: `${SESSION_STAGE_LABELS[session.stage]}场次 ${session.name || session.startsAt}`,
    ...requestMeta(ctx),
  })

  return ok({ id })
}

// ===== 签到二维码 =====

interface IssueBody {
  /** 有效期（小时），留空用默认值；实际到期不早于场次结束时间 */
  ttlHours?: number
}

export async function issueCheckinTokenAdmin(ctx: RequestContext): Promise<Response> {
  const session = await getSession(ctx.env, ctx.params.id)
  if (!session) return fail(404, 'NOT_FOUND', '场次不存在')

  const body = await readJsonBody<IssueBody>(ctx.request).catch(() => null)
  const ttlHours = Number(body?.ttlHours) || CHECKIN_TOKEN_TTL_HOURS

  try {
    const { token, expiresAt } = await issueCheckinToken(ctx.env, {
      sessionId: session.id,
      ttlHours,
      actor: actorOf(ctx),
    })

    await writeAudit(ctx.env, {
      actor: actorOf(ctx),
      action: 'issue_checkin_token',
      resource: 'recruit_checkin_tokens',
      targetId: session.id,
      detail: `${SESSION_STAGE_LABELS[session.stage]}场次 ${session.name || session.startsAt}，有效至 ${expiresAt}`,
      ...requestMeta(ctx),
    })

    return ok({
      token,
      expiresAt,
      url: absoluteCheckinUrl(ctx, token),
      sessionId: session.id,
      stage: session.stage,
      sessionLabel: sessionLabel(session, 0),
    })
  } catch (error) {
    return fail(500, 'ISSUE_FAILED', error instanceof Error ? error.message : '签发签到二维码失败')
  }
}

interface RevokeBody {
  /** 留空表示作废全部 */
  sessionId?: string
}

export async function revokeCheckinTokensAdmin(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<RevokeBody>(ctx.request).catch(() => null)
  const sessionId = (body?.sessionId ?? '').trim()

  const revoked = await revokeCheckinTokens(ctx.env, sessionId ? { sessionId } : {})

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'revoke_checkin_token',
    resource: 'recruit_checkin_tokens',
    targetId: sessionId || '(all)',
    detail: `作废 ${revoked} 张签到二维码`,
    ...requestMeta(ctx),
  })

  return ok({ revoked })
}
