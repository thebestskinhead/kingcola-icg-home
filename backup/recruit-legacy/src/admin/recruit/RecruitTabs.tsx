import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { Button } from '@/components/ui/button'
import type { AdminRecruitSettings } from '@/api/endpoints'
import { RECRUIT_PHASE_LABELS, type RecruitPhase } from '@shared/recruit'
import { cn } from '@/lib/utils'
import { AlertTriangle, CalendarCog, Loader2 } from 'lucide-react'
import { RECRUIT_TABS } from './recruit-pages'

const PHASE_TONE: Record<RecruitPhase, string> = {
  not_configured: 'bg-amber-500/10 text-amber-700',
  upcoming: 'bg-secondary text-foreground',
  applying: 'bg-emerald-500/10 text-emerald-700',
  in_progress: 'bg-accent/15 text-accent',
  closed: 'bg-secondary text-muted-foreground',
}

/** 页签栏 + 阶段徽章 */
export function RecruitTabs({
  settings,
  loading,
  onReload,
}: {
  settings: AdminRecruitSettings | null
  loading?: boolean
  onReload?: () => void
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <nav className="flex flex-wrap gap-1.5">
        {RECRUIT_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                isActive
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border text-foreground/70 hover:bg-secondary hover:text-foreground',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {settings && (
          <span className={cn('rounded-full px-3 py-1 text-xs', PHASE_TONE[settings.phase])}>
            {settings.cycle.name || '未命名招新'} · {RECRUIT_PHASE_LABELS[settings.phase]}
          </span>
        )}
        {onReload && (
          <Button variant="ghost" size="sm" onClick={onReload} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '刷新'}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * 招生期才开放的页面守卫。
 * 非招新期（未开始 / 已结束）不展示空表格，而是明确告诉他去「准备」里配时间窗。
 */
export function RecruitOpsGuard({
  settings,
  loading,
  children,
}: {
  settings: AdminRecruitSettings | null
  loading: boolean
  children: ReactNode
}) {
  if (loading || !settings) {
    return (
      <div className="flex flex-col items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="mt-3 text-sm text-muted-foreground">正在读取招新配置…</p>
      </div>
    )
  }

  if (!settings.moduleOpen) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-card px-6 py-14 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <h2 className="mt-4 font-display text-xl font-bold">
          {settings.phase === 'closed' ? '本届招新已结束' : '本届招新尚未开始'}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{settings.notice}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {settings.phase === 'closed'
            ? '报名数据已在关闭时归档并清空。'
            : '把报名开始与截止时间填好，到点会自动开启报名通道。'}
        </p>
        <NavLink
          to="/admin/recruit/prepare"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-85"
        >
          <CalendarCog className="h-4 w-4" /> 去准备招新周期
        </NavLink>
      </div>
    )
  }

  return <>{children}</>
}
