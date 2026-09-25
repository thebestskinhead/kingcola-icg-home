import { useCallback, useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  adminGetRecruitBoard,
  adminPreviewRecruitAuto,
  adminRunRecruitAuto,
  type RunRecruitAutoResult,
} from '@/api/endpoints'
import { ApiError } from '@/api/client'
import {
  applicationLabel,
  RECRUIT_AUTO_META,
  RECRUIT_AUTO_TASKS,
  RECRUIT_MAIL_META,
  type RecruitAutoPreview,
  type RecruitAutoTask,
} from '@shared/recruit'
import { cn } from '@/lib/utils'
import { AlertTriangle, Loader2, Play, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { RecruitOpsGuard, RecruitTabs } from './RecruitTabs'
import { useRecruitSettings } from './useRecruitSettings'

/**
 * 自动流程：招新期唯一需要盯的一页。
 *
 * 每个任务都是「先算名单给你看，确认后再执行」—— 邮件发出去收不回来，
 * 尤其是「录取/答辩」这种会把没勾选的人自动判为未通过的批量动作。
 */
export function AutoPage() {
  const { settings, loading, reload } = useRecruitSettings()
  const [task, setTask] = useState<RecruitAutoTask>('mark_absent')
  const [preview, setPreview] = useState<RecruitAutoPreview | null>(null)
  const [pending, setPending] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [confirmRun, setConfirmRun] = useState(false)
  const [lastRun, setLastRun] = useState<RunRecruitAutoResult | null>(null)

  const meta = RECRUIT_AUTO_META[task]
  const needsSelection = meta.needsSelection

  const loadPreview = useCallback(
    async (nextTask: RecruitAutoTask, ids: string[]) => {
      setBusy(true)
      try {
        setPreview(await adminPreviewRecruitAuto(nextTask, ids))
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : '预览失败')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const loadCounts = useCallback(async () => {
    try {
      const board = await adminGetRecruitBoard()
      setPending(board.pending)
    } catch {
      // 计数失败不影响主体功能
    }
  }, [])

  useEffect(() => {
    void loadCounts()
  }, [loadCounts])

  useEffect(() => {
    setSelected(new Set())
    setLastRun(null)
    void loadPreview(task, [])
  }, [task, loadPreview])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 勾选变化后重新预览：谁通过、谁收到感谢信会立刻跟着变 */
  const refresh = () => void loadPreview(task, [...selected])

  const run = async (force = false) => {
    setConfirmRun(false)
    setRunning(true)
    try {
      const result = await adminRunRecruitAuto({ task, selectedIds: [...selected], force })
      setLastRun(result)
      const parts = [`改动 ${result.moved} 条记录`]
      if (result.mail.summary) parts.push(result.mail.summary)
      if (result.archive) parts.push(`已归档 ${result.archive.total} 条名单存档`)
      toast.success(`${meta.label}已执行`, { description: parts.join('；') })
      await loadPreview(task, [])
      await loadCounts()
      setSelected(new Set())
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '执行失败')
    } finally {
      setRunning(false)
    }
  }

  const blocked = preview?.blocked ?? ''

  return (
    <div className="mx-auto max-w-5xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reload} />

      <RecruitOpsGuard settings={settings} loading={loading}>
        <div className="mb-5">
          <h1 className="font-display text-2xl font-bold">自动流程</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            先看名单再执行；「标记缺考」与「关闭本届」每天还会由定时任务兜底跑一次。
          </p>
        </div>

        {/* 任务卡片 */}
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RECRUIT_AUTO_TASKS.map((value) => {
            const count = pending[value] ?? 0
            const isActive = value === task
            return (
              <button
                key={value}
                onClick={() => setTask(value)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-left transition-colors',
                  isActive
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-card hover:bg-secondary/60',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{RECRUIT_AUTO_META[value].label}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs',
                      count > 0 ? 'bg-accent/15 text-accent' : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {RECRUIT_AUTO_META[value].description}
                </p>
              </button>
            )
          })}
        </div>

        {/* 预览 */}
        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">{meta.label}</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {busy ? '正在计算…' : `将处理 ${preview?.summary.total ?? 0} 人，其中 ${preview?.summary.mailed ?? 0} 人会收到邮件`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
                <RotateCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} /> 重新计算
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={running || busy || (!needsSelection && !preview) || (preview?.summary.total ?? 0) === 0}
                onClick={() => setConfirmRun(true)}
              >
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                执行
              </Button>
            </div>
          </div>

          {blocked && (
            <div className="flex items-start gap-2 border-b border-border bg-amber-500/5 px-5 py-3 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{blocked}</span>
            </div>
          )}

          <div className="max-h-[28rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {needsSelection && <TableHead className="w-12">录取</TableHead>}
                  <TableHead className="w-44">报名人</TableHead>
                  <TableHead className="w-32">执行后状态</TableHead>
                  <TableHead className="w-32">邮件</TableHead>
                  <TableHead>说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(preview?.items ?? []).map((item) => (
                  <TableRow key={item.applicationId}>
                    {needsSelection && (
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[hsl(var(--accent))]"
                          checked={selected.has(item.applicationId)}
                          onChange={() => toggle(item.applicationId)}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="text-sm">{item.name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{item.studentId}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {applicationLabel(item.targetStage, item.targetResult)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.mail ? RECRUIT_MAIL_META[item.mail].label : <span className="text-muted-foreground">不发</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.reason}</TableCell>
                  </TableRow>
                ))}
                {(preview?.items.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                      {busy ? '正在计算…' : '没有需要处理的同学'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {needsSelection && (
            <div className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
              勾选 = 录取 / 通过；<strong className="text-foreground">未勾选的同学会被判为未通过并立即收到感谢信</strong>
              ，所以请核对完名单再执行。已勾选 {selected.size} 人。
            </div>
          )}
        </section>

        {/* 上次执行结果 */}
        {lastRun && (
          <section className="mt-5 rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">上次执行结果</h2>
            <p className="text-xs text-muted-foreground">
              改动 {lastRun.moved} 条 · {lastRun.mail.summary || '未发信'}
              {lastRun.archive && ` · 存档：${lastRun.archive.url || '未生成'}`}
            </p>
            {lastRun.mail.results.some((item) => !item.sent) && (
              <div className="mt-3 space-y-1">
                {lastRun.mail.results
                  .filter((item) => !item.sent)
                  .slice(0, 10)
                  .map((item) => (
                    <p key={item.to + item.code} className="text-[11px] text-destructive">
                      {item.to || '(无邮箱)'}：{item.code} —— {item.message}
                    </p>
                  ))}
              </div>
            )}
            {lastRun.task === 'close_cycle' && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                本届已关闭，报名数据已清空；存档可在「周期与签到」里下载。
              </p>
            )}
          </section>
        )}
      </RecruitOpsGuard>

      <AlertDialog open={confirmRun} onOpenChange={setConfirmRun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认执行「{meta.label}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将处理 {preview?.summary.total ?? 0} 人，其中 {preview?.summary.mailed ?? 0} 人会收到邮件。
              {task === 'close_cycle'
                ? '关闭会先导出名单存档，然后清空报名数据与报名表文件，且无法撤销。'
                : '邮件发出后无法撤回，请确认名单与文案无误。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            {/* 关闭本届勾了「立即关闭」：手动点击本身就是要绕过截止时间的意图 */}
            <AlertDialogAction onClick={() => void run(task === 'close_cycle')}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
