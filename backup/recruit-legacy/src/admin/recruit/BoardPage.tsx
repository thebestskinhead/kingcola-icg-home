import { useCallback, useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import { Button } from '@/components/ui/button'
import { adminGetRecruitBoard } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import {
  applicationLabel,
  RECRUIT_AUTO_META,
  RECRUIT_AUTO_TASKS,
  RECRUIT_PHASE_LABELS,
  RECRUIT_STAGES,
  RECRUIT_STAGE_LABELS,
  type RecruitBoard,
  type RecruitStage,
} from '@shared/recruit'
import { cn } from '@/lib/utils'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { RecruitTabs } from './RecruitTabs'
import { RECRUIT_TASK_PAGE } from './recruit-pages'
import { useRecruitSettings } from './useRecruitSettings'

const FUNNEL_TONE: Record<RecruitStage, string> = {
  apply: 'bg-secondary',
  written: 'bg-sky-500/15',
  interview: 'bg-indigo-500/15',
  defense: 'bg-amber-500/15',
  onboard: 'bg-emerald-500/15',
}

/** 招新看板：一眼看清进度与待办，招新期打开后台先看这一页。 */
export function BoardPage() {
  const { settings, loading, reload } = useRecruitSettings()
  const [board, setBoard] = useState<RecruitBoard | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setBoard(await adminGetRecruitBoard())
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '看板加载失败')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const max = board ? Math.max(1, ...RECRUIT_STAGES.map((stage) => board.funnel[stage])) : 1

  return (
    <div className="mx-auto max-w-5xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reload} />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">招新看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {board?.cycleName || '本届'} · {RECRUIT_PHASE_LABELS[board?.phase ?? 'not_configured']} · 共{' '}
            {board?.total ?? 0} 人报名，{board?.members ?? 0} 人已确认加入
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} title="刷新">
          <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
        </Button>
      </div>

      {!board ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">各环节在池人数（未淘汰、未结束）</h2>
            <div className="space-y-2.5">
              {RECRUIT_STAGES.map((stage) => {
                const value = board.funnel[stage]
                const percent = Math.round((value / max) * 100)
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-xs text-muted-foreground">
                      {RECRUIT_STAGE_LABELS[stage]}
                    </span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-secondary/60">
                      <div
                        className={cn('flex h-full items-center px-2 text-xs', FUNNEL_TONE[stage])}
                        style={{ width: `${Math.max(percent, value > 0 ? 8 : 0)}%` }}
                      >
                        {value > 0 ? value : ''}
                      </div>
                    </div>
                    <span className="w-8 shrink-0 text-right text-xs font-medium">{value}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">待处理事项</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {RECRUIT_AUTO_TASKS.map((task) => {
                const count = board.pending[task] ?? 0
                return (
                  <NavLink
                    key={task}
                    // 每个任务只属于一个阶段，待办卡直接跳到那个阶段页（操作卡就在页面里）
                    to={RECRUIT_TASK_PAGE[task]}
                    className={cn(
                      'flex items-start justify-between gap-3 rounded-lg border px-4 py-3 transition-colors',
                      count > 0
                        ? 'border-accent/40 bg-accent/5 hover:bg-accent/10'
                        : 'border-border hover:bg-secondary/60',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{RECRUIT_AUTO_META[task].label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {RECRUIT_AUTO_META[task].description}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-0.5 text-xs',
                        count > 0 ? 'bg-accent/15 text-accent' : 'bg-secondary text-muted-foreground',
                      )}
                    >
                      {count}
                    </span>
                  </NavLink>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">状态细分</h2>
            {Object.keys(board.byLabel).length === 0 ? (
              <p className="text-xs text-muted-foreground">还没有报名记录。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(board.byLabel)
                  .sort((a, b) => b[1] - a[1])
                  .map(([label, count]) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs"
                    >
                      {label}
                      <span className="font-medium">{count}</span>
                    </span>
                  ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              状态由「阶段 + 该阶段结果」两列派生，例如「{applicationLabel('written', 'passed')}」与「
              {applicationLabel('written', '')}」是两个不同的组合。
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
