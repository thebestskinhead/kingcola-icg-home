/**
 * ⚠️ 临时 DEMO —— 与任何真实数据无关，确认交互后整个文件连同路由一起删除。
 *
 * 这页 mock 的是「事件驱动」的招新后台信息架构：
 *   顶部时间线（当前阶段高亮，未来阶段可看但锁定）→ 阶段页 = 摘要条 + 【进行中】/【结束后】两块面板 + 数据区。
 * 每个事件都是「配置 → 进行中 → 结束（手动，顺带收尾，二次确认）→ 结束后」四段；
 * 报名的结束拆成「结束报名」与「确认名单」两个动作。
 *
 * 所有交互都只改本组件内的假状态，不发任何请求。
 */

import { useMemo, useState } from 'react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Lock,
  QrCode,
  RotateCcw,
  UserPlus,
  Users,
} from 'lucide-react'
import { RECRUIT_MAIL_KINDS, RECRUIT_MAIL_META, type RecruitMailKind } from '@shared/recruit'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// 假数据模型
// ---------------------------------------------------------------------------

type StageKey = 'apply' | 'written' | 'interview' | 'defense' | 'onboard'
type StageKeyOrArchive = StageKey | 'archive' | 'prepare'

interface MockApp {
  id: string
  name: string
  studentId: string
  email: string
  source: 'web' | 'manual'
  stage: StageKey
  result: string
  scores: { written: string; interview: string; defense: string }
  checkins: { written: boolean; interview: boolean; defense: boolean }
  invited: boolean
}

/** 签到二维码只绑阶段（不绑场次 —— 场次概念已整体删除） */
type QrStage = 'written' | 'interview' | 'defense'

/** 每个阶段同时至多一张有效码；生成新码会自动作废旧码 */
interface ActiveCode {
  token: string
  expiresAt: string
}

const INITIAL_APPS: MockApp[] = [
  {
    id: 'a', name: '冒烟甲', studentId: 'SMA2026001', email: 'a@example.edu.cn', source: 'web',
    stage: 'apply', result: '', scores: { written: '', interview: '', defense: '' },
    checkins: { written: false, interview: false, defense: false }, invited: false,
  },
  {
    id: 'b', name: '冒烟乙', studentId: 'SMB2026002', email: 'b@example.edu.cn', source: 'web',
    stage: 'apply', result: '', scores: { written: '', interview: '', defense: '' },
    checkins: { written: false, interview: false, defense: false }, invited: false,
  },
  {
    id: 'c', name: '冒烟丙', studentId: 'SMC2026003', email: 'c@example.edu.cn', source: 'web',
    stage: 'apply', result: '', scores: { written: '', interview: '', defense: '' },
    checkins: { written: false, interview: false, defense: false }, invited: false,
  },
]

const INITIAL_CODES: Record<QrStage, ActiveCode | null> = {
  written: null,
  interview: null,
  defense: null,
}

/** 四个 QQ 群：每封邀请函只引导进自己对应的那一个 */
const QQ_GROUPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'writtenGroup', label: '笔试通知群' },
  { key: 'interviewGroup', label: '面试通知群' },
  { key: 'probationGroup', label: '预备成员群' },
  { key: 'formalGroup', label: '正式成员群' },
]

/** 时间线节点（顺序即流程） */
const TIMELINE: ReadonlyArray<{ key: StageKeyOrArchive; label: string; hint: string }> = [
  { key: 'prepare', label: '备招', hint: '填名称与 QQ 群号 · 手动开启报名' },
  { key: 'apply', label: '报名', hint: '收表 · 替换 · 补录 · 剔除' },
  { key: 'written', label: '笔试', hint: '二维码/补签/补录 → 结束后录成绩、定面试名单' },
  { key: 'interview', label: '面试', hint: '二维码/补签 → 结束后评语、确认录取' },
  { key: 'defense', label: '答辩', hint: '二维码/补签 → 结束后定最终名单' },
  { key: 'onboard', label: '转正', hint: '等本人确认加入' },
  { key: 'archive', label: '归档', hint: '导出存档 · 清空' },
]

/**
 * 流程步进：奇数 = 该阶段进行中，偶数 = 该阶段已结束（待收尾）。
 * 这一个数字就是「事件驱动」的全部门禁 —— 没有任何时间参与判断。
 */
const STEP = {
  prepare: 0,
  applyOngoing: 1,
  applyEnded: 2,
  writtenOngoing: 3,
  writtenEnded: 4,
  interviewOngoing: 5,
  interviewEnded: 6,
  defenseOngoing: 7,
  defenseEnded: 8,
  onboard: 9,
  archive: 10,
} as const

const STAGE_LABEL: Record<StageKeyOrArchive, string> = {
  prepare: '备招',
  apply: '报名',
  written: '笔试',
  interview: '面试',
  defense: '答辩',
  onboard: '转正',
  archive: '归档',
}

/** 步数 → 时间线上的当前节点 */
function stepToStage(step: number): StageKeyOrArchive {
  if (step === 0) return 'prepare'
  if (step <= 2) return 'apply'
  if (step <= 4) return 'written'
  if (step <= 6) return 'interview'
  if (step <= 8) return 'defense'
  if (step === 9) return 'onboard'
  return 'archive'
}

function stageOfStep(step: number): StageKey {
  const stage = stepToStage(step)
  return stage === 'archive' || stage === 'prepare' ? 'onboard' : stage
}

function parseScore(value: string): number {
  return Number(value.match(/-?\d+(\.\d+)?/)?.[0] ?? NaN)
}

/** 有效期文本（模块级纯函数：事件处理器里调用，避免渲染期取当前时间） */
function expiryTextOf(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toLocaleString('zh-CN', { hour12: false })
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

/**
 * 「设置」mock：内部标签页切换 —— 邮件模板 / 招新与加入我们（原系统设置里的那块迁到这里）。
 * 全部假数据，只用于确认信息架构。
 */
function SettingsMock() {
  const kinds = RECRUIT_MAIL_KINDS
  const [active, setActive] = useState<RecruitMailKind>('written_invite')
  const [mail, setMail] = useState({
    subject: '【拾光工作室】笔试邀请 · 张同学',
    body: '张同学：\n\n你好！感谢你报名 2026 年秋季招新，你的报名表我们已经收到并通过初筛。\n\n具体安排请加入笔试通知 QQ 群：123456789。\n',
  })
  const [join, setJoin] = useState({
    recruitTitle: '2026 年秋季招新进行中',
    recruitDesc: '无论你想写前端、做后端、搞算法还是做设计，这里都有真实的项目等着你。',
    joinTitle: '加入我们',
    joinIntro: '每年秋天，我们面向全校招募一批新成员。',
    joinSteps: '扫码完成身份认证 | 使用微信扫描二维码\n填写报名信息 | 上传你的报名表',
    joinRequirements: '对技术有好奇心\n每周能保证一定的投入时间',
  })

  return (
    <Tabs defaultValue="mail">
      <TabsList>
        <TabsTrigger value="mail">邮件模板</TabsTrigger>
        <TabsTrigger value="join">招新与加入我们</TabsTrigger>
      </TabsList>

      <TabsContent value="mail" className="mt-4">
        <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
          <div className="space-y-1">
            {kinds.map((kind) => (
              <button
                key={kind}
                onClick={() => setActive(kind)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  active === kind
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border text-foreground/70 hover:bg-secondary',
                )}
              >
                {RECRUIT_MAIL_META[kind].label}
              </button>
            ))}
          </div>
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="grid gap-1.5">
              <Label className="text-xs">主题</Label>
              <Input value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">正文</Label>
              <Textarea rows={12} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">
                所有邮件都不写时间与地点 —— 安排一律通过对应的 QQ 群通知。
              </p>
            </div>
            <Button size="sm" onClick={() => toast.success('已保存（Demo）')}>保存</Button>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="join" className="mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="grid gap-5">
          <div className="grid gap-1.5">
            <Label className="text-xs">首页招新横幅标题</Label>
            <Input value={join.recruitTitle} onChange={(e) => setJoin({ ...join, recruitTitle: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">首页招新横幅描述</Label>
            <Textarea rows={2} value={join.recruitDesc} onChange={(e) => setJoin({ ...join, recruitDesc: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">「加入我们」页面标题</Label>
            <Input value={join.joinTitle} onChange={(e) => setJoin({ ...join, joinTitle: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">「加入我们」页面描述</Label>
            <Textarea rows={2} value={join.joinIntro} onChange={(e) => setJoin({ ...join, joinIntro: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">招新流程（每行一条「标题 | 描述」）</Label>
            <Textarea rows={4} value={join.joinSteps} onChange={(e) => setJoin({ ...join, joinSteps: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">对报名者的期望（每行一条）</Label>
            <Textarea rows={3} value={join.joinRequirements} onChange={(e) => setJoin({ ...join, joinRequirements: e.target.value })} />
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            <span className="text-xs text-muted-foreground">同时驱动首页招新横幅与「加入我们」页面</span>
            <Button size="sm" onClick={() => toast.success('已保存（Demo）')}>保存</Button>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}

export function DemoEventDrivenPage() {
  const [step, setStep] = useState<number>(STEP.prepare)
  const [apps, setApps] = useState<MockApp[]>(INITIAL_APPS)
  const [codes, setCodes] = useState<Record<QrStage, ActiveCode | null>>(INITIAL_CODES)
  const [ttlDraft, setTtlDraft] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<StageKeyOrArchive | 'auto'>('auto')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [threshold, setThreshold] = useState('')
  const [scoreDraft, setScoreDraft] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<{ title: string; body: string; run: () => void } | null>(null)
  /** 顶层视图：流程（时间线+阶段面板）或 设置 */
  const [topView, setTopView] = useState<'flow' | 'settings'>('flow')

  const currentStage = stepToStage(step)
  /** 时间线上正在看的节点；默认跟随当前阶段 */
  const view: StageKeyOrArchive = viewing === 'auto' ? currentStage : viewing
  const setView = (key: StageKeyOrArchive) => setViewing(key)
  const backToNow = () => setViewing('auto')

  const patch = (id: string, changes: Partial<MockApp>) =>
    setApps((prev) => prev.map((app) => (app.id === id ? { ...app, ...changes } : app)))

  const stageApps = (stage: StageKey) => apps.filter((app) => app.stage === stage)

  /** 漏斗摘要（原看板的职责，收进一条） */
  const funnel = useMemo(() => {
    const count = (stage: StageKey) => apps.filter((app) => app.stage === stage).length
    return [
      { label: '报名', value: count('apply') },
      { label: '笔试', value: count('written') },
      { label: '面试', value: count('interview') },
      { label: '答辩', value: count('defense') },
      { label: '转正', value: count('onboard') },
    ]
  }, [apps])

  // ----- 各阶段动作（只改假状态） -----

  const openApply = () => {
    setStep(STEP.applyOngoing)
    toast.success('报名已开启', { description: '官网「加入我们」出现报名入口。' })
  }

  const addApplicant = () => {
    const n = apps.length + 1
    setApps((prev) => [
      ...prev,
      {
        id: `m${n}`, name: `现场来考${n}`, studentId: `SMX2026${String(n).padStart(3, '0')}`,
        email: '', source: 'manual', stage: 'apply', result: '',
        scores: { written: '', interview: '', defense: '' },
        checkins: { written: false, interview: false, defense: false }, invited: false,
      },
    ])
    toast.success('已补录', { description: '不要求报名表，联系方式选填。' })
  }

  const markRejected = (app: MockApp) => {
    patch(app.id, { result: 'failed' })
    toast.success(`${app.name} 已标记未通过初筛`, { description: '不发信；确认名单时不会再推进此人。' })
  }

  /** 生成签到二维码：可创建无数次，但生成新码会自动作废该阶段旧码 */
  const issueCode = (stage: QrStage) => {
    const hours = Number(ttlDraft[stage]?.match(/\d+/)?.[0] ?? NaN)
    if (!Number.isFinite(hours) || hours <= 0) return toast.error('请先填有效期（小时）')
    const expiresAt = expiryTextOf(hours)
    setCodes((prev) => ({ ...prev, [stage]: { token: Math.random().toString(16).slice(2, 18), expiresAt } }))
    toast.success('签到二维码已生成', {
      description: `有效至 ${expiresAt}；该阶段旧码已自动作废。`,
    })
  }

  const revokeCode = (stage: QrStage) => {
    setCodes((prev) => ({ ...prev, [stage]: null }))
    toast.success('二维码已作废')
  }

  /** 笔试阶段补录：录入即视为已参加笔试（无需签到，不会被缺考扫描误伤） */
  const addWrittenApplicant = () => {
    const n = apps.length + 1
    setApps((prev) => [
      ...prev,
      {
        id: `w${n}`, name: `现场补录${n}`, studentId: `SMW2026${String(n).padStart(3, '0')}`,
        email: 'walkin@example.edu.cn', source: 'manual', stage: 'written', result: 'attended',
        scores: { written: '', interview: '', defense: '' },
        checkins: { written: true, interview: false, defense: false }, invited: false,
      },
    ])
    toast.success('已补录', {
      description: '录入即视为已参加笔试（无需签到）；后续照常录成绩、进面试名单。',
    })
  }

  /** 结束报名：只关入口，名单还能改（不发信） */
  const endApply = () => {
    setStep(STEP.applyEnded)
    setSelection(new Set())
    toast.success('报名已结束', { description: '报名入口关闭；名单仍可调整，确认后才发邀请函。' })
  }

  /** 确认名单：勾选的人进笔试，未勾的判未通过初筛 */
  const confirmWrittenList = () => {
    setApps((prev) =>
      prev.map((app) => {
        if (app.stage !== 'apply') return app
        if (app.result === 'failed') return app
        return selection.has(app.id)
          ? { ...app, stage: 'written', result: '' }
          : { ...app, result: 'failed' }
      }),
    )
    setStep(STEP.writtenOngoing)
    setSelection(new Set())
    toast.success('笔试名单已确认', { description: '已发笔试邀请函（时间安排见笔试 QQ 群），进入笔试环节。' })
  }

  /** 结束笔试：顺带收尾 —— 未签到的自动标记缺考 */
  const endWritten = () => {
    const absent = stageApps('written').filter((app) => !app.checkins.written && app.result === '')
    setApps((prev) =>
      prev.map((app) =>
        app.stage === 'written' && !app.checkins.written && app.result === ''
          ? { ...app, result: 'absent' }
          : app,
      ),
    )
    setStep(STEP.writtenEnded)
    toast.success('笔试已结束', {
      description: absent.length > 0 ? `已自动标记 ${absent.length} 人缺考（不发信）。` : '没有人缺考。',
    })
  }

  const advanceWritten = () => {
    setApps((prev) =>
      prev.map((app) => {
        if (app.stage !== 'written') return app
        if (app.result !== '' && app.result !== 'attended') return app
        return selection.has(app.id)
          ? { ...app, stage: 'interview', result: '' }
          : { ...app, result: 'failed' }
      }),
    )
    setStep(STEP.interviewOngoing)
    setSelection(new Set())
    setThreshold('')
    toast.success('面试名单已确认', { description: '晋级者收到面试邀请函（安排见面试 QQ 群），其余收到感谢信。' })
  }

  const endInterview = () => {
    const absent = stageApps('interview').filter((app) => !app.checkins.interview && app.result === '')
    setApps((prev) =>
      prev.map((app) =>
        app.stage === 'interview' && !app.checkins.interview && app.result === ''
          ? { ...app, result: 'absent' }
          : app,
      ),
    )
    setStep(STEP.interviewEnded)
    toast.success('面试已结束', {
      description: absent.length > 0 ? `已自动标记 ${absent.length} 人缺考。` : '没有人缺考。',
    })
  }

  const confirmInterview = () => {
    setApps((prev) =>
      prev.map((app) => {
        if (app.stage !== 'interview') return app
        if (app.result !== '' && app.result !== 'attended') return app
        return selection.has(app.id)
          ? { ...app, stage: 'defense', result: '' }
          : { ...app, result: 'failed' }
      }),
    )
    setStep(STEP.defenseOngoing)
    setSelection(new Set())
    toast.success('录取名单已确认', { description: '录取者进入预备期（预备成员群号见邮件），其余收到感谢信。' })
  }

  const endDefense = () => {
    const absent = stageApps('defense').filter((app) => !app.checkins.defense && app.result === '')
    setApps((prev) =>
      prev.map((app) =>
        app.stage === 'defense' && !app.checkins.defense && app.result === ''
          ? { ...app, result: 'absent' }
          : app,
      ),
    )
    setStep(STEP.defenseEnded)
    toast.success('答辩已结束', {
      description: absent.length > 0 ? `已自动标记 ${absent.length} 人缺考。` : '没有人缺考。',
    })
  }

  const confirmDefense = () => {
    setApps((prev) =>
      prev.map((app) => {
        if (app.stage !== 'defense') return app
        if (app.result !== '' && app.result !== 'attended') return app
        return selection.has(app.id)
          ? { ...app, stage: 'onboard', result: '', invited: true }
          : { ...app, result: 'failed' }
      }),
    )
    setStep(STEP.onboard)
    setSelection(new Set())
    toast.success('最终名单已确认', { description: '通过者收到正式邀请函（一次性确认链接）。' })
  }

  const closeCycle = () => {
    setStep(STEP.archive)
    toast.success('本届已关闭', { description: '名单 CSV 已导出留底（页面不列往届存档），报名数据已清空。' })
  }

  const resetDemo = () => {
    setStep(STEP.prepare)
    setApps(INITIAL_APPS)
    setCodes(INITIAL_CODES)
    setTtlDraft({})
    setSelection(new Set())
    setScoreDraft({})
    setViewing('auto')
    toast.info('Demo 已重置')
  }

  // ----- 渲染辅助 -----

  const selectionTools = (
    <div className="flex flex-wrap items-center gap-2">
      {step >= STEP.writtenEnded && (
        <>
          <Input
            className="h-8 w-24"
            value={threshold}
            inputMode="decimal"
            placeholder="分数线"
            onChange={(e) => setThreshold(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const value = parseScore(threshold)
              if (!Number.isFinite(value)) return toast.error('请先填分数线，如 60')
              const field = stageOfStep(step) === 'written' ? 'written' : stageOfStep(step) === 'interview' ? 'interview' : 'defense'
              const picked = apps.filter(
                (app) =>
                  app.stage === stageOfStep(step) &&
                  Number.isFinite(parseScore(app.scores[field])) &&
                  parseScore(app.scores[field]) >= value,
              )
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
        onClick={() => setSelection(new Set(apps.filter((app) => app.stage === stageOfStep(step)).map((app) => app.id)))}
      >
        全选
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>
        清空
      </Button>
      <span className="text-[11px] text-muted-foreground">已勾选 {selection.size} 人</span>
    </div>
  )

  const renderAppRow = (app: MockApp, options: { checkbox?: boolean; checkin?: 'written' | 'interview' | 'defense'; score?: 'written' | 'interview' | 'defense' } = {}) => {
    return (
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
            />
          </TableCell>
        )}
        <TableCell>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {app.name}
            {app.source === 'manual' && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">补录</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{app.studentId}</div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{app.email || '—'}</TableCell>
        <TableCell className="text-xs">
          {app.result === 'failed'
            ? '未通过'
            : app.result === 'absent'
              ? '缺考'
              : app.result === 'attended'
                ? '已参加'
                : '待定'}
        </TableCell>
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
                onClick={() =>
                  patch(app.id, {
                    checkins: { ...app.checkins, [options.checkin!]: true },
                    // 补签同时撤销「缺考」：人确实来过就不该被刷掉
                    result: app.result === 'absent' || app.result === '' ? 'attended' : app.result,
                  })
                }
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
              value={scoreDraft[`${app.id}-${options.score}`] ?? app.scores[options.score]}
              onChange={(e) =>
                setScoreDraft((prev) => ({ ...prev, [`${app.id}-${options.score}`]: e.target.value }))
              }
              onBlur={(e) => patch(app.id, { scores: { ...app.scores, [options.score!]: e.target.value } })}
              placeholder="如 78"
            />
          </TableCell>
        )}
        <TableCell className="text-right">
          {step === STEP.applyOngoing && app.result === '' && (
            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => markRejected(app)}>
              <Ban className="h-3.5 w-3.5" /> 未通过初筛
            </Button>
          )}
        </TableCell>
      </TableRow>
    )
  }

  const panel = (title: string, hint: string, children: React.ReactNode, tone: 'ongoing' | 'after' = 'ongoing') => (
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
      <Button className="mt-3 gap-1.5" onClick={() => setConfirming({ title, body, run })}>
        <ArrowRight className="h-4 w-4" /> {label}
      </Button>
    </section>
  )

  const roster = (stage: StageKey, options: { checkbox?: boolean; checkin?: boolean; score?: 'written' | 'interview' | 'defense' } = {}) => {
    const list = stageApps(stage)
    const checkinStage = stage === 'apply' || stage === 'onboard' ? undefined : (stage as 'written' | 'interview' | 'defense')
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> {STAGE_LABEL[stage]}阶段共 <strong className="text-foreground">{list.length}</strong> 人
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {options.checkbox && <TableHead className="w-12">勾选</TableHead>}
              <TableHead className="w-44">报名人</TableHead>
              <TableHead>联系方式</TableHead>
              <TableHead className="w-24">状态</TableHead>
              {options.checkin && checkinStage && <TableHead className="w-28">签到</TableHead>}
              {options.score && <TableHead className="w-24">成绩</TableHead>}
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((app) =>
              renderAppRow(app, {
                checkbox: options.checkbox,
                checkin: options.checkin ? checkinStage : undefined,
                score: options.score,
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
   * 考试开始前才生成：生成时自选有效期；生成新码会自动作废该阶段旧码；可手动作废。
   */
  const qrCard = (stage: QrStage, label: string) => {
    const code = codes[stage]
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
                <QRCodeSVG value={`https://studio.example.com/checkin/${code.token}`} size={128} level="M" />
              </div>
              <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                有效至 <strong className="text-foreground">{code.expiresAt}</strong>
                <br />
                同学扫码进入签到页，填报名时的姓名 + 学号即可。
              </div>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => issueCode(stage)}>
                <RotateCcw className="h-3.5 w-3.5" /> 重新生成（旧码作废）
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => revokeCode(stage)}>
                <Ban className="h-3.5 w-3.5" /> 作废
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-32"
                value={ttlDraft[stage] ?? ''}
                inputMode="numeric"
                placeholder="有效期（小时）"
                onChange={(e) => setTtlDraft((prev) => ({ ...prev, [stage]: e.target.value }))}
              />
              <Button size="sm" className="gap-1" onClick={() => issueCode(stage)}>
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

  // ----- 各阶段的页面内容 -----

  const stageBody = () => {
    if (view !== currentStage) {
      const isPast = TIMELINE.findIndex((node) => node.key === view) < TIMELINE.findIndex((node) => node.key === currentStage)
      return (
        <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-display text-xl font-bold">
            {isPast ? `「${STAGE_LABEL[view]}」已走过` : `「${STAGE_LABEL[view]}」还没到`}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isPast ? '这一段已经结束，可在「名单」页回看每个人的走向。' : '按顺序走完前面的阶段后，这里会自动解锁。'}
          </p>
          <Button variant="outline" className="mt-5" onClick={backToNow}>
            回到当前阶段（{STAGE_LABEL[currentStage]}）
          </Button>
        </div>
      )
    }

    switch (step) {
      case STEP.prepare:
        return (
          <div className="space-y-4">
            {panel('备招 · 名称与四个 QQ 群', '没有任何时间字段 —— 报名何时开始，由你点下面的按钮决定', (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">本届名称</Label>
                  <Input defaultValue="2026 年秋季招新" />
                </div>
                {QQ_GROUPS.map((group) => (
                  <div key={group.key} className="grid gap-1.5">
                    <Label className="text-xs">{group.label}群号</Label>
                    <Input placeholder="如 123456789" />
                  </div>
                ))}
                <p className="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2">
                  每封邀请函只引导进自己对应的那一个群；所有时间与地点安排都在 QQ 群里通知，邮件里不再出现。
                </p>
              </div>
            ))}
            <Button className="gap-1.5" onClick={openApply}>
              <CheckCircle2 className="h-4 w-4" /> 开启报名
            </Button>
          </div>
        )

      case STEP.applyOngoing:
        return (
          <div className="space-y-4">
            {panel('收报名表', '同学自助提交 / 替换；你在这里补录与剔除', (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="gap-1" onClick={addApplicant}>
                    <UserPlus className="h-3.5 w-3.5" /> 补录未报名考生
                  </Button>
                  <span className="text-[11px] text-muted-foreground">同一学号重复提交 = 替换材料并删除旧文件（此处模拟为新增）。</span>
                </div>
                {roster('apply')}
              </>
            ))}
            {endAction('结束报名', '报名入口将关闭（不再收表 / 替换）；名单仍可调整（补录 / 剔除 / 删除），确认名单后才发邀请函。不发信。', endApply, '结束报名')}
          </div>
        )

      case STEP.applyEnded:
        return (
          <div className="space-y-4">
            {panel('确认笔试名单', '勾选进入笔试的人；未勾选的判「未通过初筛」（不发信，名单里留痕）', (
              <>
                {selectionTools}
                {roster('apply', { checkbox: true })}
                <Button className="gap-1.5" onClick={confirmWrittenList} disabled={selection.size === 0}>
                  <Check className="h-4 w-4" /> 确认名单并发出笔试邀请函（{selection.size} 人）
                </Button>
              </>
            ), 'after')}
          </div>
        )

      case STEP.writtenOngoing:
        return (
          <div className="space-y-4">
            {qrCard('written', '笔试')}
            {panel('现场', '签到 / 补签 / 补录都在这里；此时看不到成绩入口 —— 还没结束笔试', (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="gap-1" onClick={addWrittenApplicant}>
                    <UserPlus className="h-3.5 w-3.5" /> 补录考生
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    给没赶上报名但来考了、且带报名表的人：邮箱 / 手机 / QQ / 报名表全部必填，录入即视为已参加（无需签到）。
                  </span>
                </div>
                {roster('written', { checkin: true })}
              </>
            ))}
            {endAction('结束笔试', `将自动把未签到的同学标记为「缺考」（不发信），然后解锁成绩录入与面试名单。`, endWritten, '结束笔试')}
          </div>
        )

      case STEP.writtenEnded:
        return (
          <div className="space-y-4">
            {panel('标记缺考', '结束笔试时已自动处理；漏签的可以补签救回', (
              <p className="text-xs text-muted-foreground">
                未签到 {stageApps('written').filter((app) => app.result === 'absent').length} 人已标记「缺考」。
                在下面的名单里点「补签」即可撤销缺考（人确实来过就不该被刷掉）。
              </p>
            ), 'after')}
            {panel('录入笔试成绩', '名次实时排好，便于判断分数线切在哪；漏签的也能在这里补签', (
              roster('written', { score: 'written', checkin: true })
            ), 'after')}
            {panel('生成面试名单', '勾选晋级的人；未勾选的判未通过并发感谢信', (
              <>
                {selectionTools}
                {roster('written', { checkbox: true, score: 'written' })}
                <Button className="gap-1.5" onClick={advanceWritten} disabled={selection.size === 0}>
                  <Check className="h-4 w-4" /> 确认面试名单并发出通知（{selection.size} 人晋级）
                </Button>
              </>
            ), 'after')}
          </div>
        )

      case STEP.interviewOngoing:
        return (
          <div className="space-y-4">
            {qrCard('interview', '面试')}
            {panel('现场', '签到与补签（面试阶段没有补录 —— 补录只发生在笔试）', roster('interview', { checkin: true }))}
            {endAction('结束面试', '将自动把未签到的同学标记为「缺考」，然后解锁评语与录取确认。', endInterview, '结束面试')}
          </div>
        )

      case STEP.interviewEnded:
        return (
          <div className="space-y-4">
            {panel('录入面试评语', '评语留给自己人看，不发给学生；漏签的也能在这里补签', (
              roster('interview', { score: 'interview', checkin: true })
            ), 'after')}
            {panel('确认录取', '勾选录取的人；未勾选的判未通过并发感谢信', (
              <>
                {selectionTools}
                {roster('interview', { checkbox: true, score: 'interview' })}
                <Button className="gap-1.5" onClick={confirmInterview} disabled={selection.size === 0}>
                  <Check className="h-4 w-4" /> 确认录取名单（{selection.size} 人进预备期）
                </Button>
              </>
            ), 'after')}
          </div>
        )

      case STEP.defenseOngoing:
        return (
          <div className="space-y-4">
            {panel('预备期', '这段没有要操作的：大家在项目里干活，答辩安排在 QQ 群通知', (
              <p className="text-xs text-muted-foreground">
                预备期无事可做是正常状态 —— 不用反复刷新找按钮。
              </p>
            ), 'ongoing')}
            {qrCard('defense', '答辩')}
            {panel('现场', '答辩签到与补签', roster('defense', { checkin: true }))}
            {endAction('结束答辩', '将自动把未签到的同学标记为「缺考」，然后解锁成绩与最终名单。', endDefense, '结束答辩')}
          </div>
        )

      case STEP.defenseEnded:
        return (
          <div className="space-y-4">
            {panel('录入答辩成绩', '答辩成绩决定最终名单；漏签的也能在这里补签', roster('defense', { score: 'defense', checkin: true }), 'after')}
            {panel('确认最终名单', '勾选通过的人；通过者收到正式邀请函（一次性链接，免登录填信息进成员表）', (
              <>
                {selectionTools}
                {roster('defense', { checkbox: true, score: 'defense' })}
                <Button className="gap-1.5" onClick={confirmDefense} disabled={selection.size === 0}>
                  <Check className="h-4 w-4" /> 确认答辩结果（{selection.size} 人转正）
                </Button>
              </>
            ), 'after')}
          </div>
        )

      case STEP.onboard:
        return (
          <div className="space-y-4">
            {panel('等本人确认', '同学点开邀请函里的链接、填完成员信息就自动进成员表；学生端不提供拒绝', (
              <div className="space-y-2">
                {stageApps('onboard').map((app) => (
                  <div key={app.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{app.name}</div>
                      <div className="text-xs text-muted-foreground">{app.studentId}</div>
                    </div>
                    {app.invited ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 邀请函已发，等确认
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">未发</span>
                    )}
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => toast.success('已加入群发队列（Demo）')}>
                      催确认
                    </Button>
                  </div>
                ))}
              </div>
            ), 'ongoing')}
            {endAction('关闭本届', '先导出完整名单 CSV 留底（后台不列往届存档），然后清空报名数据、报名表文件与发信日志。', closeCycle, '关闭本届')}
          </div>
        )

        default:
        return (
          <div className="space-y-4">
            {panel('本届总结', '归档后招新模块收起，官网回到正常状态', (
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: '报名人数', value: apps.length },
                  { label: '最终转正', value: stageApps('onboard').filter((app) => app.result === 'failed' ? false : true).length },
                  { label: '中途退出/淘汰', value: apps.filter((app) => app.result === 'failed' || app.result === 'absent').length },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-border px-4 py-3">
                    <div className="text-2xl font-bold">{item.value}</div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
            ), 'after')}
            {panel('存档', 'CSV 已写进对象存储（页面刻意不列往届存档）', (
              <Button size="sm" variant="outline" onClick={() => toast.success('已下载（Demo）')}>
                下载本届名单 CSV
              </Button>
            ), 'after')}
            <Button variant="outline" className="gap-1.5" onClick={resetDemo}>
              <RotateCcw className="h-4 w-4" /> 重置 Demo 从头走一遍
            </Button>
          </div>
        )
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* ===== 顶层切换：流程 / 设置 ===== */}
      <div className="mb-5 flex items-center gap-1.5">
        {([['flow', '流程'], ['settings', '设置']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTopView(key)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-xs transition-colors',
              topView === key
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border text-foreground/70 hover:bg-secondary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {topView === 'settings' ? (
        <SettingsMock />
      ) : (
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
                onClick={() => setView(node.key)}
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
                <div className={cn('mt-0.5 text-[10px] leading-snug', isCurrent ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
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
        {funnel.map((item) => (
          <span key={item.label} className="text-muted-foreground">
            {item.label} <strong className="text-foreground">{item.value}</strong>
          </span>
        ))}
        <Button variant="ghost" size="sm" className="ml-auto gap-1 text-xs" onClick={resetDemo}>
          <RotateCcw className="h-3.5 w-3.5" /> 重置 Demo
        </Button>
      </div>

      {/* ===== 阶段标题 ===== */}
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">{STAGE_LABEL[view]}阶段</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {TIMELINE.find((node) => node.key === view)?.hint}
        </p>
      </div>

      {stageBody()}
        </>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirming?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirming?.run()
                setConfirming(null)
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
