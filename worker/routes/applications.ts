/**
 * 招新报名的**学生侧**接口 + 公开的周期状态。
 *
 *   GET  /api/public/recruit               本轮招新的时间窗与文案（报名页据此显隐表单）
 *   POST /api/applications                 提交报名表（需报名学生会话，multipart）
 *   GET  /api/applications/me              查看自己的报名进度
 *   GET  /api/applications/invite/:token   打开邀请函（凭证即密权，无需登录）
 *   POST /api/applications/invite/:token   确认加入，写入成员表
 *   POST /api/applications/checkin         扫码签到（当前空实现：填姓名 + 学号即可）
 *
 * 身份由教务网登录后的 `kc_student` 会话背书 —— 学号与姓名一律取自会话，
 * 不接受客户端传入，避免有人替别人报名。**签到例外**：签到页是线下扫码打开的，
 * 同学手上不一定有登录态，所以按「姓名 + 学号与报名记录一致」放行（这是刻意的空实现）。
 */

import { RESOURCES, formatLimit } from '../../shared/resources'
import {
  APPLICATION_DOC_LIMIT,
  APPLICATION_DOC_SCOPE,
  applicationDocFileName,
  checkinEligibility,
  isApplyOpen,
  isCheckinTokenUsable,
  isInviteUsable,
  normalizeName,
  recruitNotice,
  recruitPhase,
  RECRUIT_STAGE_LABELS,
  sessionLabel,
  sessionsOfStage,
  sessionTimeText,
  validateApplicationForm,
  validateCheckin,
  type CheckinStage,
  type RecruitResult,
} from '../../shared/recruit'
import { cnTimeToText, isoToCnTime } from '../../shared/time'
import { MEMBER_ROLES, type Application } from '../../shared/types'
import {
  createApplication,
  getApplicationByInviteToken,
  getApplicationByStudentId,
  toStudentView,
  updateApplication,
} from '../lib/applications'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { getRecruitSettings } from '../lib/recruit-config'
import { getCheckinToken, getSession, listSessions, SESSION_FIELD } from '../lib/recruit-sessions'
import { createEntity, getSiteConfig, writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { deleteStoredFile, getStorage, storageReady } from '../lib/storage'
import { buildObjectKey, sniffDocument } from '../lib/uploads'

/** 签到时间写入哪一列 */
const CHECKIN_COLUMN: Record<CheckinStage, 'writtenCheckinAt' | 'interviewCheckinAt' | 'defenseCheckinAt'> = {
  written: 'writtenCheckinAt',
  interview: 'interviewCheckinAt',
  defense: 'defenseCheckinAt',
}

function identityOf(ctx: RequestContext): { studentId: string; name: string } | null {
  const student = ctx.student
  if (!student?.sub) return null
  return { studentId: student.sub, name: student.name ?? '' }
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

// ===== 公开：本届招新状态 =====

/**
 * 报名页要用到的全部时间信息。刻意不带邮件模板等内容 —— 那是管理端数据。
 * 与 bootstrap 一样可被短缓存（30 秒），招新状态变化本来就不频繁。
 */
export async function getRecruitStatus(ctx: RequestContext): Promise<Response> {
  const settings = await getRecruitSettings(ctx.env)
  const { cycle } = settings
  const phase = recruitPhase(cycle)

  return ok(
    {
      phase,
      name: cycle.name,
      applyStart: cycle.applyStart,
      applyEnd: cycle.applyEnd,
      applyStartText: cnTimeToText(cycle.applyStart),
      applyEndText: cnTimeToText(cycle.applyEnd),
      /** 报名通道是否开放 */
      applyOpen: isApplyOpen(cycle),
      /** 给「加入我们」页面的说明 */
      notice: recruitNotice(cycle),
    },
    { headers: { 'cache-control': 'public, max-age=30' } },
  )
}

// ===== 提交报名表 =====

export async function submitApplication(ctx: RequestContext): Promise<Response> {
  const me = identityOf(ctx)
  if (!me) return fail(401, 'UNAUTHENTICATED', '登录状态已失效，请重新用教务网账号登录')

  const settings = await getRecruitSettings(ctx.env)
  if (!isApplyOpen(settings.cycle)) {
    return fail(403, 'RECRUIT_CLOSED', recruitNotice(settings.cycle))
  }

  // 报名表目标桶在后台「对象存储」页单独配置，可与站点图片分属不同服务商
  if (!(await storageReady(ctx.env, 'applications'))) {
    return fail(503, 'STORAGE_UNAVAILABLE', '对象存储未接通，暂无法接收报名表')
  }
  const storage = await getStorage(ctx.env, 'applications')

  // 一位同学一条记录。已报过名不直接拒绝，而是要求**显式确认替换**：
  // 覆盖材料是不可逆的，不能因为表单多点了一下就把人家交上来的东西悄悄盖掉。
  // 替换窗口与报名通道同一条规则（isApplyOpen）—— 确认笔试名单后材料就锁死。
  const replace = ctx.url.searchParams.get('replace') === 'true'
  const existing = await getApplicationByStudentId(ctx.env, me.studentId)
  if (existing) {
    if (!replace) {
      const at = isoToCnTime(existing.createdAt) || '之前'
      return fail(
        409,
        'REPLACE_CONFIRM',
        `你在 ${at} 已提交过报名表${existing.fileName ? `（${existing.fileName}）` : ''}。再提交一次会替换掉原来的材料，请确认后再交`,
      )
    }
    // isApplyOpen 已经把「确认名单后」拦在前面，这里是双保险（万一有人手动把人推进了下一阶段）
    if (existing.stage !== 'apply') {
      return fail(409, 'MATERIAL_LOCKED', '笔试名单已确认，报名材料已锁定，无法替换；如确有需要请回复邮件联系我们')
    }
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

  // 只读文件头 16 字节做类型判定，整份内容以 Blob 直接交给对象存储
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const kind = sniffDocument(head, filename)
  if (!kind) {
    return fail(415, 'UNSUPPORTED_TYPE', '文件校验失败：仅支持 PDF / DOCX 格式的真实文件，仅改后缀无效')
  }

  const key = buildObjectKey(APPLICATION_DOC_SCOPE, filename || 'application', kind.ext)
  await storage.put(key, file, { contentType: kind.mime })

  /** 新材料共用的字段（新建与替换同一套） */
  const docFields = {
    email: input.email.trim(),
    phone: input.phone.trim(),
    qq: input.qq.trim(),
    fileUrl: storage.objectUrl(key),
    // 统一重命名为「姓名+学号+报名表」，同学原来的「简历(1).pdf」一律不用
    fileName: applicationDocFileName(me.name, me.studentId, kind.ext),
    fileSize: file.size,
  }

  let record
  try {
    if (existing && replace) {
      const updated = await updateApplication(ctx.env, existing.id, docFields)
      if (!updated) throw new Error('替换后读取失败')
      record = updated
    } else {
      record = await createApplication(ctx.env, {
        studentId: me.studentId,
        name: me.name,
        ...docFields,
      })
    }
  } catch (error) {
    // 落库失败只删**新**文件：替换场景下旧材料还在，不会因为一次失败就两头空
    await storage.delete(key).catch(() => {})
    if (!existing && (await getApplicationByStudentId(ctx.env, me.studentId))) {
      return fail(409, 'REPLACE_CONFIRM', '你已经提交过报名表，再提交一次会替换掉原来的材料')
    }
    console.error('[applications] 报名落库失败', { studentId: me.studentId, replace, error })
    return fail(500, 'CREATE_FAILED', '报名表保存失败，请稍后重试')
  }

  // **替换成功之后**才删旧文件 —— 顺序反了的话，一次失败就会把旧材料弄丢
  if (existing && replace && existing.fileUrl) {
    await deleteStoredFile(ctx.env, existing.fileUrl)
  }

  await writeAudit(ctx.env, {
    actor: `student:${me.studentId}`,
    action: existing && replace ? 'replace_application' : 'apply',
    resource: 'applications',
    targetId: record.id,
    detail: `${record.name} ${kind.ext} ${(file.size / 1024).toFixed(1)}KB${existing && replace ? '（替换旧材料）' : ''}`,
    ...requestMeta(ctx),
  })

  return ok(toStudentView(record), { status: existing && replace ? 200 : 201 })
}

// ===== 我的报名进度 =====

export async function myApplication(ctx: RequestContext): Promise<Response> {
  const me = identityOf(ctx)
  if (!me) return fail(401, 'UNAUTHENTICATED', '未登录')

  const [settings, record] = await Promise.all([
    getRecruitSettings(ctx.env),
    getApplicationByStudentId(ctx.env, me.studentId),
  ])

  const cycle = settings.cycle
  const base = {
    phase: recruitPhase(cycle),
    cycleName: cycle.name,
    notice: recruitNotice(cycle),
    /** 各阶段的安排时间，进度页上要展示给同学 */
    schedule: {
      writtenAt: cnTimeToText(cycle.writtenAt),
      writtenPlace: cycle.writtenPlace,
      interviewAt: cnTimeToText(cycle.interviewAt),
      interviewPlace: cycle.interviewPlace,
      defenseStart: cnTimeToText(cycle.defenseStart),
      defenseEnd: cnTimeToText(cycle.defenseEnd),
      onboardDeadline: cnTimeToText(cycle.onboardDeadline),
    },
  }

  if (!record) {
    return ok({ ...base, application: null }, { headers: { 'cache-control': 'no-store' } })
  }

  // 已发出邀请函时顺带把确认页地址给他 —— 同学常常翻不到那封邮件，
  // 而这是他本人的记录，本人看自己的邀请链接没有额外暴露。
  const inviteUrl = isInviteUsable(record.inviteExpiresAt, record.stage, record.result)
    ? `/invite/${record.inviteToken}`
    : ''

  return ok(
    { ...base, application: toStudentView(record) as Application, inviteUrl },
    { headers: { 'cache-control': 'no-store' } },
  )
}

// ===== 邀请函 =====

export async function getInvite(ctx: RequestContext): Promise<Response> {
  const record = await getApplicationByInviteToken(ctx.env, ctx.params.token)
  if (!record) return fail(404, 'INVITE_NOT_FOUND', '邀请链接无效，请确认是否复制完整')

  if (record.stage === 'onboard' && record.result === 'passed') {
    return ok({
      alreadyMember: true,
      name: record.name,
      studentId: record.studentId,
      confirmedAt: record.confirmedAt,
    })
  }

  if (record.stage !== 'onboard' || record.result !== '') {
    return fail(409, 'INVITE_NOT_ACTIVE', '这份邀请函当前不可用，请联系工作室确认')
  }

  if (!isInviteUsable(record.inviteExpiresAt, record.stage, record.result)) {
    return fail(410, 'INVITE_EXPIRED', '邀请链接已过期，请回复邮件联系我们重新发送')
  }

  const settings = await getRecruitSettings(ctx.env)
  return ok(
    {
      alreadyMember: false,
      name: record.name,
      studentId: record.studentId,
      email: record.email,
      expiresAt: record.inviteExpiresAt,
      roleOptions: MEMBER_ROLES,
      joinYear: String(new Date().getFullYear()),
      cycleName: settings.cycle.name,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

interface ConfirmInviteBody {
  title?: string
  nameEn?: string
  direction?: string
  bio?: string
  email?: string
}

export async function confirmInvite(ctx: RequestContext): Promise<Response> {
  const record = await getApplicationByInviteToken(ctx.env, ctx.params.token)
  if (!record) return fail(404, 'INVITE_NOT_FOUND', '邀请链接无效，请确认是否复制完整')

  if (record.stage === 'onboard' && record.result === 'passed') {
    return fail(409, 'ALREADY_MEMBER', '你已确认加入，无需重复提交')
  }
  if (record.stage !== 'onboard' || record.result !== '') {
    return fail(409, 'INVITE_NOT_ACTIVE', '这份邀请函当前不可用，请联系工作室确认')
  }
  if (!isInviteUsable(record.inviteExpiresAt, record.stage, record.result)) {
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

  // 写入成员表：姓名 / 学号沿用报名时的身份，加入年份取当前年份
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
    stage: 'onboard',
    result: 'passed',
    memberId: String(member.id),
    confirmedAt: now.toISOString(),
    stageChangedAt: now.toISOString(),
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

// ===== 扫码签到（凭证即密权：token 绑场次 + 带失效时间） =====

interface CheckinBody {
  name?: string
  studentId?: string
}

/** 凭证 → 场次。凭证无效、过期、已作废、场次已删，统一返回 null 由调用方按「无效」回应 */
async function resolveCheckinTarget(
  ctx: RequestContext,
): Promise<{ stage: CheckinStage; sessionId: string; label: string; timeText: string } | null> {
  const record = await getCheckinToken(ctx.env, ctx.params.token ?? '')
  if (!record || !isCheckinTokenUsable(record.expiresAt, record.revokedAt)) return null

  const session = await getSession(ctx.env, record.sessionId)
  if (!session) return null

  // 场次名没填时按阶段内的序号兜底，所以要把同阶段的场次都取来定位自己
  const siblings = sessionsOfStage(await listSessions(ctx.env), session.stage)
  const index = Math.max(0, siblings.findIndex((item) => item.id === session.id))
  return {
    stage: session.stage,
    sessionId: session.id,
    label: sessionLabel(session, index),
    timeText: sessionTimeText(session),
  }
}

/**
 * 签到页提交的入口。
 *
 * 不要求登录态：同学在线下扫二维码进来，手上不一定有会话。
 * 凭证就是二维码里的 token（绑场次 + 带失效时间），再要求「姓名 + 学号」与报名记录一致。
 */
export async function checkin(ctx: RequestContext): Promise<Response> {
  const target = await resolveCheckinTarget(ctx)
  if (!target) {
    return fail(404, 'CHECKIN_TOKEN_INVALID', '这个签到二维码不存在、已失效或已被作废，请找现场工作人员确认')
  }
  const stage = target.stage

  const body = await readJsonBody<CheckinBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const invalid = validateCheckin(body)
  if (invalid) return fail(400, 'VALIDATION_FAILED', invalid)

  const studentId = String(body.studentId ?? '').trim()
  const name = String(body.name ?? '').trim()

  const record = await getApplicationByStudentId(ctx.env, studentId)
  if (!record) {
    return fail(404, 'NOT_FOUND', '没有找到你的报名记录，请核对姓名与学号，或联系工作人员')
  }
  if (normalizeName(record.name) !== normalizeName(name)) {
    return fail(403, 'NAME_MISMATCH', '姓名与报名记录不一致，请核对后重试')
  }

  const eligibility = checkinEligibility(record.stage, record.result, stage)
  if (eligibility === 'closed') {
    return fail(409, 'RECRUIT_FINISHED', '你的报名流程已经结束，无需签到；如需确认请联系工作人员')
  }
  if (eligibility === 'behind') {
    return fail(409, 'STAGE_PASSED', '你已经进入后面的环节了，这个签到码不用再扫')
  }

  const column = CHECKIN_COLUMN[stage]
  if (record[column]) {
    return ok({
      already: true,
      name: record.name,
      stage,
      at: record[column],
      sessionId: record[SESSION_FIELD[stage]],
      sessionLabel: target.label,
    })
  }

  const now = new Date().toISOString()
  // 签到即代表「来了」：阶段推进到当前环节、结果记为「已参加」（尚未出结果），
  // 同时记下「签的是哪一场」，后台才能按场次统计到场人数。
  // 也覆盖「后台还没来得及把人推进到笔试就先开考了」的情况（eligibility = ahead）。
  await updateApplication(ctx.env, record.id, {
    [column]: now,
    [SESSION_FIELD[stage]]: target.sessionId,
    stage,
    result: 'attended' as RecruitResult,
    stageChangedAt: now,
  })

  await writeAudit(ctx.env, {
    actor: `checkin:${record.studentId}`,
    action: `checkin_${stage}`,
    resource: 'applications',
    targetId: record.id,
    detail: `${record.name}（${record.studentId}）${record.stage} → ${stage} · ${target.label}`,
    ...requestMeta(ctx),
  })

  return ok({
    already: false,
    name: record.name,
    stage,
    at: now,
    sessionId: target.sessionId,
    sessionLabel: target.label,
  })
}

/**
 * 签到页自己要渲染的文案（阶段名、场次时间地点都写在页面上）。
 * 凭证无效时不返回任何信息 —— 页面只显示「二维码无效」，不泄露「这里有场考试」。
 */
export async function getCheckinInfo(ctx: RequestContext): Promise<Response> {
  const target = await resolveCheckinTarget(ctx)
  if (!target) {
    return fail(404, 'CHECKIN_TOKEN_INVALID', '这个签到二维码不存在、已失效或已被作废')
  }

  const [settings, site] = await Promise.all([
    getRecruitSettings(ctx.env),
    getSiteConfig(ctx.env),
  ])

  return ok(
    {
      stage: target.stage,
      stageLabel: RECRUIT_STAGE_LABELS[target.stage],
      sessionId: target.sessionId,
      sessionLabel: target.label,
      sessionTime: target.timeText,
      cycleName: settings.cycle.name,
      studioName: site.studioName,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
