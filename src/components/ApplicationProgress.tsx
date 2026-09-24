import {
  APPLICATION_STAGES,
  APPLICATION_STAGE_LABELS,
  APPLICATION_STATUS_META,
  applicationStageIndex,
  applicationToneOf,
} from '@shared/recruit'
import type { Application } from '@shared/types'
import { cn } from '@/lib/utils'
import { ArrowRight, Check, CircleDot, Clock, X } from 'lucide-react'

/** `2026-09-28T14:00` 或 ISO 串 → 「2026-09-28 14:00」 */
function formatMoment(value: string): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(
    parsed.getHours(),
  )}:${pad(parsed.getMinutes())}`
}

const TONE_STYLES: Record<string, string> = {
  pending: 'bg-secondary text-foreground',
  active: 'bg-accent/15 text-accent',
  passed: 'bg-emerald-500/10 text-emerald-700',
  done: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-destructive/10 text-destructive',
}

/**
 * 报名进度：五段式进度条 + 当前状态 + 时间线。
 * 状态的中文名与阶段划分全部来自 `@shared/recruit`，前台不重复维护一份。
 */
export function ApplicationProgress({
  application,
  inviteUrl,
}: {
  application: Application
  /** 已发出邀请函时的确认页地址 */
  inviteUrl?: string
}) {
  const meta = APPLICATION_STATUS_META[application.status]
  const tone = applicationToneOf(application.status)
  const currentStage = applicationStageIndex(application.status)
  const failed = tone === 'failed'

  const timeline = [
    { label: '提交报名', value: application.createdAt ?? '' },
    { label: '笔试安排', value: application.writtenAt },
    { label: '面试安排', value: application.interviewAt },
    { label: '邀请函发出', value: application.invitedAt },
    { label: '确认加入', value: application.confirmedAt },
  ].filter((item) => item.value.trim())

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">我的报名进度</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700">
          <Check className="h-3.5 w-3.5" /> 已登录
        </span>
      </div>

      {/* 当前状态 */}
      <div className="mt-5 rounded-2xl border border-border bg-secondary/40 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              TONE_STYLES[tone] ?? TONE_STYLES.pending,
            )}
          >
            {failed ? <X className="h-3.5 w-3.5" /> : <CircleDot className="h-3.5 w-3.5" />}
            {meta.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {application.name} · {application.studentId}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-foreground/80">{meta.hint}</p>
      </div>

      {/* 五段进度 */}
      <ol className="mt-6 space-y-0">
        {APPLICATION_STAGES.map((stage, index) => {
          const stepFailed = failed && index === currentStage
          const done = index < currentStage || (index === currentStage && tone === 'passed')
          const current = index === currentStage
          return (
            <li
              key={stage}
              className="grid grid-cols-[1.75rem_1fr] items-center gap-3 border-t border-border py-3 last:border-b"
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium',
                  stepFailed
                    ? 'bg-destructive/10 text-destructive'
                    : done
                      ? 'bg-emerald-500/15 text-emerald-700'
                      : current
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-secondary text-muted-foreground',
                )}
              >
                {stepFailed ? <X className="h-3.5 w-3.5" /> : done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'text-sm',
                  current ? 'font-medium' : done ? 'text-foreground/75' : 'text-muted-foreground',
                )}
              >
                {APPLICATION_STAGE_LABELS[stage]}
              </span>
            </li>
          )
        })}
      </ol>

      {/* 时间线 */}
      {timeline.length > 0 && (
        <div className="mt-6 space-y-2 text-xs text-muted-foreground">
          {timeline.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="w-20 shrink-0">{item.label}</span>
              <span className="text-foreground/75">{formatMoment(item.value)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 邀请函入口 */}
      {inviteUrl && (
        <a
          href={inviteUrl}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
        >
          填写成员信息并确认加入 <ArrowRight className="h-4 w-4" />
        </a>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {tone === 'failed'
          ? '本次招新到这里就结束了。感谢你的参与，欢迎关注我们后续的公开活动。'
          : '进度会随笔试、面试、预备期的推进自动更新，重要的安排会同时发到你的邮箱。'}
      </p>
    </div>
  )
}
