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
  adminPreviewRecruitAuto,
  adminRunRecruitAuto,
  type RunRecruitAutoResult,
} from '@/api/endpoints'
import { ApiError } from '@/api/client'
import {
  applicationLabel,
  RECRUIT_AUTO_META,
  RECRUIT_MAIL_META,
  type RecruitAutoPreview,
  type RecruitAutoTask,
} from '@shared/recruit'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { OperationCard } from './StageKit'

/**
 * 把某个自动流程任务做成一张**内嵌在阶段页里的操作卡**。
 *
 * 逻辑与原来的「自动流程」页完全一致，只是不再单独开一页：
 * 先算名单给你看（谁变成什么状态、会收到哪封信、为什么这样处理），确认后再执行。
 * 邮件发出去收不回来，尤其「录取 / 答辩」这类会把未勾选者判为未通过的动作。
 *
 * 不能执行时（例如还没到时间、没有可处理的人）由服务端给出 `preview.blocked`，
 * 卡片会折叠并显示这句原因 —— 前端不另算一套判断，避免两边说得不一样。
 */
export function AutoTaskCard({
  task,
  onDone,
  extraHint,
}: {
  task: RecruitAutoTask
  /** 执行成功后的回调（通常是刷新本页的数据区） */
  onDone?: () => void
  /** 卡片底部的额外提示，用于补位「下一步去哪」这类页面级说明 */
  extraHint?: string
}) {
  const meta = RECRUIT_AUTO_META[task]
  const needsSelection = meta.needsSelection

  const [preview, setPreview] = useState<RecruitAutoPreview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [lastRun, setLastRun] = useState<RunRecruitAutoResult | null>(null)

  const load = useCallback(
    async (ids: string[]) => {
      setBusy(true)
      try {
        setPreview(await adminPreviewRecruitAuto(task, ids))
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : '预览失败')
      } finally {
        setBusy(false)
      }
    },
    [task],
  )

  useEffect(() => {
    setSelected(new Set())
    setLastRun(null)
    void load([])
  }, [task, load])

  /** 勾选变化后重新预览：谁通过、谁收到感谢信会立刻跟着变 */
  const refresh = () => void load([...selected])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const run = async (force = false) => {
    setConfirming(false)
    setRunning(true)
    try {
      const result = await adminRunRecruitAuto({ task, selectedIds: [...selected], force })
      setLastRun(result)
      const parts = [`改动 ${result.moved} 条记录`]
      if (result.mail.summary) parts.push(result.mail.summary)
      if (result.archive) parts.push(`已导出 ${result.archive.total} 条名单存档`)
      toast.success(`${meta.label} 已执行`, { description: parts.join('；') })
      setSelected(new Set())
      await load([])
      onDone?.()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '执行失败')
    } finally {
      setRunning(false)
    }
  }

  const blocked = preview?.blocked ?? ''
  const total = preview?.summary.total ?? 0

  return (
    <>
      <OperationCard
        title={meta.label}
        description={meta.description}
        badge={total}
        blocked={blocked}
        onReload={refresh}
        reloading={busy}
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            disabled={running || busy || total === 0 || Boolean(blocked)}
            onClick={() => setConfirming(true)}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            执行
          </Button>
        }
      >
        <div className="max-h-80 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {needsSelection && <TableHead className="w-12">通过</TableHead>}
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
                    {item.mail ? (
                      RECRUIT_MAIL_META[item.mail].label
                    ) : (
                      <span className="text-muted-foreground">不发</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.reason}</TableCell>
                </TableRow>
              ))}
              {total === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    {busy ? '正在计算…' : '没有需要处理的同学'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {needsSelection && total > 0 && (
          <div className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            勾选 = 通过；<strong className="text-foreground">未勾选的同学会被判为未通过并立即收到感谢信</strong>
            ，所以请核对完名单再执行。已勾选 {selected.size} 人。
          </div>
        )}

        {extraHint && (
          <div className="border-t border-border px-5 py-2.5 text-[11px] text-muted-foreground">{extraHint}</div>
        )}

        {lastRun && (
          <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
            上次执行：改动 {lastRun.moved} 条 · {lastRun.mail.summary || '未发信'}
            {lastRun.mail.results.some((item) => !item.sent) && (
              <span className="text-destructive">
                {' '}
                （{(lastRun.mail.results.filter((item) => !item.sent)[0] ?? {}).code} 等
                {lastRun.mail.results.filter((item) => !item.sent).length} 封未发出）
              </span>
            )}
          </div>
        )}
      </OperationCard>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认执行「{meta.label}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将处理 {total} 人，其中 {preview?.summary.mailed ?? 0} 人会收到邮件。
              {task === 'close_cycle'
                ? '关闭会先导出一份名单存档，然后清空报名数据与报名表文件，且无法撤销。'
                : '邮件发出后无法撤回，请确认名单与文案无误。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            {/* 关闭本届时手动点击本身就是「绕过截止时间」的意图 */}
            <AlertDialogAction onClick={() => void run(task === 'close_cycle')}>
              确认执行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
