/**
 * 招新流程的通知邮件：笔试邀请、面试邀请、邀请函、感谢信。
 *
 * 只负责「组装 MIME 文本 + 调 mailer」，不含任何传输细节 ——
 * `lib/mailer.ts` 目前是空实现（永远返回 `NOT_IMPLEMENTED`），
 * 所以这一层现在的作用是：**把触发时机、收件人、文案全部定型**，
 * 等 SMTP 真正落地时不用改任何调用点。
 *
 * 触发规则集中在 shared/recruit.ts 的 `noticeForStatus()`，本文件只管怎么写。
 */

import type { SmtpConfig } from '../../shared/mail'
import { APPLICATION_NOTICE_META, APPLICATION_INVITE_TTL_HOURS, type ApplicationNoticeKind } from '../../shared/recruit'
import { invitePath, type SiteConfig } from '../../shared/types'
import type { Env } from '../env'
import type { ApplicationRecord } from './applications'
import { isMailConfigured, sendMail } from './mailer'

export interface NoticeContext {
  /** 站点配置：工作室名、联系邮箱等都会进正文 */
  studio: SiteConfig
  /** 站点原始地址（用于拼邀请函链接），形如 https://example.com */
  origin: string
}

export interface BuiltNotice {
  kind: ApplicationNoticeKind
  to: string
  subject: string
  text: string
}

/** `2026-09-28T14:00` 或 ISO 字符串 → 「2026 年 9 月 28 日 14:00」；空值返回空串 */
export function formatWhen(value: string): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日 ${pad(
    parsed.getHours(),
  )}:${pad(parsed.getMinutes())}`
}

function signature(studio: SiteConfig): string {
  const lines = [studio.studioName]
  if (studio.contactEmail.trim()) lines.push(studio.contactEmail.trim())
  if (studio.contactAddress.trim()) lines.push(studio.contactAddress.trim())
  return lines.join('\n')
}

function greeting(record: ApplicationRecord): string {
  return `${record.name || '同学'} 同学：`
}

/** 邀请函链接（收件人凭它一次性确认加入） */
export function buildInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${invitePath(token)}`
}

/**
 * 组装一封信。返回 null 表示「没有收件邮箱」这类无法发送的情况，
 * 调用方据此给出「该同学没填邮箱」的明确提示。
 */
export function buildApplicationNotice(
  record: ApplicationRecord,
  kind: ApplicationNoticeKind,
  ctx: NoticeContext,
): BuiltNotice | null {
  const to = record.email.trim()
  if (!to) return null

  const studio = ctx.studio.studioName
  const when = formatWhen(record.writtenAt)
  const interviewWhen = formatWhen(record.interviewAt)
  const sign = signature(ctx.studio)

  const parts: string[] = [greeting(record), '']

  switch (kind) {
    case 'written_invite': {
      parts.push(
        `你好！感谢你报名 ${studio}，你的报名表我们已经收到并通过初筛。`,
        '现邀请你参加招新笔试，安排如下：',
        '',
        `笔试时间：${when || '待定，确定后我们会再次通知你'}`,
        `笔试形式 / 地点：${record.writtenNote.trim() || '详见后续通知'}`,
        '',
        '请提前 10 分钟到达（线上笔试请提前登录）。如需调整时间，直接回复本邮件即可。',
      )
      break
    }
    case 'interview_invite': {
      parts.push(
        '恭喜你通过了笔试！接下来是与我们面对面的环节。',
        '',
        `面试时间：${interviewWhen || '待定，确定后我们会再次通知你'}`,
        `面试地点 / 形式：${record.interviewNote.trim() || '详见后续通知'}`,
        '',
        '请在约定时间前 5 分钟到达。如需调整时间，直接回复本邮件即可。',
      )
      break
    }
    case 'offer': {
      const days = Math.round(APPLICATION_INVITE_TTL_HOURS / 24)
      parts.push(
        '恭喜你！经过笔试、面试与预备期的考核，我们决定正式邀请你加入我们。',
        '',
        '请点击下面的专属链接，填写你的成员信息并确认加入：',
        buildInviteUrl(ctx.origin, record.inviteToken),
        '',
        `链接 ${days} 天内有效，仅可使用一次；确认后你的信息会立即出现在官网「团队成员」页面。`,
        '如果链接失效，或者你对加入有任何疑问，直接回复本邮件即可。',
      )
      break
    }
    case 'thanks_written': {
      parts.push(
        `你好。感谢你报名 ${studio}，并认真完成了这一轮笔试。`,
        '',
        '很遗憾，本次笔试你没能进入下一轮。招新名额有限，这个结果并不代表对你的评价。',
        '我们后续的技术分享与公开活动依旧欢迎你参加，也欢迎下一轮招新再次报名。',
        '',
        '祝你学习顺利。',
      )
      break
    }
    case 'thanks_interview': {
      parts.push(
        `你好。感谢你报名 ${studio}，并抽出时间参加面试。`,
        '',
        '很遗憾，本次面试你没能进入预备期。名额有限，这个结果并不代表对你的评价。',
        '欢迎关注我们后续的公开活动，也欢迎下一轮招新再次报名。',
        '',
        '祝你学习顺利。',
      )
      break
    }
    case 'thanks_probation': {
      parts.push(
        `你好。感谢你在 ${studio} 预备期里的投入与付出。`,
        '',
        '很遗憾，本次预备期答辩你没能通过。这个结果并不代表对你的评价，',
        '希望这段时间的项目经历对你之后的成长有所帮助。',
        '',
        '祝你学习顺利，也欢迎之后继续与我们保持联系。',
      )
      break
    }
  }

  parts.push('', sign)

  const subjects: Record<ApplicationNoticeKind, string> = {
    written_invite: `【${studio}】笔试邀请`,
    interview_invite: `【${studio}】面试邀请`,
    offer: `【${studio}】正式邀请函 · 请确认加入`,
    thanks_written: `【${studio}】感谢你参加本次笔试`,
    thanks_interview: `【${studio}】感谢你参加本次面试`,
    thanks_probation: `【${studio}】感谢你在预备期的付出`,
  }

  return {
    kind,
    to,
    subject: `${subjects[kind]} · ${record.name || record.studentId}`,
    text: parts.join('\n'),
  }
}

export interface SendNoticeResult {
  kind: ApplicationNoticeKind
  /** 邮件服务是否真的收下了这封信 */
  sent: boolean
  /** 失败原因码：NO_RECIPIENT / NOT_CONFIGURED / NOT_IMPLEMENTED / … */
  code: string
  message: string
  to: string
}

/**
 * 发一封信。**任何失败都只返回结果、不抛异常** —— 状态流转不能被邮件拖垮：
 * 邮件没发出去，管理员在后台会看到明确的失败原因，重发即可。
 */
export async function sendApplicationNotice(
  env: Env,
  config: SmtpConfig,
  record: ApplicationRecord,
  kind: ApplicationNoticeKind,
  ctx: NoticeContext,
): Promise<SendNoticeResult> {
  const built = buildApplicationNotice(record, kind, ctx)
  if (!built) {
    return {
      kind,
      sent: false,
      code: 'NO_RECIPIENT',
      message: '该报名记录没有邮箱，无法发送邮件',
      to: '',
    }
  }

  if (!isMailConfigured(env, config)) {
    return {
      kind,
      sent: false,
      code: 'NOT_CONFIGURED',
      message: '邮件通道未接通（系统设置 → 邮件），本封信未发送',
      to: built.to,
    }
  }

  const result = await sendMail(env, config, {
    to: built.to,
    subject: built.subject,
    text: built.text,
    replyTo: ctx.studio.contactEmail.trim() || undefined,
  })

  if (!result.ok) {
    return {
      kind,
      sent: false,
      code: result.code,
      message: `${APPLICATION_NOTICE_META[kind].label}发送失败：${result.message}`,
      to: built.to,
    }
  }

  return {
    kind,
    sent: true,
    code: 'OK',
    message: `${APPLICATION_NOTICE_META[kind].label}已发送至 ${built.to}`,
    to: built.to,
  }
}
