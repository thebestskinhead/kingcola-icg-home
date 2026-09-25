/**
 * 名单视图（演示）。
 *
 * 对应旧版的「报名管理」页，是跨阶段的全量数据入口：筛选 / 搜索 / 导出 / 批量处理 / 单人详情。
 * 流程视图只露出「当前这一步该做的事」，翻旧账、找人、导数据都来这里。
 */

import { useMemo, useState } from 'react'
import {
  canMoveStage,
  nextStageOf,
  prevStageOf,
  RECRUIT_MAIL_KINDS,
  RECRUIT_STAGE_LABELS,
  type RecruitMailKind,
} from '@shared/recruit'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { cn } from '@/lib/utils'
import {
  Check,
  Copy,
  Download,
  FileText,
  Mail,
  Search,
  Send,
  Trash2,
  UserMinus,
  UserX,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  appResultLabel,
  appStageLabel,
  appStatusLabel,
  CHECKIN_STAGE_LABELS,
  DEMO_MAIL_META,
  downloadCsv,
  formatSize,
  RESULT_OPTION_LABELS,
  RESULT_OPTIONS,
  toExportRow,
  type MockApp,
  type QrStage,
  type StageKey,
} from './demo-model'
import type { DemoRecruit } from './useDemoRecruit'

const STAGES: StageKey[] = ['apply', 'written', 'interview', 'defense', 'onboard']

/** 关键词搜索：姓名 / 学号 / 邮箱 / 手机 / QQ 都能命中 */
function matches(app: MockApp, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [app.name, app.studentId, app.email, app.phone, app.qq].some((field) =>
    field.toLowerCase().includes(q),
  )
}

export function DemoRosterPage({ demo }: { demo: DemoRecruit }) {
  const [stage, setStage] = useState<StageKey>(demo.currentStage === 'prepare' || demo.currentStage === 'archive' ? 'apply' : demo.currentStage)
  const [result, setResult] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [deleting, setDeleting] = useState<MockApp | null>(null)

  const stageList = useMemo(() => demo.apps.filter((app) => app.stage === stage), [demo.apps, stage])
  const filtered = useMemo(
    () => stageList.filter((app) => (result === 'all' || app.result === result) && matches(app, query)),
    [stageList, result, query],
  )
  const detail = detailId ? (demo.apps.find((app) => app.id === detailId) ?? null) : null
  const allChecked = filtered.length > 0 && filtered.every((app) => selected.has(app.id))
  const checkinStage: QrStage | null =
    stage === 'written' || stage === 'interview' || stage === 'defense' ? stage : null

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allChecked) filtered.forEach((app) => next.delete(app.id))
      else filtered.forEach((app) => next.add(app.id))
      return next
    })

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectedIds = [...selected]

  const exportCsv = () => {
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(filtered.map(toExportRow), `报名名单-${RECRUIT_STAGE_LABELS[stage]}-${today}.csv`)
    toast.success(`已导出 ${filtered.length} 条记录`, { description: '列与真实导出完全一致，可直接给评审。' })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">名单</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            跨阶段的全量数据：筛选、搜索、导出 CSV，勾选后批量处理，点开某个人看全部材料与发信记录。
          </p>
        </div>
        <Button variant="outline" className="gap-1.5" onClick={exportCsv}>
          <Download className="h-4 w-4" /> 导出 CSV（当前筛选 {filtered.length} 条）
        </Button>
      </div>

      {/* 阶段与结果筛选 */}
      <div className="space-y-3 rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGES.map((item) => {
            const count = demo.apps.filter((app) => app.stage === item).length
            return (
              <button
                key={item}
                onClick={() => {
                  setStage(item)
                  setResult('all')
                  setSelected(new Set())
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  stage === item
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border text-foreground/70 hover:bg-secondary',
                )}
              >
                {RECRUIT_STAGE_LABELS[item]} {count}
              </button>
            )
          })}
          <div className="relative ml-auto min-w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              value={query}
              placeholder="搜姓名 / 学号 / 邮箱 / 手机 / QQ"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          {(['all', ...RESULT_OPTIONS[stage]] as string[]).map((item) => {
            const count =
              item === 'all' ? stageList.length : stageList.filter((app) => app.result === item).length
            return (
              <button
                key={item || 'pending'}
                onClick={() => setResult(item)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors',
                  result === item ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:bg-secondary',
                )}
              >
                {item === 'all' ? '全部' : RESULT_OPTION_LABELS[item]} {count}
              </button>
            )
          })}
        </div>
      </div>

      {/* 批量操作条 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 px-4 py-2.5 text-xs">
          <span className="font-medium">已勾选 {selected.size} 人</span>
          {checkinStage && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => demo.bulkCheckin(selectedIds)}>
              <Check className="h-3.5 w-3.5" /> 标记已签到
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1" onClick={() => demo.bulkAbsent(selectedIds)}>
            <UserX className="h-3.5 w-3.5" /> 标记未参加
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => demo.bulkWithdraw(selectedIds)}>
            <UserMinus className="h-3.5 w-3.5" /> 退出报名
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setNotifyOpen(true)}>
            <Mail className="h-3.5 w-3.5" /> 群发通知
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
          <span className="text-muted-foreground">缺考与退出都不发信。</span>
        </div>
      )}

      {/* 表格 */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--accent))]"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="全选"
                />
              </TableHead>
              <TableHead className="w-48">报名人</TableHead>
              <TableHead>联系方式</TableHead>
              {checkinStage && <TableHead className="w-24">成绩</TableHead>}
              {checkinStage && <TableHead className="w-24">签到</TableHead>}
              <TableHead className="w-28">当前状态</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((app) => (
              <TableRow key={app.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--accent))]"
                    checked={selected.has(app.id)}
                    onChange={() => toggle(app.id)}
                    aria-label={`选择 ${app.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {app.name}
                    {app.source === 'manual' && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        补录
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{app.studentId}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {app.email || '—'}
                  <br />
                  {app.phone}
                </TableCell>
                {checkinStage && (
                  <TableCell className="text-xs">{app.scores[checkinStage] || '—'}</TableCell>
                )}
                {checkinStage && (
                  <TableCell className="text-xs">
                    {app.checkins[checkinStage] ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Check className="h-3.5 w-3.5" /> 已签到
                      </span>
                    ) : (
                      <span className="text-muted-foreground">未签到</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-xs">{appStatusLabel(app)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDetailId(app.id)}>
                      详情
                    </Button>
                    {app.fileName && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-xs"
                        onClick={() =>
                          toast.success('开始下载报名表', {
                            description: `${app.fileName} · ${formatSize(app.fileSize)}（仅管理员可下载）`,
                          })
                        }
                      >
                        <FileText className="h-3.5 w-3.5" /> 报名表
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-destructive"
                      onClick={() => setDeleting(app)}
                      aria-label="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  没有符合条件的记录
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {detail && <AppDetailDialog key={detail.id} demo={demo} app={detail} onClose={() => setDetailId(null)} />}

      <NotifyDialog
        open={notifyOpen}
        count={selected.size}
        onClose={() => setNotifyOpen(false)}
        onSend={(subject, body) => {
          demo.notify(selectedIds, subject, body)
          setNotifyOpen(false)
          setSelected(new Set())
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条报名记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {deleting?.name}（{deleting?.studentId}）的报名记录及其报名表文件，不可撤销。
              该同学需要重新报名才能再次参与。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) demo.deleteApp(deleting)
                setDeleting(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 群发通知：主题支持 {name} 等变量，正文由后端按模板渲染后逐人发出 */
function NotifyDialog({
  open,
  count,
  onClose,
  onSend,
}: {
  open: boolean
  count: number
  onClose: () => void
  onSend: (subject: string, body: string) => void
}) {
  const [subject, setSubject] = useState('【拾光工作室】招新通知 · {name}')
  const [body, setBody] = useState(
    '{name} 同学：\n\n你好，关于本次招新有一则通知：\n（在这里写内容，可用 {studio} 等变量）\n\n拾光工作室',
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>群发通知（{count} 人）</DialogTitle>
          <DialogDescription>发给勾选的同学，邮件发出后无法撤回。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">主题</Label>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">正文</Label>
            <Textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              可用变量：{'{name}'}、{'{studentId}'}、{'{cycleName}'}、{'{studio}'}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button className="gap-1.5" onClick={() => onSend(subject, body)} disabled={!subject.trim()}>
            <Send className="h-4 w-4" /> 发送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 单人详情：状态流转、材料、成绩与评语、补发邮件、发信记录 */
function AppDetailDialog({
  demo,
  app,
  onClose,
}: {
  demo: DemoRecruit
  app: MockApp
  onClose: () => void
}) {
  const [scores, setScores] = useState(app.scores)
  const [notes, setNotes] = useState(app.notes)
  const [remark, setRemark] = useState(app.remark)
  const [mailKind, setMailKind] = useState<RecruitMailKind | ''>('')

  const checkinStage: QrStage | null =
    app.stage === 'written' || app.stage === 'interview' || app.stage === 'defense' ? app.stage : null
  const prev = prevStageOf(app.stage)
  const next = nextStageOf(app.stage)
  const mails = demo.mails.filter((mail) => mail.appId === app.id)

  const save = () => {
    demo.patch(app.id, { scores, notes, remark })
    toast.success('已保存', { description: '成绩与评语只有内部可见，不会发给同学。' })
  }

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(app.inviteUrl)
      toast.success('邀请链接已复制')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {app.name}
            <span className="text-sm font-normal text-muted-foreground">{app.studentId}</span>
            {app.source === 'manual' && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                补录
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {appStageLabel(app)} · {appResultLabel(app)} · {appStatusLabel(app)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 状态与流转 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">状态与流转</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!prev || !canMoveStage(app.stage, prev)}
                onClick={() => prev && demo.patch(app.id, { stage: prev, result: '' })}
              >
                退回{prev ? RECRUIT_STAGE_LABELS[prev] : '—'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!next || !canMoveStage(app.stage, next)}
                onClick={() => next && demo.patch(app.id, { stage: next, result: '' })}
              >
                推进到{next ? RECRUIT_STAGE_LABELS[next] : '—'}
              </Button>
              <Select value={app.result || 'pending'} onValueChange={(value) => demo.patch(app.id, { result: value === 'pending' ? '' : (value as MockApp['result']) })}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESULT_OPTIONS[app.stage].map((item) => (
                    <SelectItem key={item || 'pending'} value={item || 'pending'}>
                      {RESULT_OPTION_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {checkinStage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() =>
                    demo.patch(app.id, { checkins: { ...app.checkins, [checkinStage]: !app.checkins[checkinStage] } })
                  }
                >
                  <Check className="h-3.5 w-3.5" />
                  {app.checkins[checkinStage] ? '取消签到' : '标记签到'}
                </Button>
              )}
              {app.result !== 'withdrawn' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => demo.patch(app.id, { result: 'withdrawn' })}
                >
                  退出报名
                </Button>
              )}
              {app.inviteUrl && (
                <Button size="sm" variant="outline" className="gap-1" onClick={() => void copyInvite()}>
                  <Copy className="h-3.5 w-3.5" /> 复制邀请链接
                </Button>
              )}
            </div>
          </section>

          {/* 联系方式与材料 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">联系方式与材料</h3>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>邮箱：{app.email || '—'}</div>
              <div>手机：{app.phone || '—'}</div>
              <div>QQ：{app.qq || '—'}</div>
              <div>报名时间：{demo.formatTime(app.createdAt)}</div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              {app.fileName ? (
                <>
                  <span className="font-medium">{app.fileName}</span>
                  <span className="text-muted-foreground">{formatSize(app.fileSize)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => toast.success('开始下载报名表', { description: '报名表是私有文件，只有管理员能下载。' })}
                  >
                    <Download className="h-3 w-3" /> 下载
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">没有报名表（补录人员可不交）</span>
              )}
            </div>
          </section>

          {/* 成绩与评语 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">成绩与评语（内部可见）</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['written', 'interview', 'defense'] as const).map((field) => (
                <div key={field} className="grid gap-1.5">
                  <Label className="text-xs">{CHECKIN_STAGE_LABELS[field]}成绩</Label>
                  <Input
                    className="h-8 text-xs"
                    value={scores[field]}
                    placeholder="如 78"
                    onChange={(event) => setScores({ ...scores, [field]: event.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    value={notes[field]}
                    placeholder={field === 'interview' ? '面试评语' : '阅卷备注'}
                    onChange={(event) => setNotes({ ...notes, [field]: event.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-1.5">
              <Label className="text-xs">管理员备注</Label>
              <Textarea
                rows={2}
                className="text-xs"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
              />
            </div>
            <Button size="sm" className="mt-3 gap-1.5" onClick={save}>
              保存
            </Button>
          </section>

          {/* 补发通知邮件 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">补发通知邮件</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={mailKind || 'none'}
                onValueChange={(value) => setMailKind(value === 'none' ? '' : (value as RecruitMailKind))}
              >
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不发送</SelectItem>
                  {RECRUIT_MAIL_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {MAIL_OPTION_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={!mailKind}
                onClick={() => {
                  if (mailKind) demo.sendMail(app.id, mailKind)
                }}
              >
                <Send className="h-3.5 w-3.5" /> 发送
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {mailKind ? DEMO_MAIL_META[mailKind].trigger : '选一封信补发给他'}
              </span>
            </div>
          </section>

          {/* 发信记录 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">发信记录</h3>
            {mails.length === 0 ? (
              <p className="text-xs text-muted-foreground">还没有给他发过信。</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {mails.map((mail) => (
                  <li key={mail.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">{demo.formatTime(mail.at)}</span>
                    <span className="font-medium">{mail.label}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{mail.subject}</span>
                    <span className={mail.ok ? 'text-emerald-700' : 'text-destructive'}>
                      {mail.ok ? '已发出' : `失败 ${mail.error}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 补发下拉里的信件名（与邮件日志里的叫法保持一致） */
const MAIL_OPTION_LABELS: Record<RecruitMailKind, string> = {
  written_invite: '笔试邀请函',
  interview_invite: '面试邀请函',
  interview_passed: '面试通过通知',
  offer: '正式成员邀请函',
  thanks_written: '感谢你参加笔试',
  thanks_interview: '感谢你参加面试',
  thanks_defense: '感谢你在预备期的付出',
}
