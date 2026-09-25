/**
 * 招新后台（当前挂在 `/admin/recruit`）。
 *
 * ⚠️ 这一版**全部是假数据**，交互只改本地状态、不发任何请求 —— 先把信息架构与功能定下来，
 * 之后再逐块把真接口接进来（旧实现在 `backup/recruit-legacy/`，接线时照着搬）。
 *
 * 本文件只负责「流程」视图与顶层切换：
 *   流程 / 名单 / 邮件日志 / 设置，四个视图共用 `useDemoRecruit` 里的同一份状态。
 *
 * 流程视图是**事件驱动**的：整届没有任何时间字段。
 *   顶部时间线（当前阶段高亮，未来阶段可看但锁定）
 *   → 阶段页 = 摘要条 + 【进行中】/【结束后】两块面板 + 数据区。
 * 每个事件都是「进行中 → 结束（手动，顺带收尾，二次确认）→ 结束后」；
 * 报名的结束拆成「结束报名」与「确认名单」两个动作。
 * 阶段的开与关完全由管理员点按钮决定；时间地点一律通过对应的 QQ 群通知，邮件里不出现。
 */

import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { cn } from '@/lib/utils'
import {
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Lock,
  Mail,
  Moon,
  QrCode,
  RotateCcw,
  Save,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  appStatusLabel,
  parseScore,
  QQ_GROUPS,
  scoreFieldOf,
  STAGE_LABEL,
  STEP,
  stageOfStep,
  stepToStage,
  TIMELINE,
  type MockApp,
  type QrStage,
  type StageKey,
  type TopView,
} from './demo-model'
import { DemoMailPage } from './DemoMailPage'
import { DemoRosterPage } from './DemoRosterPage'
import { DemoSettingsPage } from './DemoSettingsPage'
import { useDemoRecruit } from './useDemoRecruit'

const TOP_VIEWS: ReadonlyArray<{ key: TopView; label: string }> = [
  { key: 'flow', label: '流程' },
  { key: 'roster', label: '名单' },
  { key: 'mails', label: '邮件日志' },
  { key: 'settings', label: '设置' },
]

export function DemoEventDrivenPage() {
  const demo = useDemoRecruit()

  // 未启动系统：整页只显示「休眠中」大屏 —— 时间线、其他视图都不可见
  if (!demo.started) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-border bg-card px-8 py-24 text-center">
          <Moon className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-6 font-display text-3xl font-bold">招新系统休眠中</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            当前没有任何进行中的招新周期，官网的报名入口处于关闭状态。
            点击下方按钮启动系统，开始一个新周期。
          </p>
          <Button size="lg" className="mt-10 gap-2" onClick={demo.startCycle}>
            <ArrowRight className="h-4 w-4" /> 启动系统，开始新的周期
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* ===== 顶层切换 ===== */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {TOP_VIEWS.map((view) => (
          <button
            key={view.key}
            onClick={() => demo.setTopView(view.key)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-xs transition-colors',
              demo.topView === view.key
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border text-foreground/70 hover:bg-secondary',
            )}
          >
            {view.label}
            {view.key === 'mails' && demo.mails.length > 0 && (
              <span className="ml-1.5 rounded-full bg-accent/20 px-1.5 text-[10px] text-accent">
                {demo.mails.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {demo.topView === 'roster' && <DemoRosterPage demo={demo} />}
      {demo.topView === 'mails' && <DemoMailPage demo={demo} />}
      {demo.topView === 'settings' && <DemoSettingsPage demo={demo} />}
      {demo.topView === 'flow' && <FlowView demo={demo} />}

      <AlertDialog open={demo.confirming !== null} onOpenChange={(open) => !open && demo.setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{demo.confirming?.title}</AlertDialogTitle>
            <AlertDialogDescription>{demo.confirming?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                demo.confirming?.run()
                demo.setConfirming(null)
              }}
            >
              确认执行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 流程视图
// ---------------------------------------------------------------------------

function FlowView({ demo }: { demo: ReturnType<typeof useDemoRecruit> }) {
  const { step, view, currentStage, selection, threshold, setSelection, setThreshold } = demo

  const selectionTools = (
    <div className="flex flex-wrap items-center gap-2">
      {step >= STEP.writtenEnded && (
        <>
          <Input
            className="h-8 w-24"
            value={threshold}
            inputMode="decimal"
            placeholder="分数线"
            onChange={(event) => setThreshold(event.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const value = parseScore(threshold)
              if (!Number.isFinite(value)) return toast.error('请先填分数线，如 60')
              const field = scoreFieldOf(stageOfStep(step))
              const picked = field
                ? demo.apps.filter(
                    (app) =>
                      app.stage === stageOfStep(step) &&
                      Number.isFinite(parseScore(app.scores[field])) &&
                      parseScore(app.scores[field]) >= value,
                  )
                : []
              setSelection(new Set(picked.map((app) => app.id)))
              toast.success(`已勾选 ${picked.length} 人`, { description: `成绩不低于 ${value} 分的同学` })
            }}
          >
            勾选不低于该分数
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          setSelection(new Set(demo.apps.filter((app) => app.stage === stageOfStep(step)).map((app) => app.id)))
        }
      >
        全选
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>
        清空
      </Button>
      <span className="text-[11px] text-muted-foreground">已勾选 {selection.size} 人</span>
    </div>
  )

  const renderAppRow = (
    app: MockApp,
    options: { checkbox?: boolean; checkin?: QrStage; score?: QrStage; note?: QrStage } = {},
  ) => (
    <TableRow key={app.id}>
      {options.checkbox && (
        <TableCell>
          <input
            type="checkbox"
            className="h-4 w-4 accent-[hsl(var(--accent))]"
            checked={selection.has(app.id)}
            onChange={() =>
              setSelection((prev) => {
                const next = new Set(prev)
                if (next.has(app.id)) next.delete(app.id)
                else next.add(app.id)
                return next
              })
            }
            aria-label={`选择 ${app.name}`}
          />
        </TableCell>
      )}
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
      <TableCell className="text-xs text-muted-foreground">{app.email || '—'}</TableCell>
      <TableCell className="text-xs">{appStatusLabel(app)}</TableCell>
      {options.checkin && (
        <TableCell className="text-xs">
          {app.checkins[options.checkin] ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Check className="h-3.5 w-3.5" /> 已签到
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() => demo.bulkCheckin([app.id])}
            >
              <Check className="h-3 w-3" /> {app.result === 'absent' ? '补签（撤销缺考）' : '补签'}
            </Button>
          )}
        </TableCell>
      )}
      {options.score && (
        <TableCell>
          <Input
            className="h-8 w-20"
            value={app.scores[options.score]}
            placeholder="如 78"
            onChange={(event) =>
              demo.patch(app.id, {
                scores: { ...app.scores, [options.score as QrStage]: event.target.value },
              })
            }
          />
        </TableCell>
      )}
      {options.note && (
        <TableCell>
          <Input
            className="h-8"
            value={app.notes[options.note]}
            placeholder={options.note === 'interview' ? '面试评语' : '阅卷备注'}
            onChange={(event) =>
              demo.patch(app.id, {
                notes: { ...app.notes, [options.note as QrStage]: event.target.value },
              })
            }
          />
        </TableCell>
      )}
      <TableCell className="text-right">
        {step === STEP.applyOngoing && app.result === '' && (
          <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => demo.markRejected(app)}>
            <Ban className="h-3.5 w-3.5" /> 未通过初筛
          </Button>
        )}
      </TableCell>
    </TableRow>
  )

  const panel = (
    title: string,
    hint: string,
    children: React.ReactNode,
    tone: 'ongoing' | 'after' = 'ongoing',
  ) => (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px]',
            tone === 'ongoing' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-accent/15 text-accent',
          )}
        >
          {tone === 'ongoing' ? '进行中' : '结束后'}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  )

  const endAction = (title: string, body: string, run: () => void, label: string) => (
    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-amber-700">{body}</p>
      <Button className="mt-3 gap-1.5" onClick={() => demo.ask(title, body, run)}>
        <ArrowRight className="h-4 w-4" /> {label}
      </Button>
    </section>
  )

  const roster = (
    stage: StageKey,
    options: { checkbox?: boolean; checkin?: boolean; score?: boolean; note?: boolean } = {},
  ) => {
    const list = demo.stageApps(stage)
    const field = scoreFieldOf(stage)
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> {STAGE_LABEL[stage]}阶段共{' '}
            <strong className="text-foreground">{list.length}</strong> 人
          </span>
          <span>要搜人 / 导出 / 批量处理，去「名单」视图</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {options.checkbox && <TableHead className="w-12">勾选</TableHead>}
              <TableHead className="w-44">报名人</TableHead>
              <TableHead>联系方式</TableHead>
              <TableHead className="w-28">状态</TableHead>
              {options.checkin && field && <TableHead className="w-28">签到</TableHead>}
              {options.score && field && <TableHead className="w-24">成绩</TableHead>}
              {options.note && field && <TableHead className="w-52">评语 / 备注</TableHead>}
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((app) =>
              renderAppRow(app, {
                checkbox: options.checkbox,
                checkin: options.checkin && field ? field : undefined,
                score: options.score && field ? field : undefined,
                note: options.note && field ? field : undefined,
              }),
            )}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  这个阶段还没有人
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    )
  }

  /**
   * 签到二维码卡片（只出现在「进行时」面板）。
   * 二维码只绑阶段、带自选有效期；生成新码会自动作废该阶段旧码；可手动作废。
   */
  const qrCard = (stage: QrStage, label: string) => {
    const code = demo.codes[stage]
    return (
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700">进行中</span>
          <h3 className="text-sm font-semibold">{label}签到二维码</h3>
          <span className="text-[11px] text-muted-foreground">考试开始前再生成即可，不会提前生成</span>
        </div>
        <div className="px-5 py-4">
          {code ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg bg-secondary/40 p-4">
              <div className="rounded-lg bg-white p-2">
                <QRCodeSVG value={`${location.origin}/checkin/${code.token}`} size={128} level="M" />
              </div>
              <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                有效至 <strong className="text-foreground">{code.expiresAt}</strong>
                <br />
                同学扫码进入签到页，填报名时的姓名 + 学号即可签到（签的就是{label}这一场）。
              </div>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => demo.issueCode(stage)}>
                <RotateCcw className="h-3.5 w-3.5" /> 重新生成（旧码作废）
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => demo.revokeCode(stage)}>
                <Ban className="h-3.5 w-3.5" /> 作废
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-32"
                value={demo.ttlDraft[stage] ?? ''}
                inputMode="numeric"
                placeholder="有效期（小时）"
                onChange={(event) => demo.setTtlDraft((prev) => ({ ...prev, [stage]: event.target.value }))}
              />
              <Button size="sm" className="gap-1" onClick={() => demo.issueCode(stage)}>
                <QrCode className="h-3.5 w-3.5" /> 生成签到二维码
              </Button>
              <span className="text-[11px] text-muted-foreground">
                不提前生成；生成新码会自动作废旧码，同一阶段同时只有一张有效。
              </span>
            </div>
          )}
        </div>
      </section>
    )
  }

  const stageBody = () => {
    if (view !== currentStage) {
      const isPast =
        TIMELINE.findIndex((node) => node.key === view) <
        TIMELINE.findIndex((node) => node.key === currentStage)
      return (
        <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-display text-xl font-bold">
            {isPast ? `「${STAGE_LABEL[view]}」已走过` : `「${STAGE_LABEL[view]}」还没到`}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isPast
              ? '这一段已经结束，可在「名单」里回看每个人的走向。'
              : '按顺序走完前面的阶段后，这里会自动解锁。'}
          </p>
          <Button variant="outline" className="mt-5" onClick={() => demo.setViewing('auto')}>
            回到当前阶段（{STAGE_LABEL[currentStage]}）
          </Button>
        </div>
      )
    }

    switch (step) {
      case STEP.prepare:
        return (
          <div className="space-y-4">
            {panel(
              '备招 · 名称与四个 QQ 群',
              '没有任何时间字段 —— 报名何时开始，由你点下面的按钮决定',
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">本届名称</Label>
                    <Input
                      value={demo.cycleName}
                      onChange={(event) => demo.setCycleName(event.target.value)}
                    />
                  </div>
                  {QQ_GROUPS.map((group) => (
                    <div key={group.key} className="grid gap-1.5">
                      <Label className="text-xs">{group.label}群号</Label>
                      <Input
                        inputMode="numeric"
                        value={demo.groups[group.key]}
                        placeholder="如 123456789"
                        onChange={(event) =>
                          demo.setGroups({ ...demo.groups, [group.key]: event.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => demo.saveGroups(demo.cycleName, demo.groups)}
                  >
                    <Save className="h-3.5 w-3.5" /> 保存名称与群号
                  </Button>
                  <span className="text-[11px] leading-relaxed text-muted-foreground">
                    每封邀请函只引导进自己对应的那一个群；所有时间与地点安排都在 QQ 群里通知，邮件里不再出现。
                    群号之后也可以在「设置」里改。
                  </span>
                </div>
              </>,
            )}
            <Button className="gap-1.5" onClick={demo.openApply}>
              <CheckCircle2 className="h-4 w-4" /> 开启报名
            </Button>
          </div>
        )

      case STEP.applyOngoing:
        return (
          <div className="space-y-4">
            <RecruitForm demo={demo} />
            {endAction(
              '结束报名',
              '报名入口将关闭（不再收表 / 替换）；名单仍可调整（补录 / 剔除 / 删除），确认名单后才发邀请函。不发信。',
              demo.endApply,
              '结束报名',
            )}
          </div>
        )

      case STEP.applyEnded:
        return (
          <div className="space-y-4">
            {panel(
              '确认笔试名单',
              '勾选进入笔试的人；未勾选的判「未通过初筛」（不发信，名单里留痕）',
              <>
                {selectionTools}
                {roster('apply', { checkbox: true })}
                <Button
                  className="gap-1.5"
                  onClick={() => demo.confirmWrittenList([...selection])}
                  disabled={selection.size === 0}
                >
                  <Check className="h-4 w-4" /> 确认名单并发出笔试邀请函（{selection.size} 人）
                </Button>
              </>,
              'after',
            )}
          </div>
        )

      case STEP.writtenOngoing:
        return (
          <div className="space-y-4">
            {qrCard('written', '笔试')}
            {panel(
              '现场',
              '签到 / 补签 / 补录都在这里；此时看不到成绩入口 —— 还没结束笔试',
              <>
                <WrittenWalkInDialog demo={demo} />
                {roster('written', { checkin: true })}
              </>,
            )}
            {endAction(
              '结束笔试',
              '将自动把未签到的同学标记为「缺考」（不发信），然后解锁成绩录入与面试名单。',
              demo.endWritten,
              '结束笔试',
            )}
          </div>
        )

      case STEP.writtenEnded:
        return (
          <div className="space-y-4">
            {panel(
              '标记缺考',
              '结束笔试时已自动处理；漏签的可以补签救回',
              <p className="text-xs text-muted-foreground">
                未签到 {demo.stageApps('written').filter((app) => app.result === 'absent').length} 人已标记「缺考」。
                在下面的名单里点「补签」即可撤销缺考（人确实来过就不该被刷掉）。
              </p>,
              'after',
            )}
            {panel(
              '录入笔试成绩',
              '名次实时排好，便于判断分数线切在哪；漏签的也能在这里补签',
              roster('written', { score: true, note: true, checkin: true }),
              'after',
            )}
            {panel(
              '生成面试名单',
              '勾选晋级的人；未勾选的判未通过并发感谢信',
              <>
                {selectionTools}
                {roster('written', { checkbox: true, score: true })}
                <Button
                  className="gap-1.5"
                  onClick={() => demo.advanceWritten([...selection])}
                  disabled={selection.size === 0}
                >
                  <Check className="h-4 w-4" /> 确认面试名单并发出通知（{selection.size} 人晋级）
                </Button>
              </>,
              'after',
            )}
          </div>
        )

      case STEP.interviewOngoing:
        return (
          <div className="space-y-4">
            {qrCard('interview', '面试')}
            {panel('现场', '签到与补签（面试阶段没有补录 —— 补录只发生在笔试）', roster('interview', { checkin: true }))}
            {endAction(
              '结束面试',
              '将自动把未签到的同学标记为「缺考」，然后解锁评语与录取确认。',
              demo.endInterview,
              '结束面试',
            )}
          </div>
        )

      case STEP.interviewEnded:
        return (
          <div className="space-y-4">
            {panel(
              '录入面试评语',
              '评语留给自己人看，不发给学生；漏签的也能在这里补签',
              roster('interview', { score: true, note: true, checkin: true }),
              'after',
            )}
            {panel(
              '确认录取',
              '勾选录取的人；未勾选的判未通过并发感谢信',
              <>
                {selectionTools}
                {roster('interview', { checkbox: true, score: true })}
                <Button
                  className="gap-1.5"
                  onClick={() => demo.confirmInterview([...selection])}
                  disabled={selection.size === 0}
                >
                  <Check className="h-4 w-4" /> 确认录取名单（{selection.size} 人进预备期）
                </Button>
              </>,
              'after',
            )}
          </div>
        )

      case STEP.defenseOngoing:
        return (
          <div className="space-y-4">
            {panel(
              '预备期',
              '这段没有要操作的：大家在项目里干活，答辩安排在预备成员群里通知',
              <p className="text-xs text-muted-foreground">
                预备期无事可做是正常状态 —— 不用反复刷新找按钮。
              </p>,
            )}
            {qrCard('defense', '答辩')}
            {panel('现场', '答辩签到与补签', roster('defense', { checkin: true }))}
            {endAction(
              '结束答辩',
              '将自动把未签到的同学标记为「缺考」，然后解锁成绩与最终名单。',
              demo.endDefense,
              '结束答辩',
            )}
          </div>
        )

      case STEP.defenseEnded:
        return (
          <div className="space-y-4">
            {panel(
              '录入答辩成绩',
              '答辩成绩决定最终名单；漏签的也能在这里补签',
              roster('defense', { score: true, note: true, checkin: true }),
              'after',
            )}
            {panel(
              '确认最终名单',
              '勾选通过的人；通过者收到正式邀请函（一次性链接，免登录填信息进成员表）',
              <>
                {selectionTools}
                {roster('defense', { checkbox: true, score: true })}
                <Button
                  className="gap-1.5"
                  onClick={() => demo.confirmDefense([...selection])}
                  disabled={selection.size === 0}
                >
                  <Check className="h-4 w-4" /> 确认答辩结果（{selection.size} 人转正）
                </Button>
              </>,
              'after',
            )}
          </div>
        )

      case STEP.onboard:
        return (
          <div className="space-y-4">
            {panel(
              '等本人确认',
              '同学点开邀请函里的链接、填完成员信息就自动进成员表；学生端不提供拒绝',
              <div className="space-y-2">
                {demo.stageApps('onboard').map((app) => (
                  <div
                    key={app.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{app.name}</div>
                      <div className="text-xs text-muted-foreground">{app.studentId}</div>
                    </div>
                    {app.invitedAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 邀请函已发，等确认
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">未发</span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => demo.ask('催确认', `给 ${app.name} 再发一封提醒邮件？`, () => demo.sendMail(app.id, 'offer'))}
                    >
                      <Mail className="h-3.5 w-3.5" /> 催确认
                    </Button>
                  </div>
                ))}
              </div>,
            )}
            {endAction(
              '关闭本届',
              '先导出完整名单 CSV 留底（后台不列往届存档），然后清空报名数据、报名表文件与发信日志。',
              demo.closeCycle,
              '关闭本届',
            )}
          </div>
        )

      default:
        return (
          <div className="space-y-4">
            {panel(
              '本届总结',
              '归档后招新模块收起，官网回到正常状态',
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: '报名人数', value: demo.apps.length },
                  {
                    label: '最终转正',
                    value: demo.stageApps('onboard').filter((app) => app.result !== 'failed').length,
                  },
                  {
                    label: '中途退出/淘汰',
                    value: demo.apps.filter((app) => app.result === 'failed' || app.result === 'absent').length,
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-border px-4 py-3">
                    <div className="text-2xl font-bold">{item.value}</div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>,
              'after',
            )}
            {panel(
              '存档',
              '下载即收尾：文件下完自动回到休眠，本届也就结束了（页面刻意不列往届存档）',
              <Button size="sm" variant="outline" onClick={demo.downloadArchive}>
                下载本届名单 CSV
              </Button>,
              'after',
            )}
            <Button variant="outline" className="gap-1.5" onClick={demo.resetDemo}>
              <RotateCcw className="h-4 w-4" /> 重置演示，回到休眠
            </Button>
          </div>
        )
    }
  }

  return (
    <>
      {/* ===== 顶部时间线 ===== */}
      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max items-stretch gap-1">
          {TIMELINE.map((node, index) => {
            const nodeIndex = TIMELINE.findIndex((item) => item.key === stepToStage(step))
            const isCurrent = node.key === currentStage
            const isPast = index < nodeIndex
            const isFuture = index > nodeIndex
            return (
              <button
                key={node.key}
                onClick={() => demo.setViewing(node.key)}
                className={cn(
                  'min-w-28 flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  isCurrent
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : isPast
                      ? 'border-border bg-card hover:bg-secondary'
                      : 'border-dashed border-border text-muted-foreground',
                )}
              >
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  {isPast && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                  {isFuture && <Lock className="h-3 w-3" />}
                  {node.label}
                  {isCurrent && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[10px]">当前</span>}
                </div>
                <div
                  className={cn(
                    'mt-0.5 text-[10px] leading-snug',
                    isCurrent ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {node.hint}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ===== 摘要条（原看板职责，收成一条） ===== */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-5 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Clock className="h-3.5 w-3.5 text-accent" /> 当前：{STAGE_LABEL[currentStage]}
          {step % 2 === 1 && step !== 9 ? ' · 进行中' : step !== 0 ? ' · 已结束，待收尾' : ''}
        </span>
        {demo.funnel.map((item) => (
          <span key={item.label} className="text-muted-foreground">
            {item.label} <strong className="text-foreground">{item.value}</strong>
          </span>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-1 text-xs"
          onClick={() => demo.setTopView('settings')}
        >
          <Settings2 className="h-3.5 w-3.5" /> 邮件与群号
        </Button>
        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={demo.resetDemo}>
          <RotateCcw className="h-3.5 w-3.5" /> 重置演示
        </Button>
      </div>

      {/* ===== 阶段标题 ===== */}
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">{STAGE_LABEL[view]}阶段</h1>
        <p className="mt-1 text-sm text-muted-foreground">{TIMELINE.find((node) => node.key === view)?.hint}</p>
      </div>

      {stageBody()}
    </>
  )
}

/** 报名阶段的补录：不要求报名表，联系方式也都可以后补 */
function RecruitForm({ demo }: { demo: ReturnType<typeof useDemoRecruit> }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', studentId: '', email: '', phone: '', qq: '' })

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" /> 补录未报名考生
        </Button>
        <span className="text-[11px] text-muted-foreground">
          同一学号重复提交 = 替换材料并删除旧文件（此处模拟为新增记录）。
        </span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>补录未报名考生</DialogTitle>
            <DialogDescription>人已经站在考场里了：不要求报名表，联系方式缺什么后补。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">姓名</Label>
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">学号</Label>
              <Input
                value={form.studentId}
                onChange={(event) => setForm({ ...form, studentId: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">邮箱（选填）</Label>
              <Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">手机（选填）</Label>
              <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">QQ（选填）</Label>
              <Input value={form.qq} onChange={(event) => setForm({ ...form, qq: event.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              className="gap-1.5"
              disabled={!form.name.trim() || !form.studentId.trim()}
              onClick={() => {
                demo.addApplicant(form)
                setForm({ name: '', studentId: '', email: '', phone: '', qq: '' })
                setOpen(false)
              }}
            >
              <UserPlus className="h-4 w-4" /> 确认补录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 笔试阶段的补录：这是「没赶上报名、但带着报名表来考试」的人，所以联系方式与报名表都要收齐 */
function WrittenWalkInDialog({ demo }: { demo: ReturnType<typeof useDemoRecruit> }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', studentId: '', email: '', phone: '', qq: '', fileName: '' })

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" /> 补录考生
        </Button>
        <span className="text-[11px] text-muted-foreground">
          给没赶上报名但来考了、且带报名表的人：邮箱 / 手机 / QQ / 报名表全部必填，录入即视为已参加（无需签到）。
        </span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>补录考生（笔试现场）</DialogTitle>
            <DialogDescription>
              录入即视为已参加笔试，不会被缺考扫描误伤；后续照常录成绩、进面试名单。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">姓名</Label>
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">学号</Label>
              <Input
                value={form.studentId}
                onChange={(event) => setForm({ ...form, studentId: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">邮箱</Label>
              <Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">手机</Label>
              <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">QQ</Label>
              <Input value={form.qq} onChange={(event) => setForm({ ...form, qq: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">报名表（PDF / DOCX）</Label>
              <Input
                type="file"
                accept=".pdf,.docx"
                className="h-9 text-xs"
                onChange={(event) => setForm({ ...form, fileName: event.target.files?.[0]?.name ?? '' })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              className="gap-1.5"
              disabled={
                !form.name.trim() ||
                !form.studentId.trim() ||
                !form.email.trim() ||
                !form.phone.trim() ||
                !form.qq.trim() ||
                !form.fileName
              }
              onClick={() => {
                demo.addWrittenApplicant(form)
                setForm({ name: '', studentId: '', email: '', phone: '', qq: '', fileName: '' })
                setOpen(false)
              }}
            >
              <UserPlus className="h-4 w-4" /> 确认补录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
