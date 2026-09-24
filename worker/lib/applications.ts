/**
 * 招新报名的 D1 仓储。
 *
 * 与 `lib/repo.ts`（由 shared/resources.ts 驱动的通用 CRUD）分开：
 * applications 是「学生写、管理员读」的流水线，有自己的状态机与侧效，
 * 不适合塞进通用资源的声明式模型里，所以这里显式列出列映射。
 *
 * 列名只来自本文件的常量表，不接受任何外部输入拼 SQL。
 */

import type { Application, ApplicationStatus } from '../../shared/types'
import type { Env } from '../env'
import { randomId } from './crypto'

/** 含邀请函凭证的内部记录 —— 凭证是敏感数据，只给管理员接口用，不下发学生端 */
export interface ApplicationRecord extends Application {
  inviteToken: string
  inviteExpiresAt: string
}

/** 字段 → 列名。顺序即 SELECT 顺序，新增字段只改这里。 */
const COLUMNS: ReadonlyArray<readonly [keyof ApplicationRecord, string]> = [
  ['id', 'id'],
  ['studentId', 'student_id'],
  ['name', 'name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['qq', 'qq'],
  ['fileUrl', 'file_url'],
  ['fileName', 'file_name'],
  ['fileSize', 'file_size'],
  ['status', 'status'],
  ['writtenAt', 'written_at'],
  ['writtenScore', 'written_score'],
  ['writtenNote', 'written_note'],
  ['interviewAt', 'interview_at'],
  ['interviewNote', 'interview_note'],
  ['probationNote', 'probation_note'],
  ['inviteToken', 'invite_token'],
  ['inviteExpiresAt', 'invite_expires_at'],
  ['invitedAt', 'invited_at'],
  ['confirmedAt', 'confirmed_at'],
  ['memberId', 'member_id'],
  ['note', 'note'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at'],
]

const COLUMN_OF = new Map<string, string>(COLUMNS.map(([key, column]) => [key, column]))
const SELECT_LIST = COLUMNS.map(([, column]) => column).join(', ')

/** 可空列统一转字符串，数值列转数字，避免前端拿到 null 又要判断一次 */
function decodeValue(key: keyof ApplicationRecord, raw: unknown): unknown {
  if (key === 'fileSize') return Number(raw) || 0
  if (raw === null || raw === undefined) return ''
  return String(raw)
}

function rowToRecord(row: Record<string, unknown>): ApplicationRecord {
  const out: Record<string, unknown> = {}
  for (const [key] of COLUMNS) {
    out[key] = decodeValue(key, row[COLUMN_OF.get(key) ?? key])
  }
  return out as unknown as ApplicationRecord
}

/** 新建报名的入参（状态、时间戳由本文件补） */
export interface NewApplication {
  studentId: string
  name: string
  email: string
  phone: string
  qq: string
  fileUrl: string
  fileName: string
  fileSize: number
}

export async function createApplication(env: Env, input: NewApplication): Promise<ApplicationRecord> {
  const now = new Date().toISOString()
  const id = randomId('app')

  await env.DB.prepare(
    `INSERT INTO applications
       (id, student_id, name, email, phone, qq, file_url, file_name, file_size, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
  )
    .bind(
      id,
      input.studentId,
      input.name,
      input.email,
      input.phone,
      input.qq,
      input.fileUrl,
      input.fileName,
      input.fileSize,
      now,
      now,
    )
    .run()

  const created = await getApplication(env, id)
  if (!created) throw new Error('报名记录写入后读取失败')
  return created
}

export async function getApplication(env: Env, id: string): Promise<ApplicationRecord | null> {
  const row = await env.DB.prepare(`SELECT ${SELECT_LIST} FROM applications WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>()
  return row ? rowToRecord(row) : null
}

/** 按学号取 —— 报名提交时用来判断「这位同学是不是已经报过名」 */
export async function getApplicationByStudentId(
  env: Env,
  studentId: string,
): Promise<ApplicationRecord | null> {
  const row = await env.DB.prepare(`SELECT ${SELECT_LIST} FROM applications WHERE student_id = ?`)
    .bind(studentId)
    .first<Record<string, unknown>>()
  return row ? rowToRecord(row) : null
}

/** 按邀请函凭证取（凭证即密权，公开接口靠它认人） */
export async function getApplicationByInviteToken(
  env: Env,
  token: string,
): Promise<ApplicationRecord | null> {
  if (!token) return null
  const row = await env.DB.prepare(`SELECT ${SELECT_LIST} FROM applications WHERE invite_token = ?`)
    .bind(token)
    .first<Record<string, unknown>>()
  return row ? rowToRecord(row) : null
}

/**
 * 局部更新：只写传入的字段。
 * 键必须在 COLUMNS 白名单里，否则直接忽略（杜绝拼出任意列名）。
 */
export async function updateApplication(
  env: Env,
  id: string,
  patch: Partial<Omit<ApplicationRecord, 'id' | 'studentId' | 'createdAt'>>,
): Promise<ApplicationRecord | null> {
  const assignments: string[] = []
  const binds: unknown[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMN_OF.get(key)
    if (!column || column === 'id' || column === 'student_id' || column === 'created_at') continue
    if (value === undefined) continue
    assignments.push(`${column} = ?`)
    binds.push(typeof value === 'number' ? value : String(value ?? ''))
  }

  if (assignments.length > 0) {
    assignments.push('updated_at = ?')
    binds.push(new Date().toISOString())
    await env.DB.prepare(`UPDATE applications SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run()
  }

  return getApplication(env, id)
}

export async function deleteApplication(env: Env, id: string): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM applications WHERE id = ?').bind(id).run()
  return (result.meta?.changes ?? 0) > 0
}

export interface ListApplicationsOptions {
  /** 状态筛选，空表示全部 */
  statuses?: ApplicationStatus[]
  search?: string
  limit?: number
  offset?: number
}

export interface ListApplicationsResult {
  items: ApplicationRecord[]
  total: number
}

function whereClause(options: ListApplicationsOptions): { where: string; binds: unknown[] } {
  const clauses: string[] = []
  const binds: unknown[] = []

  const statuses = (options.statuses ?? []).filter(Boolean)
  if (statuses.length > 0) {
    clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`)
    binds.push(...statuses)
  }

  const term = options.search?.trim()
  if (term) {
    // 报名表里能搜的就是「人」——姓名 / 学号 / 邮箱 / 手机号 / QQ
    const columns = ['name', 'student_id', 'email', 'phone', 'qq']
    clauses.push(`(${columns.map((c) => `${c} LIKE ?`).join(' OR ')})`)
    binds.push(...columns.map(() => `%${term}%`))
  }

  return { where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', binds }
}

export async function listApplications(
  env: Env,
  options: ListApplicationsOptions = {},
): Promise<ListApplicationsResult> {
  const { where, binds } = whereClause(options)
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000)
  const offset = Math.max(options.offset ?? 0, 0)

  const [rows, count] = await Promise.all([
    env.DB
      // 待处理的排前面，其余按报名时间倒序
      .prepare(`SELECT ${SELECT_LIST} FROM applications${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM applications${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ])

  return {
    items: (rows.results ?? []).map(rowToRecord),
    total: count?.n ?? 0,
  }
}

/** 按状态计数（后台列表页顶部的分状态徽章） */
export async function countApplicationsByStatus(env: Env): Promise<Record<string, number>> {
  const result = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM applications GROUP BY status')
    .all<{ status: string; n: number }>()

  const counts: Record<string, number> = {}
  for (const row of result.results ?? []) counts[row.status] = row.n
  return counts
}

/**
 * 给报名同学本人看的视图：
 * - 隐去邀请凭证（那是邮件里的密权）与管理员备注；
 * - 隐去笔试成绩、面试评语、预备期评语 —— 这些是内部评审记录，不对本人展示；
 * - 保留各阶段的时间（笔试 / 面试安排要让他知道）。
 */
export function toStudentView(record: ApplicationRecord): Application {
  // 直接展开即可 —— 多余的 inviteToken / inviteExpiresAt 会落在 Application 之外，
  // 不会随响应下发（对象展开不做多余属性检查）
  const view: Application = { ...record }
  return {
    ...view,
    writtenScore: '',
    writtenNote: '',
    interviewNote: '',
    probationNote: '',
    note: '',
  }
}
