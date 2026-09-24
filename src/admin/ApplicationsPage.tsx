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
import { Switch } from '@/components/ui/switch'
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
  adminDeleteApplication,
  adminListApplications,
  adminUpdateApplication,
  applicationFileUrl,
  type AdminApplication,
} from '@/api/endpoints'
import { ApiError } from '@/api/client'
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_META,
  applicationToneOf,
  applicationStageOf,
  APPLICATION_STAGE_LABELS,
  isApplicationInProgress,
  nextApplicationStatuses,
  type ApplicationNoticeKind,
} from '@shared/recruit'
import type { ApplicationStatus } from '@shared/types'
import { cn } from '@/lib/utils'
import {
  Copy,
  Download,
  Mail,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

type Filter = { kind: 'all' | 'progress' | 'status'; status?: ApplicationStatus }

const TONE_CLASS: Record<string, string> = {
  pending: 'bg-secondary text-foreground',
  active: 'bg-accent/15 text-accent',
  passed: 'bg-emerald-500/10 text-emerald-700',
  done: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-destructive/10 text-destructive',
}

/** 过程字段的草稿（与状态一起提交） */
interface Draft {
  writtenAt: string
  writtenScore: string
  writtenNote: string
  interviewAt: string
  interviewNote: string
  probationNote: string
  note: string
}

function draftOf(app: AdminApplication): Draft {
  return {
    writtenAt: app.writtenAt,
    writtenScore: app.writtenScore,
    writtenNote: app.writtenNote,
    interviewAt: app.interviewAt,
    interviewNote: app.interviewNote,
    probationNote: app.probationNote,
    note: app.note,
  }
}

function formatMoment(value: string): string {
  const raw = (value ?? '').trim()
  if (!raw) return '—'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(
    parsed.getHours(),
  )}:${pad(parsed.getMinutes())}`
}

const PROGRESS_STATUSES = APPLICATION_STATUSES.filter(isApplicationInProgress)

/**
 * 后台「招新报名」页。
 *
 * 状态流转只走 PUT /api/admin/applications/:id 一个口：填好过程字段（笔试时间等），
 * 再点「推进到 →」按钮，状态与通知邮件在同一次请求里完成，不会出现两头不一致。
 */
export function ApplicationsPage() {
  const [items, setItems] = useState<AdminApplication[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })

  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sendMail, setSendMail] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<AdminApplication | null>(null)

  const statusParam = useMemo(() => {
    if (filter.kind === 'progress') return PROGRESS_STATUSES
    if (filter.kind === 'status' && filter.status) return [filter.status]
    return undefined
  }, [filter])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await adminListApplications({ status: statusParam, q: search || undefined })
      setItems(result.items)
      setTotal(result.total)
      setCounts(result.counts)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [statusParam, search])

  useEffect(() => {
    void load()
  }, [load])

  const current = openId ? items.find((item) => item.id === openId) ?? null : null

  const openDetail = (app: AdminApplication) => {
    setOpenId(app.id)
    setDraft(draftOf(app))
    setSendMail(true)
  }

  const closeDetail = () => {
    setOpenId(null)
    setDraft(null)
  }

  /** 保存过程字段（不改状态、不发信） */
  const saveDraft = async () => {
    if (!current || !draft) return
    setSaving(true)
    try {
      await adminUpdateApplication(current.id, { ...draft, sendMail: false })
      toast.success('已保存')
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 推进状态；按需发信，并把发信结果如实告诉管理员 */
  const advance = async (to: ApplicationStatus, notice?: ApplicationNoticeKind) => {
    if (!current || !draft) return
    setSaving(true)
    try {
      const result = await adminUpdateApplication(current.id, {
        ...draft,
        status: to,
        sendMail,
        notice,
      })
      if (result.mail) {
        if (result.mail.sent) toast.success(result.mail.message)
        else toast.warning(result.mail.message, { description: `原因码：${result.mail.code}` })
      } else {
        toast.success(`已更新为「${APPLICATION_STATUS_META[to].label}」`)
      }
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '状态更新失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await adminDeleteApplication(deleting.id)
      toast.success('已删除')
      setDeleting(null)
      if (openId === deleting.id) closeDetail()
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '删除失败')
    }
  }

  const copyInviteUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('邀请函链接已复制，发给同学即可')
    } catch {
      toast.error('复制失败，请手动选中链接复制')
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">招新报名</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            报名 → 笔试 → 面试 → 预备期 → 转正，共 {total} 条 · 推进状态时会自动发通知邮件
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* 状态筛选 */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip
          active={filter.kind === 'all'}
          label={`全部 ${Object.values(counts).reduce((a, b) => a + b, 0)}`}
          onClick={() => setFilter({ kind: 'all' })}
        />
        <FilterChip
          active={filter.kind === 'progress'}
          label={`进行中 ${PROGRESS_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0)}`}
          onClick={() => setFilter({ kind: 'progress' })}
        />
        {APPLICATION_STATUSES.map((status) => (
          <FilterChip
            key={status}
            active={filter.kind === 'status' && filter.status === status}
            label={`${APPLICATION_STATUS_META[status].label} ${counts[status] ?? 0}`}
            onClick={() => setFilter({ kind: 'status', status })}
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>报名人</TableHead>
              <TableHead>联系方式</TableHead>
              <TableHead className="w-32">状态</TableHead>
              <TableHead className="w-36">报名时间</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((app) => (
              <TableRow key={app.id} className="cursor-pointer" onClick={() => openDetail(app)}>
                <TableCell>
                  <div className="text-sm font-medium">{app.name || '—'}</div>
                  <div className="text-xs text-muted-foreground">{app.studentId}</div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[16rem] truncate text-xs">{app.email || '—'}</div>
                  <div className="text-xs text-muted-foreground">
                    {app.phone}
                    {app.qq ? ` · QQ ${app.qq}` : ''}
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs',
                      TONE_CLASS[applicationToneOf(app.status)],
                    )}
                  >
                    {APPLICATION_STATUS_META[app.status]?.label ?? app.status}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatMoment(app.createdAt ?? '')}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <a
                      href={applicationFileUrl(app.id)}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      title="下载报名表"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => setDeleting(app)}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-14 text-center text-sm text-muted-foreground">
                  暂无报名记录
                </TableCell>
              </TableRow>
            )}
            {loading && (
              <TableRow>
                <TableCell colSpan={5} className="py-14 text-center text-sm text-muted-foreground">
                  加载中…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ===== 详情 / 状态流转 ===== */}
      <Dialog open={current !== null} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {current?.name} · {current?.studentId}
            </DialogTitle>
          </DialogHeader>

          {current && draft && (
            <div className="grid gap-5 py-1">
              {/* 当前状态与可用的下一步 */}
              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2.5 py-0.5 text-xs',
                      TONE_CLASS[applicationToneOf(current.status)],
                    )}
                  >
                    {current.statusLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    阶段：{APPLICATION_STAGE_LABELS[applicationStageOf(current.status)]}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {APPLICATION_STATUS_META[current.status]?.hint}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {nextApplicationStatuses(current.status).map((next) => (
                    <Button
                      key={next}
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void advance(next)}
                    >
                      → {APPLICATION_STATUS_META[next].label}
                    </Button>
                  ))}
                  {nextApplicationStatuses(current.status).length === 0 && (
                    <span className="text-xs text-muted-foreground">该状态为终态，无后续流转</span>
                  )}
                </div>

                <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={sendMail} onCheckedChange={setSendMail} />
                  推进时发送对应通知邮件（笔试邀请 / 面试邀请 / 感谢信 / 邀请函）
                </label>
              </div>

              {/* 基本信息 */}
              <div className="grid gap-1.5 text-sm">
                <div className="text-xs font-medium text-muted-foreground">报名信息</div>
                <div className="rounded-lg border border-border p-3 text-xs leading-relaxed">
                  <div>邮箱：{current.email || '—'}</div>
                  <div>
                    手机：{current.phone || '—'} · QQ：{current.qq || '—'}
                  </div>
                  <div>报名时间：{formatMoment(current.createdAt ?? '')}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a
                      href={applicationFileUrl(current.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 hover:bg-secondary"
                    >
                      <Download className="h-3.5 w-3.5" /> 下载报名表
                    </a>
                    <span className="text-muted-foreground">
                      {current.fileName}（{(current.fileSize / 1024 / 1024).toFixed(2)} MB）
                    </span>
                  </div>
                </div>
              </div>

              {/* 邀请函 */}
              {current.inviteUrl && (
                <div className="grid gap-1.5">
                  <div className="text-xs font-medium text-muted-foreground">邀请函链接</div>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                    <span className="min-w-0 flex-1 truncate text-xs">{current.inviteUrl}</span>
                    <Button size="sm" variant="outline" onClick={() => void copyInviteUrl(current.inviteUrl)}>
                      <Copy className="h-3.5 w-3.5" /> 复制
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void advance('invited', 'offer')}
                      title="重发邀请函邮件"
                    >
                      <Mail className="h-3.5 w-3.5" /> 重发邀请函
                    </Button>
                  </div>
                </div>
              )}

              {/* 过程字段 */}
              <div className="grid gap-3">
                <div className="text-xs font-medium text-muted-foreground">过程记录</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">笔试时间</Label>
                    <Input
                      type="datetime-local"
                      value={draft.writtenAt}
                      onChange={(e) => setDraft({ ...draft, writtenAt: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">笔试成绩（仅内部）</Label>
                    <Input
                      value={draft.writtenScore}
                      onChange={(e) => setDraft({ ...draft, writtenScore: e.target.value })}
                      placeholder="如：78 / 100"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">笔试地点 / 形式（会写进笔试邀请邮件）</Label>
                  <Input
                    value={draft.writtenNote}
                    onChange={(e) => setDraft({ ...draft, writtenNote: e.target.value })}
                    placeholder="如：实验楼 B203 机房 / 线上（链接另行通知）"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">面试时间</Label>
                    <Input
                      type="datetime-local"
                      value={draft.interviewAt}
                      onChange={(e) => setDraft({ ...draft, interviewAt: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">面试地点 / 形式（会写进面试邀请邮件）</Label>
                    <Input
                      value={draft.interviewNote}
                      onChange={(e) => setDraft({ ...draft, interviewNote: e.target.value })}
                      placeholder="如：实验楼 B203 会议室"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">预备期评语（仅内部）</Label>
                  <Textarea
                    rows={2}
                    value={draft.probationNote}
                    onChange={(e) => setDraft({ ...draft, probationNote: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">管理员备注（仅内部）</Label>
                  <Textarea
                    rows={2}
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">
                  改完过程字段点「保存」；推进状态会一并保存并（可选）发信
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeDetail}>
                    关闭
                  </Button>
                  <Button onClick={() => void saveDraft()} disabled={saving}>
                    <Send className="h-4 w-4" /> 保存
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== 删除确认 ===== */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条报名记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleting?.name}（{deleting?.studentId}）」及其报名表文件，此操作不可撤销。
              若这位同学之后还想报名，需要重新提交。
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

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border text-foreground/70 hover:bg-secondary hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
