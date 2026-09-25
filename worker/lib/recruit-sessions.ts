/**
 * 考试场次与签到二维码凭证的 D1 仓储。
 *
 * 两个概念（表见 migrations/0008_recruit_sessions.sql）：
 *   recruit_sessions       笔试 / 面试 / 答辩各自的场次，一场一条（开放参加制）
 *   recruit_checkin_tokens 签到二维码的凭证，绑场次 + 带失效时间 + 可作废
 *
 * 职责边界：
 *   - 本文件只管「场次与凭证」的读写，不关心流程推进（那在 lib/recruit-auto.ts）；
 *   - 场次变化后要把派生的时间同步回周期配置（`syncDerivedSchedule`），
 *     否则「笔试全部结束」这个判定（缺考标记的起点）会与场次打架。
 *
 * 列名只来自本文件的常量表，不接受任何外部输入拼 SQL。
 */

import {
  CHECKIN_STAGES,
  CHECKIN_TOKEN_TTL_HOURS,
  lastSessionEnd,
  sessionsOfStage,
  type CheckinStage,
  type RecruitSession,
  type SessionStage,
} from '../../shared/recruit'
import { epochToCnTime } from '../../shared/time'
import type { Env } from '../env'
import { randomHex, randomId } from './crypto'
import { getRecruitSettings, saveRecruitSettings } from './recruit-config'

/** 阶段 → applications 里记录「签的哪一场」的 SQL 列名（写入与统计要用） */
export const SESSION_COLUMN: Record<SessionStage, string> = {
  written: 'written_session_id',
  interview: 'interview_session_id',
  defense: 'defense_session_id',
}

/**
 * 同上，但给「字段名」用（拼 updateApplication 的 patch）。
 * 刻意用 `as const` 保留字面量类型 —— 计算属性名是联合字面量时 TS 才能校验出正确形状。
 */
export const SESSION_FIELD = {
  written: 'writtenSessionId',
  interview: 'interviewSessionId',
  defense: 'defenseSessionId',
} as const

/** 固定列顺序：SELECT 与写入共用，新增字段只改这里 */
const SESSION_COLUMNS: ReadonlyArray<readonly [keyof RecruitSession, string]> = [
  ['id', 'id'],
  ['stage', 'stage'],
  ['name', 'name'],
  ['startsAt', 'starts_at'],
  ['endsAt', 'ends_at'],
  ['place', 'place'],
  ['note', 'note'],
  ['sortOrder', 'sort_order'],
]

const SESSION_SELECT = SESSION_COLUMNS.map(([, column]) => column).join(', ')
const SESSION_COLUMN_OF = new Map<string, string>(SESSION_COLUMNS.map(([key, column]) => [key, column]))

function rowToSession(row: Record<string, unknown>): RecruitSession {
  // 行键是 SQL 列名（snake_case），这里按字段名取 —— 不经过映射就会全读成空串
  const read = (key: keyof RecruitSession): string =>
    String(row[SESSION_COLUMN_OF.get(key) ?? key] ?? '')

  const stage = read('stage')
  return {
    id: read('id'),
    // 库里的 stage 只可能是 CHECKIN_STAGES 之一（写入前已校验），脏数据按笔试兜底
    stage: (CHECKIN_STAGES as readonly string[]).includes(stage) ? (stage as SessionStage) : 'written',
    name: read('name'),
    startsAt: read('startsAt'),
    endsAt: read('endsAt'),
    place: read('place'),
    note: read('note'),
    sortOrder: Number(read('sortOrder')) || 0,
  }
}

// ===== 场次：读 =====

/** 全部场次，按「阶段顺序 → sortOrder → 开始时间」排好，后台与邀请函都直接用这个顺序 */
export async function listSessions(env: Env): Promise<RecruitSession[]> {
  const result = await env.DB.prepare(
    `SELECT ${SESSION_SELECT} FROM recruit_sessions ORDER BY sort_order ASC, starts_at ASC`,
  ).all<Record<string, unknown>>()

  const all = (result.results ?? []).map(rowToSession)
  // 再按阶段分组排序，保证「笔试几场 → 面试几场 → 答辩几场」的稳定顺序
  return CHECKIN_STAGES.flatMap((stage) => sessionsOfStage(all, stage))
}

export async function getSession(env: Env, id: string): Promise<RecruitSession | null> {
  const row = await env.DB.prepare(`SELECT ${SESSION_SELECT} FROM recruit_sessions WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>()
  return row ? rowToSession(row) : null
}

/** 按 id 取一批场次，返回 Map 便于渲染时查名字 */
export async function listSessionMap(env: Env): Promise<Map<string, RecruitSession>> {
  const sessions = await listSessions(env)
  return new Map(sessions.map((session) => [session.id, session]))
}

// ===== 场次：写 =====

export interface NewSessionInput {
  stage: SessionStage
  name?: string
  startsAt: string
  endsAt?: string
  place?: string
  note?: string
  sortOrder?: number
}

export async function createSession(env: Env, input: NewSessionInput): Promise<RecruitSession> {
  const now = new Date().toISOString()
  const id = randomId('sess')
  // 没指定顺序就排到该阶段末尾，管理员新建一场不用自己算序号
  const sortOrder =
    input.sortOrder ?? (await nextSortOrder(env, input.stage))

  await env.DB.prepare(
    `INSERT INTO recruit_sessions
       (id, stage, name, starts_at, ends_at, place, note, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.stage,
      (input.name ?? '').trim(),
      input.startsAt.trim(),
      (input.endsAt ?? '').trim(),
      (input.place ?? '').trim(),
      (input.note ?? '').trim(),
      sortOrder,
      now,
      now,
    )
    .run()

  const created = await getSession(env, id)
  if (!created) throw new Error('场次写入后读取失败')
  return created
}

async function nextSortOrder(env: Env, stage: SessionStage): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT MAX(sort_order) AS n FROM recruit_sessions WHERE stage = ?',
  )
    .bind(stage)
    .first<{ n: number | null }>()
  return (Number(row?.n) || 0) + 1
}

export type SessionPatch = Partial<Omit<RecruitSession, 'id' | 'stage'>> & {
  stage?: SessionStage
}

export async function updateSession(
  env: Env,
  id: string,
  patch: SessionPatch,
): Promise<RecruitSession | null> {
  const assignments: string[] = []
  const binds: unknown[] = []

  for (const [key, column] of SESSION_COLUMNS) {
    if (key === 'id') continue
    const value = patch[key]
    if (value === undefined) continue
    assignments.push(`${column} = ?`)
    binds.push(typeof value === 'number' ? value : String(value).trim())
  }

  if (assignments.length > 0) {
    assignments.push('updated_at = ?')
    binds.push(new Date().toISOString())
    await env.DB.prepare(`UPDATE recruit_sessions SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run()
  }

  return getSession(env, id)
}

/**
 * 删除场次。连带两件事，否则会留下脏数据：
 *   1. 该场次的签到二维码全部作废（贴在场馆墙上的旧码立刻失效）；
 *   2. 已签在该场次上的记录把 session_id 清空（签到时间保留 —— 人确实来过）。
 */
export async function deleteSession(env: Env, id: string): Promise<boolean> {
  const column = (await getSession(env, id))?.stage
  if (!column) return false

  await env.DB.batch([
    env.DB.prepare('UPDATE recruit_checkin_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at = ?').bind(
      new Date().toISOString(),
      id,
      '',
    ),
    env.DB.prepare(`UPDATE applications SET ${SESSION_COLUMN[column]} = '' WHERE ${SESSION_COLUMN[column]} = ?`).bind(id),
    env.DB.prepare('DELETE FROM recruit_sessions WHERE id = ?').bind(id),
  ])

  return true
}

// ===== 签到凭证 =====

export interface CheckinTokenRecord {
  token: string
  sessionId: string
  stage: string
  expiresAt: string
  revokedAt: string
  createdBy: string
  createdAt: string
}

const TOKEN_SELECT =
  'token, session_id, stage, expires_at, revoked_at, created_by, created_at'

function rowToToken(row: Record<string, unknown>): CheckinTokenRecord {
  return {
    token: String(row.token ?? ''),
    sessionId: String(row.session_id ?? ''),
    stage: String(row.stage ?? ''),
    expiresAt: String(row.expires_at ?? ''),
    revokedAt: String(row.revoked_at ?? ''),
    createdBy: String(row.created_by ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

/**
 * 给某个场次签发签到二维码凭证。
 *
 * **同时只保留一张有效码**：签发新码时把该场次尚未作废的旧码一并作废。
 * 理由是二维码会被拍照转发，重发往往正是因为旧码泄出去了 ——
 * 「重新生成」如果只是再加一张，作废按钮就形同虚设。
 */
export async function issueCheckinToken(
  env: Env,
  options: { sessionId: string; ttlHours?: number; actor: string },
): Promise<{ token: string; expiresAt: string }> {
  const session = await getSession(env, options.sessionId)
  if (!session) throw new Error('SESSION_NOT_FOUND: 场次不存在')

  const hours = Math.max(1, Math.min(24 * 30, options.ttlHours ?? CHECKIN_TOKEN_TTL_HOURS))

  // 到期时间取「现在 + TTL」与「场次结束时间」里更晚的那个：
  // 场次临时拖堂时，码不该在同学还在签到的时候就失效。
  const now = Date.now()
  const byTtl = now + hours * 3600 * 1000
  const sessionEnd = lastSessionEnd([session])
  const expiresAt = new Date(Math.max(byTtl, sessionEnd ?? 0)).toISOString()

  const nowIso = new Date().toISOString()
  const token = randomHex(16)

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE recruit_checkin_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at = ?',
    ).bind(nowIso, session.id, ''),
    env.DB.prepare(
      `INSERT INTO recruit_checkin_tokens
         (token, session_id, stage, expires_at, revoked_at, created_by, created_at)
       VALUES (?, ?, ?, ?, '', ?, ?)`,
    ).bind(token, session.id, session.stage, expiresAt, options.actor, nowIso),
  ])

  return { token, expiresAt }
}

/** 作废凭证：给 sessionId 就只作废那一场，否则作废全部未失效的 */
export async function revokeCheckinTokens(
  env: Env,
  options: { sessionId?: string } = {},
): Promise<number> {
  const nowIso = new Date().toISOString()
  const statement = options.sessionId
    ? env.DB.prepare(
        'UPDATE recruit_checkin_tokens SET revoked_at = ? WHERE revoked_at = ? AND session_id = ?',
      ).bind(nowIso, '', options.sessionId)
    : env.DB.prepare('UPDATE recruit_checkin_tokens SET revoked_at = ? WHERE revoked_at = ?').bind(
        nowIso,
        '',
      )
  const result = await statement.run()
  return result.meta?.changes ?? 0
}

export async function getCheckinToken(env: Env, token: string): Promise<CheckinTokenRecord | null> {
  if (!token) return null
  const row = await env.DB.prepare(
    `SELECT ${TOKEN_SELECT} FROM recruit_checkin_tokens WHERE token = ?`,
  )
    .bind(token)
    .first<Record<string, unknown>>()
  return row ? rowToToken(row) : null
}

/** 后台展示用：仍有效的凭证（哪个场次、什么时候失效、谁签发的） */
export async function listActiveCheckinTokens(env: Env): Promise<CheckinTokenRecord[]> {
  const result = await env.DB.prepare(
    `SELECT ${TOKEN_SELECT} FROM recruit_checkin_tokens
       WHERE revoked_at = '' ORDER BY created_at DESC`,
  ).all<Record<string, unknown>>()
  return (result.results ?? []).map(rowToToken)
}

// ===== 统计 =====

/** 各场次已签到人数（key = session id）。签到记录里存的是 applications.*_session_id */
export async function countCheckinsBySession(env: Env): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const stage of CHECKIN_STAGES) {
    const column = SESSION_COLUMN[stage]
    const result = await env.DB.prepare(
      `SELECT ${column} AS sid, COUNT(*) AS n FROM applications
         WHERE ${column} <> '' GROUP BY ${column}`,
    ).all<{ sid: string; n: number }>()
    for (const row of result.results ?? []) {
      counts[String(row.sid)] = Number(row.n) || 0
    }
  }
  return counts
}

// ===== 派生时间同步 =====

/**
 * 把场次派生的时间写回周期配置。
 *
 * 「笔试全部结束」是缺考标记的起点（`isAbsentWindowPassed`），它读的是周期里的
 * `writtenEnd`。场次是真正的排期，所以有场次时必须由场次换算，否则两处会打架。
 * 规则：某阶段**有场次**才覆盖（首场时间 / 地点、末场结束时间）；没场次就保留手填的兜底值。
 */
export async function syncDerivedSchedule(env: Env): Promise<void> {
  const [sessions, settings] = await Promise.all([listSessions(env), getRecruitSettings(env)])
  const next = { ...settings.cycle }
  let changed = false

  const written = sessionsOfStage(sessions, 'written')
  if (written.length > 0) {
    const first = written[0]
    const end = epochToCnTime(lastSessionEnd(written) ?? 0)
    // 首场时间 / 地点写进 {writtenAt} / {writtenPlace}，整份列表走 {writtenSessions}
    if (next.writtenAt !== first.startsAt) {
      next.writtenAt = first.startsAt
      changed = true
    }
    if (next.writtenPlace !== first.place) {
      next.writtenPlace = first.place
      changed = true
    }
    // 末场结束时间最晚的那一场 = 「笔试全部结束」
    if (next.writtenEnd !== end) {
      next.writtenEnd = end
      changed = true
    }
  }

  const interview = sessionsOfStage(sessions, 'interview')
  if (interview.length > 0) {
    const first = interview[0]
    if (next.interviewAt !== first.startsAt) {
      next.interviewAt = first.startsAt
      changed = true
    }
    if (next.interviewPlace !== first.place) {
      next.interviewPlace = first.place
      changed = true
    }
  }

  if (changed) await saveRecruitSettings(env, { cycle: next })
}

/** 某个阶段是否已经排了场次（周期页据此决定要不要显示兜底输入框） */
export async function stagesWithSessions(env: Env): Promise<Set<CheckinStage>> {
  const sessions = await listSessions(env)
  return new Set(sessions.map((session) => session.stage))
}
