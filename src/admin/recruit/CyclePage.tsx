import { useEffect, useState } from 'react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { adminRunRecruitAuto, adminSaveRecruit } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { DEFAULT_RECRUIT_CYCLE, RECRUIT_PHASE_LABELS, type RecruitCycleConfig } from '@shared/recruit'
import { cn } from '@/lib/utils'
import { Loader2, Power, Save } from 'lucide-react'
import { toast } from 'sonner'
import { RecruitTabs } from './RecruitTabs'
import { useRecruitSettings } from './useRecruitSettings'

/**
 * 招新周期设置：整届的时间窗、自动流程参数，以及关闭本届。
 *
 * 往届存档刻意不在这里列出 —— 关闭时导出的 CSV 留在对象存储里，
 * 后台页面不体现（需要翻旧账直接去桶里找 `applications/archives/`）。
 */
export function CyclePage() {
  const { settings, loading, reload } = useRecruitSettings()
  const [draft, setDraft] = useState<RecruitCycleConfig>(DEFAULT_RECRUIT_CYCLE)
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    if (settings) setDraft(settings.cycle)
  }, [settings])

  const set = (patch: Partial<RecruitCycleConfig>) => setDraft((prev) => ({ ...prev, ...patch }))

  const save = async () => {
    setSaving(true)
    try {
      await adminSaveRecruit({ cycle: draft })
      toast.success('招新周期已保存', {
        description: '报名通道按填写的开始时间自动开启，无需手动初始化。',
      })
      reload()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const closeNow = async () => {
    setConfirmClose(false)
    setClosing(true)
    try {
      const result = await adminRunRecruitAuto({ task: 'close_cycle', force: true })
      toast.success('本届招新已关闭', {
        description: `归档 ${result.archive?.total ?? 0} 条记录，报名数据与报名表已清空。`,
      })
      reload()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '关闭失败')
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reload} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">招新周期与签到</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          填好时间窗即可 —— 到点自动开启报名，全部确认完毕或到转正截止时间自动关闭并归档清空。
        </p>
      </div>

      <div className="space-y-6">
        {/* 基本信息与报名窗口 */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">本届名称与报名窗口</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs">本届名称</Label>
              <Input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="如：2026 年秋季招新"
              />
              <p className="text-[11px] text-muted-foreground">会出现在邮件里，写成同学能看懂的名字</p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">报名开始时间</Label>
              <Input
                type="datetime-local"
                value={draft.applyStart}
                onChange={(e) => set({ applyStart: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">报名截止时间</Label>
              <Input
                type="datetime-local"
                value={draft.applyEnd}
                onChange={(e) => set({ applyEnd: e.target.value })}
              />
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            所有时间按**北京时间**理解（服务器在 UTC，已做换算，不用自己加减 8 小时）。
          </p>
        </section>

        {/* 各环节安排 */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">各环节安排（会写进邀请邮件）</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">笔试时间</Label>
              <Input type="datetime-local" value={draft.writtenAt} onChange={(e) => set({ writtenAt: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">笔试结束时间</Label>
              <Input
                type="datetime-local"
                value={draft.writtenEnd}
                onChange={(e) => set({ writtenEnd: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">用来判断谁没来（见下方宽限期）</p>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs">笔试地点 / 形式</Label>
              <Input
                value={draft.writtenPlace}
                onChange={(e) => set({ writtenPlace: e.target.value })}
                placeholder="如：实验楼 B203 机房 / 线上（链接另行通知）"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">面试时间</Label>
              <Input
                type="datetime-local"
                value={draft.interviewAt}
                onChange={(e) => set({ interviewAt: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">面试地点 / 形式</Label>
              <Input
                value={draft.interviewPlace}
                onChange={(e) => set({ interviewPlace: e.target.value })}
                placeholder="如：实验楼 B203 会议室"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">预备期开始</Label>
              <Input
                type="datetime-local"
                value={draft.defenseStart}
                onChange={(e) => set({ defenseStart: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">预备期结束（答辩）</Label>
              <Input
                type="datetime-local"
                value={draft.defenseEnd}
                onChange={(e) => set({ defenseEnd: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs">转正确认截止</Label>
              <Input
                type="datetime-local"
                value={draft.onboardDeadline}
                onChange={(e) => set({ onboardDeadline: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                到期仍未确认邀请的同学视为放弃；这也是本届自动关闭的时间点（邀请函链接同步失效）
              </p>
            </div>
          </div>
        </section>

        {/* 自动流程参数 */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">自动流程参数</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">缺考宽限期（小时）</Label>
              <Input
                type="number"
                value={String(draft.absentGraceHours)}
                onChange={(e) => set({ absentGraceHours: Number(e.target.value) || 0 })}
              />
              <p className="text-[11px] text-muted-foreground">笔试结束后这么久仍未签到，自动标记为「未参加」</p>
            </div>
            <div className="grid gap-3">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={draft.autoAbsent} onCheckedChange={(v) => set({ autoAbsent: v })} />
                自动标记缺考（关闭后只在「自动流程」页提醒）
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={draft.autoClose} onCheckedChange={(v) => set({ autoClose: v })} />
                自动关闭本届（全部确认或到转正截止时）
              </label>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">笔试晋级规则</Label>
              <Select
                value={draft.advanceRule}
                onValueChange={(value) => set({ advanceRule: value === 'score' ? 'score' : 'top' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">取前 N 名</SelectItem>
                  <SelectItem value="score">分数不低于分数线</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              {draft.advanceRule === 'top' ? (
                <>
                  <Label className="text-xs">晋级人数 N</Label>
                  <Input
                    type="number"
                    value={String(draft.advanceTop)}
                    onChange={(e) => set({ advanceTop: Number(e.target.value) || 0 })}
                  />
                  <p className="text-[11px] text-muted-foreground">按笔试成绩从高到低取前 N 名</p>
                </>
              ) : (
                <>
                  <Label className="text-xs">分数线</Label>
                  <Input
                    type="number"
                    value={String(draft.advanceScore)}
                    onChange={(e) => set({ advanceScore: Number(e.target.value) || 0 })}
                  />
                  <p className="text-[11px] text-muted-foreground">成绩不低于这个分数的同学进入面试</p>
                </>
              )}
            </div>
          </div>
        </section>

        {/* 关闭本届 */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold">关闭本届</h2>
          <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">
            关闭会**先导出一份完整名单 CSV 存进对象存储**（作为清空前的留底，后台不再列出往届存档），
            然后清空报名数据、报名表文件与发信日志。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={closing || settings?.phase === 'closed'}
              onClick={() => setConfirmClose(true)}
            >
              {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} 立即关闭本届
            </Button>
            {settings?.phase === 'closed' && (
              <Button
                variant="outline"
                onClick={() => {
                  set({ closedAt: '', forceClosed: false })
                  toast.info('已清空「已关闭」标记，记得点保存后才会生效')
                }}
              >
                重新开启报名（清空关闭标记）
              </Button>
            )}
          </div>
        </section>

        <div className="flex items-center justify-between gap-4 pb-6">
          <span className="text-xs text-muted-foreground">
            当前状态：{[RECRUIT_PHASE_LABELS[settings?.phase ?? 'not_configured']]}
          </span>
          <Button onClick={() => void save()} disabled={saving} className={cn('gap-1.5')}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存周期设置
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认立即关闭本届招新？</AlertDialogTitle>
            <AlertDialogDescription>
              会先把本届全部报名记录导出为 CSV 存档（可在上方下载），然后
              <strong className="mx-1">清空报名数据、报名表文件与发信日志</strong>
              ，且无法撤销。尚未确认邀请的同学会被记为「未确认」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void closeNow()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
