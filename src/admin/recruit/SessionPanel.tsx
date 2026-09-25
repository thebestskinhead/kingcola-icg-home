import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  adminCreateSession,
  adminDeleteSession,
  adminIssueCheckinToken,
  adminListSessions,
  adminRevokeCheckinTokens,
  adminUpdateSession,
  type AdminCheckinCode,
  type AdminSession,
} from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { SESSION_STAGE_LABELS, type CheckinStage } from '@shared/recruit'
import { cn } from '@/lib/utils'
import { Ban, Copy, Loader2, MapPin, Plus, QrCode, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { OperationCard } from './StageKit'

const EMPTY_FORM = { name: '', startsAt: '', endsAt: '', place: '', note: '' }

function expiryText(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ''
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 场次与签到二维码。
 *
 * 采用**开放参加制**：邀请函列出全部场次，同学现场任选一场，所以不需要预先给人排场次 ——
 * 这里只管「这场什么时候、在哪、来了多少人」以及「这场的签到码是哪个」。
 *
 * 二维码指向 `/checkin/<token>`，token 绑场次并带失效时间；**重新生成会让旧码立即失效**，
 * 因为二维码会被拍照转发，重发往往正是因为旧码泄了。
 */
export function SessionPanel({ stage, onChanged }: { stage: CheckinStage; onChanged?: () => void }) {
  const stageLabel = SESSION_STAGE_LABELS[stage]

  const [sessions, setSessions] = useState<AdminSession[]>([])
  const [codes, setCodes] = useState<AdminCheckinCode[]>([])
  const [busy, setBusy] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<string>('')
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [pendingDelete, setPendingDelete] = useState<AdminSession | null>(null)
  const [issuing, setIssuing] = useState('')
  const [showQr, setShowQr] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const payload = await adminListSessions()
      setSessions(payload.sessions.filter((session) => session.stage === stage))
      setCodes(payload.codes.filter((code) => code.stage === stage))
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '场次加载失败')
    } finally {
      setBusy(false)
    }
  }, [stage])

  useEffect(() => {
    void load()
  }, [load])

  const codeOf = (sessionId: string) => codes.find((code) => code.sessionId === sessionId)

  const create = async () => {
    if (!form.startsAt.trim()) return toast.error('请填写开始时间')
    setSaving(true)
    try {
      await adminCreateSession({ stage, ...form })
      setForm(EMPTY_FORM)
      setAdding(false)
      toast.success('场次已添加', { description: '笔试邀请函里会自动列出全部场次。' })
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '添加失败')
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async (id: string) => {
    setSaving(true)
    try {
      await adminUpdateSession(id, editForm)
      setEditing('')
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (session: AdminSession) => {
    try {
      await adminDeleteSession(session.id)
      toast.success(`已删除「${session.label}」`, { description: '该场的签到二维码已一并作废。' })
      setPendingDelete(null)
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '删除失败')
    }
  }

  const issue = async (session: AdminSession) => {
    setIssuing(session.id)
    try {
      const issued = await adminIssueCheckinToken(session.id)
      toast.success('签到二维码已生成', {
        description: `有效至 ${expiryText(issued.expiresAt)}，旧码已自动作废。`,
      })
      setShowQr(session.id)
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '生成失败')
    } finally {
      setIssuing('')
    }
  }

  const revoke = async (sessionId: string) => {
    try {
      const result = await adminRevokeCheckinTokens(sessionId)
      toast.success(`已作废 ${result.revoked} 张二维码`)
      setShowQr('')
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '作废失败')
    }
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('签到链接已复制')
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  const totalCheckin = sessions.reduce((sum, session) => sum + session.checkinCount, 0)

  const formFields = (
    values: typeof EMPTY_FORM,
    onChange: (next: typeof EMPTY_FORM) => void,
  ) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label className="text-xs">场次名</Label>
        <Input
          className="h-9"
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          placeholder={`如「第一场」「上午场」，留空自动编号`}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">地点 / 形式</Label>
        <Input
          className="h-9"
          value={values.place}
          onChange={(e) => onChange({ ...values, place: e.target.value })}
          placeholder="如一教 305 / 腾讯会议 123-456-789"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">开始时间 *</Label>
        <Input
          className="h-9"
          value={values.startsAt}
          onChange={(e) => onChange({ ...values, startsAt: e.target.value })}
          placeholder="2026-10-08T14:00"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">结束时间</Label>
        <Input
          className="h-9"
          value={values.endsAt}
          onChange={(e) => onChange({ ...values, endsAt: e.target.value })}
          placeholder="2026-10-08T16:00"
        />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label className="text-xs">备注</Label>
        <Input
          className="h-9"
          value={values.note}
          onChange={(e) => onChange({ ...values, note: e.target.value })}
          placeholder="会写进邀请函，如「请自带电脑」"
        />
      </div>
    </div>
  )

  return (
    <OperationCard
      title={`${stageLabel}场次与签到二维码`}
      description="邀请函会列出全部场次，同学现场任选一场；二维码贴在考场，扫码填姓名 + 学号即签到。"
      badge={sessions.length}
      defaultOpen={sessions.length === 0}
      onReload={() => void load()}
      reloading={busy}
      actions={
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding((prev) => !prev)}>
          <Plus className="h-3.5 w-3.5" /> 添加场次
        </Button>
      }
    >
      {adding && (
        <div className="space-y-3 border-b border-border bg-secondary/30 px-5 py-4">
          {formFields(form, setForm)}
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => void create()} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} 保存场次
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false)
                setForm(EMPTY_FORM)
              }}
            >
              取消
            </Button>
            <span className="text-[11px] text-muted-foreground">
              时间按北京时间填，格式 2026-10-08T14:00
            </span>
          </div>
        </div>
      )}

      <div className="divide-y divide-border">
        {sessions.map((session) => {
          const code = codeOf(session.id)
          const isEditing = editing === session.id
          return (
            <div key={session.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {session.label}
                    {!session.timeText && (
                      <span className="text-xs text-muted-foreground">（时间待补）</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {session.timeText && <span>{session.timeText}</span>}
                    {session.place && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {session.place}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      已签到 {session.checkinCount} 人
                    </span>
                  </div>
                  {session.note && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">备注：{session.note}</div>
                  )}
                  {code && (
                    <div className="mt-1 text-[11px] text-emerald-700">
                      签到码有效至 {expiryText(code.expiresAt)}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {code ? (
                    <>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowQr(showQr === session.id ? '' : session.id)}>
                        <QrCode className="h-3.5 w-3.5" /> {showQr === session.id ? '收起二维码' : '看二维码'}
                      </Button>
                      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void copy(code.url)}>
                        <Copy className="h-3.5 w-3.5" /> 复制链接
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        onClick={() => void issue(session)}
                        disabled={issuing === session.id}
                      >
                        {issuing === session.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <QrCode className="h-3.5 w-3.5" />
                        )}
                        重发（旧码作废）
                      </Button>
                      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void revoke(session.id)}>
                        <Ban className="h-3.5 w-3.5" /> 作废
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className="gap-1.5" onClick={() => void issue(session)} disabled={issuing === session.id}>
                      {issuing === session.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <QrCode className="h-3.5 w-3.5" />
                      )}
                      生成二维码
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(isEditing ? '' : session.id)
                      setEditForm({
                        name: session.name,
                        startsAt: session.startsAt,
                        endsAt: session.endsAt,
                        place: session.place,
                        note: session.note,
                      })
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setPendingDelete(session)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {code && showQr === session.id && (
                <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg bg-secondary/40 p-4">
                  {/* 二维码要印出来给手机扫，编码的是绝对地址 */}
                  <div className="rounded-lg bg-white p-2">
                    <QRCodeSVG value={code.url} size={148} level="M" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      同学扫码后进入签到页，填报名时用的姓名 + 学号即可。二维码可直接截图打印或投屏。
                    </p>
                    <code className="mt-2 block truncate text-[11px] text-foreground/70">{code.url}</code>
                  </div>
                </div>
              )}

              {isEditing && (
                <div className="mt-3 space-y-3 rounded-lg bg-secondary/40 p-4">
                  {formFields(editForm, setEditForm)}
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => void saveEdit(session.id)} disabled={saving}>
                      保存修改
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing('')}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {sessions.length === 0 && (
          <div className={cn('px-5 py-10 text-center text-sm text-muted-foreground', busy && 'opacity-60')}>
            {busy ? '正在读取…' : `还没有${stageLabel}场次。先添加场次，邀请函才能写清时间地点。`}
          </div>
        )}
      </div>

      {sessions.length > 0 && (
        <div className="border-t border-border px-5 py-2.5 text-[11px] text-muted-foreground">
          共 {sessions.length} 场，累计签到 {totalCheckin} 人。同一个阶段可以有多场，同学任选一场参加。
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{pendingDelete?.label}」？</AlertDialogTitle>
            <AlertDialogDescription>
              该场次的签到二维码会一并作废；已经扫过码的同学，签到时间保留，但不再归属这一场。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && void remove(pendingDelete)}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OperationCard>
  )
}
