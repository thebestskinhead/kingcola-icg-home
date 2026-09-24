/**
 * 招新报名的**学生侧**接口。
 *
 *   POST /api/applications                 提交报名表（需报名学生会话，multipart）
 *   GET  /api/applications/me              查看自己的报名进度
 *   GET  /api/applications/invite/:token   打开邀请函（凭证即密权，无需登录）
 *   POST /api/applications/invite/:token   确认加入，写入成员表
 *
 * 身份由教务网登录后的 `kc_student` 会话背书 —— 学号与姓名一律取自会话，
 * 不接受客户端传入，避免有人替别人报名。
 *
 * 报名表文件：类型按**文件头魔数**判定（不信扩展名/MIME），存进 R2 的
 * `applications/` 前缀；该前缀在 `GET /api/files/*` 被拦住，只有管理员能下载。
 */

import { RESOURCES, formatLimit } from '../../shared/resources'
import {
  APPLICATION_DOC_LIMIT,
  APPLICATION_DOC_SCOPE,
  isInviteUsable,
  validateApplicationForm,
} from '../../shared/recruit'
import { MEMBER_ROLES, type Application } from '../../shared/types'
import {
  createApplication,
  getApplicationByInviteToken,
  getApplicationByStudentId,
  toStudentView,
  updateApplication,
} from '../lib/applications'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { createEntity, getSiteConfig, writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { buildObjectKey, deleteLocalFile, fileUrl, sniffDocument } from '../lib/uploads'

/** 取会话里的身份；路由已保证 auth: 'student'，这里只做兜底 */
function identityOf(ctx: RequestContext): { studentId: string; name: string } | null {
  const student = ctx.student
  if (!student?.sub) return null
  return { studentId: student.sub, name: student.name ?? '' }
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

// ===== 提交报名表 =====

export async function submitApplication(ctx: RequestContext): Promise<Response> {
  const me = identityOf(ctx)
  if (!me) return fail(401, 'UNAUTHENTICATED', '登录状态已失效，请重新用教务网账号登录')

  const site = await getSiteConfig(ctx.env)
  if (!site.recruitOpen) {
    return fail(403, 'RECRUIT_CLOSED', '当前不在招新期，报名通道已关闭')
  }

  if (!ctx.env.FILES) {
    return fail(503, 'STORAGE_UNAVAILABLE', '未配置 R2 存储桶，暂无法接收报名表')
  }

  // 一位同学一条记录：已报过名就如实告知当前进度，而不是悄悄覆盖
  const existing = await getApplicationByStudentId(ctx.env, me.studentId)
  if (existing) {
    return fail(409, 'ALREADY_APPLIED', '你已经提交过报名表，可在本页查看当前进度')
  }

  let form: FormData
  try {
    form = await ctx.request.formData()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return fail(400, 'INVALID_BODY', `请求必须是 multipart/form-data 表单：${reason}`)
  }

  const input = {
    email: String(form.get('email') ?? ''),
    phone: String(form.get('phone') ?? ''),
    qq: String(form.get('qq') ?? ''),
  }
  const invalid = validateApplicationForm(input)
  if (invalid) return fail(400, 'VALIDATION_FAILED', invalid)

  let file = form.get('file')
  if (!(file instanceof File)) {
    // 与上传接口同样的容错：个别客户端上传的文件片段不带 name
    for (const value of form.values()) {
      if (value instanceof File && value.size > 0) {
        file = value
        break
      }
    }
  }
  if (!(file instanceof File)) return fail(400, 'NO_FILE', '请上传报名表文件（PDF / DOCX）')
  if (file.size === 0) return fail(400, 'EMPTY_FILE', '报名表文件内容为空')
  if (file.size > APPLICATION_DOC_LIMIT) {
    return fail(413, 'TOO_LARGE', `报名表不能超过 ${formatLimit(APPLICATION_DOC_LIMIT)}`)
  }

  const filename = file.name || ''
  if (filename && !/\.(pdf|docx)$/i.test(filename)) {
    return fail(415, 'UNSUPPORTED_TYPE', '仅支持 .pdf 或 .docx 文件')
  }

  // 只读文件头 16 字节做类型判定，整份内容以 Blob 直接交给 R2
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const kind = sniffDocument(head, filename)
  if (!kind) {
    return fail(415, 'UNSUPPORTED_TYPE', '文件校验失败：仅支持 PDF / DOCX 格式的真实文件，仅改后缀无效')
  }

  const key = buildObjectKey(APPLICATION_DOC_SCOPE, filename || 'application', kind.ext)
  await ctx.env.FILES.put(key, file, { httpMetadata: { contentType: kind.mime } })

  let created
  try {
    created = await createApplication(ctx.env, {
      studentId: me.studentId,
      name: me.name,
      email: input.email.trim(),
      phone: input.phone.trim(),
      qq: input.qq.trim(),
      fileUrl: fileUrl(key),
      fileName: filename || `application.${kind.ext}`,
      fileSize: file.size,
    })
  } catch (error) {
    // 落库失败就把刚上传的文件删掉，不留孤儿
    await deleteLocalFile(ctx.env, fileUrl(key))
    // 并发下可能撞上 UNIQUE(student_id)
    if (await getApplicationByStudentId(ctx.env, me.studentId)) {
      return fail(409, 'ALREADY_APPLIED', '你已经提交过报名表，可在本页查看当前进度')
    }
    console.error('[applications] 报名落库失败', { studentId: me.studentId, error })
    return fail(500, 'CREATE_FAILED', '报名表保存失败，请稍后重试')
  }

  await writeAudit(ctx.env, {
    actor: `student:${me.studentId}`,
    action: 'apply',
    resource: 'applications',
    targetId: created.id,
    detail: `${created.name} ${kind.ext} ${(file.size / 1024).toFixed(1)}KB`,
    ...requestMeta(ctx),
  })

  return ok(toStudentView(created), { status: 201 })
}

// ===== 我的报名进度 =====

export async function myApplication(ctx: RequestContext): Promise<Response> {
  const me = identityOf(ctx)
  if (!me) return fail(401, 'UNAUTHENTICATED', '未登录')

  const record = await getApplicationByStudentId(ctx.env, me.studentId)
  if (!record) {
    return ok({ application: null }, { headers: { 'cache-control': 'no-store' } })
  }

  // 已发出邀请函时顺带把确认页地址给他 —— 同学常常翻不到那封邮件，
  // 而这是他本人的记录，本人看自己的邀请链接没有额外暴露。
  const inviteUrl =
    record.status === 'invited' && isInviteUsable(record.inviteExpiresAt, record.status)
      ? `/invite/${record.inviteToken}`
      : ''

  return ok(
    { application: toStudentView(record) as Application, inviteUrl },
    { headers: { 'cache-control': 'no-store' } },
  )
}

// ===== 邀请函 =====

export async function getInvite(ctx: RequestContext): Promise<Response> {
  const record = await getApplicationByInviteToken(ctx.env, ctx.params.token)
  if (!record) return fail(404, 'INVITE_NOT_FOUND', '邀请链接无效，请确认是否复制完整')

  if (record.status === 'member') {
    return ok({
      alreadyMember: true,
      name: record.name,
      studentId: record.studentId,
      confirmedAt: record.confirmedAt,
    })
  }

  if (record.status !== 'invited') {
    return fail(409, 'INVITE_NOT_ACTIVE', '这份邀请函当前不可用，请联系工作室确认')
  }

  if (!isInviteUsable(record.inviteExpiresAt, record.status)) {
    return fail(410, 'INVITE_EXPIRED', '邀请链接已过期，请回复邮件联系我们重新发送')
  }

  return ok(
    {
      alreadyMember: false,
      name: record.name,
      studentId: record.studentId,
      email: record.email,
      expiresAt: record.inviteExpiresAt,
      /** 确认页要填的成员档案字段里，角色从这里选 */
      roleOptions: MEMBER_ROLES,
      /** 加入年份由服务端按当前年份填，这里只是给页面展示 */
      joinYear: String(new Date().getFullYear()),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

interface ConfirmInviteBody {
  /** 成员角色，必须是 MEMBER_ROLES 之一 */
  title?: string
  nameEn?: string
  /** 负责方向（在组期间的技术方向） */
  direction?: string
  bio?: string
  /** 展示用邮箱，留空则用报名时填的邮箱 */
  email?: string
}

export async function confirmInvite(ctx: RequestContext): Promise<Response> {
  const record = await getApplicationByInviteToken(ctx.env, ctx.params.token)
  if (!record) return fail(404, 'INVITE_NOT_FOUND', '邀请链接无效，请确认是否复制完整')

  if (record.status === 'member') {
    return fail(409, 'ALREADY_MEMBER', '你已确认加入，无需重复提交')
  }
  if (record.status !== 'invited') {
    return fail(409, 'INVITE_NOT_ACTIVE', '这份邀请函当前不可用，请联系工作室确认')
  }
  if (!isInviteUsable(record.inviteExpiresAt, record.status)) {
    return fail(410, 'INVITE_EXPIRED', '邀请链接已过期，请回复邮件联系我们重新发送')
  }

  const body = await readJsonBody<ConfirmInviteBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const title = String(body.title ?? '').trim()
  if (!title) return fail(400, 'VALIDATION_FAILED', '请选择你在工作室的方向')
  if (!(MEMBER_ROLES as readonly string[]).includes(title)) {
    return fail(400, 'VALIDATION_FAILED', `方向取值不合法：${title}`)
  }

  const email = String(body.email ?? '').trim() || record.email
  const now = new Date()

  // 写入成员表：姓名 / 学号沿用报名时的身份，年份由系统按当前年份填
  const member = await createEntity(ctx.env, RESOURCES.members, {
    name: record.name,
    nameEn: String(body.nameEn ?? '').trim(),
    title,
    direction: String(body.direction ?? '').trim(),
    email,
    joinYear: String(now.getFullYear()),
    status: 'current',
    isPI: false,
    bio: String(body.bio ?? '').trim(),
    avatarUrl: '',
    sortOrder: 0,
  })

  const updated = await updateApplication(ctx.env, record.id, {
    status: 'member',
    memberId: String(member.id),
    confirmedAt: now.toISOString(),
  })

  await writeAudit(ctx.env, {
    actor: `student:${record.studentId}`,
    action: 'confirm_invite',
    resource: 'applications',
    targetId: record.id,
    detail: `转正为成员 ${member.id}（${title}）`,
    ...requestMeta(ctx),
  })

  return ok({
    memberId: String(member.id),
    application: updated ? toStudentView(updated) : null,
  })
}
