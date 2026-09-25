import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  adminBulkApplications,
  adminDeleteApplication,
  adminGetApplication,
  adminListApplications,
  adminNotifyApplications,
  adminUpdateApplication,
  applicationFileUrl,
  recruitExportUrl,
  type AdminApplication,
  type ApplicationDetail,
  type MailLogRow,
  type UpdateApplicationBody,
} from '@/api/endpoints'
import { ApiError } from '@/api/client'
import {
  applicationLabel,
  applicationTone,
  nextStageOf,
  prevStageOf,
  RECRUIT_MAIL_KINDS,
  RECRUIT_MAIL_META,
  RECRUIT_RESULT_LABELS,
  RECRUIT_STAGE_HINTS,
  RECRUIT_STAGES,
  RECRUIT_STAGE_LABELS,
  STAGE_RESULTS,
  type CheckinStage,
  type RecruitMailKind,
  type RecruitResult,
  type RecruitStage,
} from '@shared/recruit'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  Mail,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { RecruitOpsGuard, RecruitTabs } from './RecruitTabs'
import { useRecruitSettings } from './useRecruitSettings'

const TONE_CLASS: Record<string, string> = {
  pending: 'bg-secondary text-foreground',
  active: 'bg-accent/15 text-accent',
  passed: 'bg-emerald-500/10 text-emerald-700',
  done: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-destructive/10 text-destructive',
}

/** 阶段 → 该阶段的签到列与成绩列 */
const STAGE_FIELDS = {
  apply: null,
  written: { checkin: 'writtenCheckinAt', score: 'writtenScore', stage: 'written' },
  interview: { checkin: 'interviewCheckinAt', score: 'interviewScore', stage: 'interview' },
  defense: { checkin: 'defenseCheckinAt', score: 'defenseScore', stage: 'defense' },
  onboard: null,
} as const

function formatMoment(value: string): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(raw)
  if (match) {
    const [, y, m, d, h, min] = match
    return h ? `${y}-${m}-${d} ${h}:${min}` : `${y}-${m}-${d}`
  }
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return raw
  const shifted = new Date(parsed + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

/** 结果取值的中文（含空串的「待定」） */
function resultLabel(result: RecruitResult): string {
  return result === '' ? '待定' : RECRUIT_RESULT_LABELS[result]
}

/**
 * 报名管理：按阶段分页签看人，勾选后批量处理，点开单人可改状态、记成绩、补发邮件。
 *
 * 批量推进状态（生成面试名单、录取、答辩通过）**不在这里做** ——
 * 那些会连带发信且影响整批人，统一走「自动流程」页的预览确认。
 */
export function ApplicationsPage() {
  const { settings, loading, reload } = useRecruitSettings()
  const [stage, setStage] = useState<RecruitStage>('apply')
  const [resultFilter, setResultFilter] = useState<RecruitResult | 'all'>('all')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<AdminApplication[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [detail, setDetail] = useState<ApplicationDetail | null>(null)
  const [deleting, setDeleting] = useState<AdminApplication | null>(null)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [notifySubject, setNotifySubject] = useState('')
  const [notifyBody, setNotifyBody] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const response = await adminListApplications({
        stages: [stage],
        results: resultFilter === 'all' ? undefined : [resultFilter],
        q: search || undefined,
        limit: 500,
      })
      setItems(response.items)
      setTotal(response.total)
      setSelected(new Set())
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setBusy(false)
    }
  }, [stage, resultFilter, search])

  useEffect(() => {
    void load()
  }, [load])

  const stageOptions = useMemo(() => STAGE_RESULTS[stage], [stage])
  const resultCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) counts[item.result] = (counts[item.result] ?? 0) + 1
    return counts
  }, [items])

  // ===== 批量操作 =====

  const bulk = async (action: 'checkin' | 'absent' | 'withdraw') => {
    const ids = [...selected]
    if (ids.length === 0) return toast.error('请先勾选同学')
    try {
      const checkinStage = STAGE_FIELDS[stage]?.stage as CheckinStage | undefined
      const response = await adminBulkApplications({
        ids,
        action,
        stage: action === 'checkin' ? checkinStage : undefined,
      })
      toast.success(`已处理 ${response.moved} 人`)
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '批量操作失败')
    }
  }

  const sendNotify = async () => {
    const ids = [...selected]
    if (ids.length === 0) return toast.error('请先勾选同学')
    if (!notifySubject.trim() || !notifyBody.trim()) return toast.error('请填写主题与正文')
    setSending(true)
    try {
      const response = await adminNotifyApplications({
        ids,
        subject: notifySubject.trim(),
        body: notifyBody.trim(),
      })
      toast.success('群发完成', { description: response.summary })
      setNotifyOpen(false)
      setNotifySubject('')
      setNotifyBody('')
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '群发失败')
    } finally {
      setSending(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await adminDeleteApplication(deleting.id)
      toast.success('已删除')
      setDeleting(null)
      if (detail?.application.id === deleting.id) setDetail(null)
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '删除失败')
    }
  }

  const checkinStage = STAGE_FIELDS[stage]?.stage as CheckinStage | undefined

  return (
    <div className="mx-auto max-w-6xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reload} />

      <RecruitOpsGuard settings={settings} loading={loading}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold">报名管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {RECRUIT_STAGE_LABELS[stage]}阶段 · {RECRUIT_STAGE_HINTS[stage]} · 共 {total} 人
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="姓名 / 学号 / 邮箱 / 手机 / QQ"
                className="w-56 pl-8"
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => void load()} title="刷新">
              <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
            </Button>
            <a
              href={recruitExportUrl({ stage, ...(resultFilter === 'all' ? {} : { result: resultFilter }) })}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-secondary"
            >
              <Download className="h-4 w-4" /> 导出 CSV
            </a>
          </div>
        </div>

        {/* 阶段页签 */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {RECRUIT_STAGES.map((value) => (
            <button
              key={value}
              onClick={() => {
                setStage(value)
                setResultFilter('all')
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                value === stage
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border text-foreground/70 hover:bg-secondary',
              )}
            >
              {RECRUIT_STAGE_LABELS[value]}
            </button>
          ))}
        </div>

        {/* 结果筛选 */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setResultFilter('all')}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              resultFilter === 'all' ? 'border-transparent bg-secondary' : 'border-border text-foreground/70',
            )}
          >
            全部 {items.length}
          </button>
          {stageOptions.map((value) => (
            <button
              key={value || 'pending'}
              onClick={() => setResultFilter(value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                resultFilter === value
                  ? 'border-transparent bg-secondary'
                  : 'border-border text-foreground/70',
              )}
            >
              {resultLabel(value)} {resultCounts[value] ?? 0}
            </button>
          ))}
        </div>

        {/* 批量操作条 */}
        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-4 py-2.5">
            <span className="text-xs">已勾选 {selected.size} 人</span>
            {checkinStage && (
              <Button size="sm" variant="outline" onClick={() => void bulk('checkin')}>
                <UserCheck className="h-3.5 w-3.5" /> 标记已签到
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void bulk('absent')}>
              标记未参加
            </Button>
            <Button size="sm" variant="outline" onClick={() => void bulk('withdraw')}>
              退出报名
            </Button>
            <Button size="sm" variant="outline" onClick={() => setNotifyOpen(true)}>
              <Mail className="h-3.5 w-3.5" /> 群发通知
            </Button>
            <button
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(new Set())}
            >
              取消选择
            </button>
          </div>
        )}

        {/* 列表 */}
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                  />
                </TableHead>
                <TableHead className="w-40">报名人</TableHead>
                <TableHead>联系方式</TableHead>
                {STAGE_FIELDS[stage] && <TableHead className="w-24">成绩</TableHead>}
                {STAGE_FIELDS[stage] && <TableHead className="w-32">签到</TableHead>}
                <TableHead className="w-32">当前状态</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const fields = STAGE_FIELDS[stage]
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => {
                      void adminGetApplication(item.id)
                        .then(setDetail)
                        .catch(() => toast.error('详情加载失败'))
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(item.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(item.id)) next.delete(item.id)
                            else next.add(item.id)
                            return next
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{item.name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{item.studentId}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="max-w-[14rem] truncate">{item.email || '—'}</div>
                      <div className="text-muted-foreground">
                        {item.phone}
                        {item.qq ? ` · QQ ${item.qq}` : ''}
                      </div>
                    </TableCell>
                    {fields && (
                      <TableCell className="text-xs">
                        {String(item[fields.score] ?? '') || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    {fields && (
                      <TableCell className="text-xs text-muted-foreground">
                        {item[fields.checkin] ? formatMoment(String(item[fields.checkin])) : '未签到'}
                      </TableCell>
                    )}
                    <TableCell>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs',
                          TONE_CLASS[applicationTone(item.stage, item.result)],
                        )}
                      >
                        {applicationLabel(item.stage, item.result)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <a
                          href={applicationFileUrl(item.id)}
                          className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          title="下载报名表"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => setDeleting(item)}
                          className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {items.length === 0 && !busy && (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center text-sm text-muted-foreground">
                    该阶段暂无报名记录
                  </TableCell>
                </TableRow>
              )}
              {busy && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </RecruitOpsGuard>

      {/* ===== 单人详情 ===== */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detail && (
            <ApplicationDetailPanel
              detail={detail}
              onReload={async () => {
                const fresh = await adminGetApplication(detail.application.id)
                setDetail(fresh)
                await load()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ===== 群发通知 ===== */}
      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">群发通知（{selected.size} 人）</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label className="text-xs">主题</Label>
              <Input
                value={notifySubject}
                onChange={(e) => setNotifySubject(e.target.value)}
                placeholder="【拾光工作室】面试地点调整通知"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">正文</Label>
              <Textarea
                rows={8}
                className="font-mono text-xs"
                value={notifyBody}
                onChange={(e) => setNotifyBody(e.target.value)}
                placeholder={'支持 {name}、{studio} 等变量，例如：\n\n{name} 同学：\n面试地点调整为实验楼 B205，时间不变。'}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNotifyOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void sendNotify()} disabled={sending} className="gap-1.5">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              发送
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== 删除确认 ===== */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条报名记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleting?.name}（{deleting?.studentId}）」及其报名表文件，此操作不可撤销。
              这位同学之后需要重新提交报名表。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void remove()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================================
// 单人详情面板
// ============================================================================

function ApplicationDetailPanel({
  detail,
  onReload,
}: {
  detail: ApplicationDetail
  onReload: () => Promise<void>
}) {
  const app = detail.application
  const [draft, setDraft] = useState({
    writtenScore: app.writtenScore,
    interviewScore: app.interviewScore,
    defenseScore: app.defenseScore,
    writtenNote: app.writtenNote,
    interviewNote: app.interviewNote,
    defenseNote: app.defenseNote,
    note: app.note,
  })
  const [notice, setNotice] = useState<RecruitMailKind | ''>('')
  const [saving, setSaving] = useState(false)

  const submit = async (body: UpdateApplicationBody, successText: string) => {
    setSaving(true)
    try {
      const result = await adminUpdateApplication(app.id, body)
      if (result.mail) {
        if (result.mail.sent) toast.success(result.mail.message)
        else toast.warning(result.mail.message, { description: `原因码：${result.mail.code}` })
      } else {
        toast.success(successText)
      }
      await onReload()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '操作失败')
    } finally {
      setSaving(false)
    }
  }

  const checkinField = {
    written: 'writtenCheckinAt',
    interview: 'interviewCheckinAt',
    defense: 'defenseCheckinAt',
  } as const
  const myCheckinStage = (Object.keys(checkinField) as Array<keyof typeof checkinField>).find(
    (key) => key === app.stage,
  )
  const checkedIn = myCheckinStage ? Boolean(app[checkinField[myCheckinStage]]) : false

  const next = nextStageOf(app.stage)
  const prev = prevStageOf(app.stage)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-xl">
          {app.name} · {app.studentId}
        </DialogTitle>
      </DialogHeader>

      <div className="grid gap-5 py-1">
        {/* 状态与流转 */}
        <div className="rounded-xl border border-border bg-secondary/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn('rounded-full px-2.5 py-0.5 text-xs', TONE_CLASS[applicationTone(app.stage, app.result)])}
            >
              {applicationLabel(app.stage, app.result)}
            </span>
            <span className="text-xs text-muted-foreground">
              {RECRUIT_STAGE_LABELS[app.stage]} · {resultLabel(app.result)}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {prev && (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void submit({ stage: prev }, `已退回「${RECRUIT_STAGE_LABELS[prev]}」`)}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> 退回{RECRUIT_STAGE_LABELS[prev]}
              </Button>
            )}
            {next && (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void submit({ stage: next }, `已推进到「${RECRUIT_STAGE_LABELS[next]}」`)}
              >
                推进到{RECRUIT_STAGE_LABELS[next]} <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}

            <Select
              value={app.result || 'pending'}
              onValueChange={(value) =>
                void submit(
                  { result: (value === 'pending' ? '' : value) as RecruitResult },
                  '状态结果已更新',
                )
              }
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGE_RESULTS[app.stage].map((value) => (
                  <SelectItem key={value || 'pending'} value={value || 'pending'}>
                    {resultLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {myCheckinStage && (
              <Button
                size="sm"
                variant={checkedIn ? 'default' : 'outline'}
                disabled={saving}
                onClick={() =>
                  void submit(
                    { checkin: { stage: myCheckinStage as CheckinStage, value: !checkedIn } },
                    checkedIn ? '已取消签到' : '已标记签到',
                  )
                }
              >
                <UserCheck className="h-3.5 w-3.5" /> {checkedIn ? '已签到' : '标记签到'}
              </Button>
            )}

            {app.result !== 'withdrawn' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                className="text-destructive hover:bg-destructive/10"
                onClick={() => void submit({ result: 'withdrawn' }, '已标记退出报名')}
              >
                退出报名
              </Button>
            )}
          </div>

          {app.inviteUrl && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[11px]">{app.inviteUrl}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(app.inviteUrl)
                    .then(() => toast.success('邀请函链接已复制'))
                    .catch(() => toast.error('复制失败，请手动选中复制'))
                }}
              >
                <Copy className="h-3.5 w-3.5" /> 复制邀请链接
              </Button>
            </div>
          )}
        </div>

        {/* 联系方式与材料 */}
        <div className="grid gap-2 rounded-xl border border-border p-4 text-xs">
          <div>邮箱：{app.email || '—'}</div>
          <div>
            手机：{app.phone || '—'} · QQ：{app.qq || '—'}
          </div>
          <div>报名时间：{formatMoment(app.createdAt ?? '')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <a
              href={applicationFileUrl(app.id)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 hover:bg-secondary"
            >
              <Download className="h-3.5 w-3.5" /> 下载报名表
            </a>
            <span className="text-muted-foreground">
              {app.fileName}（{(app.fileSize / 1024 / 1024).toFixed(2)} MB）
            </span>
          </div>
        </div>

        {/* 成绩与评语 */}
        <div className="grid gap-3">
          <div className="text-xs font-medium text-muted-foreground">成绩与评语（仅内部可见）</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['writtenScore', '笔试成绩'],
                ['interviewScore', '面试成绩'],
                ['defenseScore', '答辩成绩'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="grid gap-1.5">
                <Label className="text-xs">{label}</Label>
                <Input
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {(
            [
              ['writtenNote', '笔试备注'],
              ['interviewNote', '面试评语'],
              ['defenseNote', '答辩评语'],
              ['note', '管理员备注'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="grid gap-1.5">
              <Label className="text-xs">{label}</Label>
              <Textarea
                rows={2}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </div>
          ))}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={saving}
              className="gap-1.5"
              onClick={() => void submit(draft, '成绩与评语已保存')}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} 保存
            </Button>
          </div>
        </div>

        {/* 补发邮件 */}
        <div className="grid gap-2 rounded-xl border border-border p-4">
          <div className="text-xs font-medium text-muted-foreground">补发通知邮件</div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={notice || 'none'} onValueChange={(value) => setNotice(value === 'none' ? '' : (value as RecruitMailKind))}>
              <SelectTrigger className="h-8 w-60">
                <SelectValue placeholder="选择要补发的信" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不发送</SelectItem>
                {RECRUIT_MAIL_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {RECRUIT_MAIL_META[kind].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || !notice}
              className="gap-1.5"
              onClick={() => void submit({ notice: notice || undefined }, '已发送')}
            >
              <Mail className="h-3.5 w-3.5" /> 发送
            </Button>
          </div>
          {notice && (
            <p className="text-[11px] text-muted-foreground">{RECRUIT_MAIL_META[notice].trigger}</p>
          )}
        </div>

        {/* 发信记录 */}
        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">发信记录</div>
          {detail.mails.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">还没有给他发过邮件。</p>
          ) : (
            <div className="space-y-1">
              {detail.mails.map((log: MailLogRow) => (
                <div key={log.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={cn(log.ok ? 'text-emerald-700' : 'text-destructive')}>
                    {log.ok ? '已发出' : log.code}
                  </span>
                  <span className="text-muted-foreground">{formatMoment(log.createdAt)}</span>
                  <span className="truncate">{log.subject}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
