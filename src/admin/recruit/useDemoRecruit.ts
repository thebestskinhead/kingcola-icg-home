/**
 * 演示页的全部状态与动作（假数据，不发任何请求）。
 *
 * 单独成 hook 的原因：流程 / 名单 / 邮件日志 / 设置四个视图都要读写同一份数据
 * （比如「确认笔试名单」既要改阶段，又要往邮件日志里追加邀请函），状态放在这里，视图只负责画。
 *
 * ⚠️ 每个动作都注明了接真数据时对应哪个接口 —— 日后照着一块块换掉即可。
 */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { RecruitMailKind, RecruitTemplates } from '@shared/recruit'
import {
  DEFAULT_GROUPS,
  DEMO_TEMPLATES,
  downloadCsv,
  formatTime,
  INITIAL_APPS,
  INITIAL_CODES,
  mailLabel,
  makeId,
  renderDemo,
  sampleVars,
  scoreFieldOf,
  STAGE_LABEL,
  STEP,
  stepToStage,
  toExportRow,
  type ActiveCode,
  type GroupNumbers,
  type MockApp,
  type MockMail,
  type QrStage,
  type StageKey,
  type StageKeyOrArchive,
  type TopView,
} from './demo-model'

export interface PendingConfirm {
  title: string
  body: string
  run: () => void
}

export function useDemoRecruit() {
  const [started, setStarted] = useState(false)
  const [step, setStep] = useState<number>(STEP.prepare)
  const [apps, setApps] = useState<MockApp[]>(INITIAL_APPS)
  const [codes, setCodes] = useState<Record<QrStage, ActiveCode | null>>(INITIAL_CODES)
  const [mails, setMails] = useState<MockMail[]>([])
  const [templates, setTemplates] = useState<RecruitTemplates>(DEMO_TEMPLATES)
  const [cycleName, setCycleName] = useState('2026 年秋季招新')
  const [groups, setGroups] = useState<GroupNumbers>(DEFAULT_GROUPS)
  const [ttlDraft, setTtlDraft] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<StageKeyOrArchive | 'auto'>('auto')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [threshold, setThreshold] = useState('')
  const [confirming, setConfirming] = useState<PendingConfirm | null>(null)
  const [topView, setTopView] = useState<TopView>('flow')

  const currentStage = stepToStage(step)
  const view: StageKeyOrArchive = viewing === 'auto' ? currentStage : viewing

  const stageApps = (stage: StageKey) => apps.filter((app) => app.stage === stage)
  const patch = (id: string, changes: Partial<MockApp>) =>
    setApps((prev) => prev.map((app) => (app.id === id ? { ...app, ...changes } : app)))

  /** 漏斗摘要（原看板的职责，收进一条） */
  const funnel = useMemo(
    () =>
      (['apply', 'written', 'interview', 'defense', 'onboard'] as const).map((stage) => ({
        label: STAGE_LABEL[stage],
        value: apps.filter((app) => app.stage === stage).length,
      })),
    [apps],
  )

  // ----- 邮件：演示里全部写进本地日志 -----

  /** 渲染某个人的变量（邀请函链接这类逐人不同的值都在这里） */
  const varsFor = (app: MockApp) => ({
    ...sampleVars(cycleName, groups),
    name: app.name,
    studentId: app.studentId,
    inviteLink: app.inviteUrl,
  })

  /**
   * 记一封「已发出」的信。真实现里这一步由 worker 的 recruit-mail 完成并落库，
   * 演示页只在本地日志里追加一条，好让「邮件日志」视图有东西看。
   */
  const logMail = (app: MockApp, kind: RecruitMailKind | '', subject?: string): MockMail => ({
    id: makeId('mail'),
    appId: app.id,
    at: new Date().toISOString(),
    kind,
    label: kind ? mailLabel(kind) : '自定义通知',
    to: app.email || '（无邮箱）',
    ok: true,
    error: '',
    subject: subject ?? (kind ? renderDemo(templates[kind].subject, varsFor(app)) : ''),
  })

  const pushMails = (entries: MockMail[]) => setMails((prev) => [...entries, ...prev])

  // ----- 休眠 / 启动 / 收尾 -----

  /** 回到休眠：本届的一切状态都清掉（「重置」与「下载归档」都走这里） */
  const toDormant = () => {
    setStarted(false)
    setStep(STEP.prepare)
    setApps(INITIAL_APPS)
    setCodes(INITIAL_CODES)
    setMails([])
    setTtlDraft({})
    setSelection(new Set())
    setViewing('auto')
    setTopView('flow')
  }

  const resetDemo = () => {
    toDormant()
    toast.info('演示已重置，回到休眠')
  }

  /** 启动系统：从休眠进入备招，开始一个新的周期 */
  const startCycle = () => {
    setStarted(true)
    setStep(STEP.prepare)
    setViewing('auto')
    setTopView('flow')
    toast.success('新周期已创建', { description: '先填本届名称与 QQ 群号，然后手动开启报名。' })
  }

  const ask = (title: string, body: string, run: () => void) => setConfirming({ title, body, run })

  // ----- 备招与设置 -----

  /** 真实现：`adminSaveRecruit`（周期里的名称与群号） */
  const saveGroups = (name: string, nextGroups: GroupNumbers) => {
    setCycleName(name)
    setGroups(nextGroups)
    toast.success('已保存', { description: '群号改动会立即体现在之后发出的邀请函里。' })
  }

  /** 真实现：`adminSaveRecruit`（模板） */
  const saveTemplates = (next: RecruitTemplates) => {
    setTemplates(next)
    toast.success('邮件模板已保存')
  }

  // ----- 报名 -----

  const openApply = () => {
    setStep(STEP.applyOngoing)
    toast.success('报名已开启', { description: '官网「加入我们」出现报名入口。' })
  }

  /** 真实现：`adminCreateApplication`（source='manual'，报名阶段不要求报名表） */
  const addApplicant = (draft: { name: string; studentId: string; email: string; phone: string; qq: string }) => {
    setApps((prev) => [
      ...prev,
      {
        id: makeId('manual'),
        ...draft,
        source: 'manual',
        stage: 'apply',
        result: '',
        scores: { written: '', interview: '', defense: '' },
        notes: { written: '', interview: '', defense: '' },
        remark: '',
        checkins: { written: false, interview: false, defense: false },
        inviteUrl: '',
        invitedAt: '',
        confirmedAt: '',
        fileName: '',
        fileSize: 0,
        createdAt: new Date().toISOString(),
      },
    ])
    toast.success('已补录', { description: '不要求报名表；确认名单时与官网报名的人一起推进。' })
  }

  /** 真实现：`adminUpdateApplication`（result='failed'），不发信 */
  const markRejected = (app: MockApp) => {
    patch(app.id, { result: 'failed' })
    toast.success(`${app.name} 已标记未通过初筛`, { description: '不发信；确认名单时不会再推进此人。' })
  }

  /** 真实现：`adminDeleteApplication`（连带删除报名表文件） */
  const deleteApp = (app: MockApp) => {
    setApps((prev) => prev.filter((item) => item.id !== app.id))
    toast.success(`已删除 ${app.name} 的报名记录`, { description: '报名表文件一并删除，不可撤销。' })
  }

  const endApply = () => {
    setStep(STEP.applyEnded)
    setSelection(new Set())
    toast.success('报名已结束', { description: '报名入口关闭；名单仍可调整，确认后才发邀请函。' })
  }

  /** 真实现：`adminRunRecruitAuto('confirm_written')` */
  const confirmWrittenList = (ids: string[]) => {
    const picked = new Set(ids)
    const eligible = apps.filter((app) => app.stage === 'apply' && app.result !== 'failed')
    const winners = eligible.filter((app) => picked.has(app.id))
    const winnerIds = new Set(winners.map((app) => app.id))
    const loserIds = new Set(eligible.filter((app) => !picked.has(app.id)).map((app) => app.id))

    setApps((prev) =>
      prev.map((app) =>
        winnerIds.has(app.id)
          ? { ...app, stage: 'written', result: '' }
          : loserIds.has(app.id)
            ? { ...app, result: 'failed' }
            : app,
      ),
    )
    // 只有进入笔试的人收到邀请函；未通过初筛的**不发信**
    pushMails(winners.map((app) => logMail(app, 'written_invite')))
    setStep(STEP.writtenOngoing)
    setSelection(new Set())
    toast.success('笔试名单已确认', { description: '已发笔试邀请函（时间地点见笔试 QQ 群），进入笔试环节。' })
  }

  // ----- 笔试 -----

  /** 生成签到二维码：可创建无数次，但生成新码会自动作废该阶段旧码 */
  const issueCode = (stage: QrStage) => {
    const hours = Number(ttlDraft[stage]?.match(/\d+/)?.[0] ?? NaN)
    if (!Number.isFinite(hours) || hours <= 0) return toast.error('请先填有效期（小时）')
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toLocaleString('zh-CN', { hour12: false })
    setCodes((prev) => ({ ...prev, [stage]: { token: makeId('qr').slice(3), expiresAt } }))
    toast.success('签到二维码已生成', { description: `有效至 ${expiresAt}；该阶段旧码已自动作废。` })
  }

  const revokeCode = (stage: QrStage) => {
    setCodes((prev) => ({ ...prev, [stage]: null }))
    toast.success('二维码已作废')
  }

  /** 笔试补录：录入即视为已参加笔试（无需签到，不会被缺考扫描误伤） */
  const addWrittenApplicant = (draft: {
    name: string
    studentId: string
    email: string
    phone: string
    qq: string
    fileName: string
  }) => {
    setApps((prev) => [
      ...prev,
      {
        id: makeId('walkin'),
        ...draft,
        source: 'manual',
        stage: 'written',
        result: 'attended',
        scores: { written: '', interview: '', defense: '' },
        notes: { written: '', interview: '', defense: '' },
        remark: '',
        checkins: { written: true, interview: false, defense: false },
        inviteUrl: '',
        invitedAt: '',
        confirmedAt: '',
        fileSize: 524288,
        createdAt: new Date().toISOString(),
      },
    ])
    toast.success('已补录', {
      description: '录入即视为已参加笔试（无需签到）；后续照常录成绩、进面试名单。',
    })
  }

  /** 结束笔试：未签到的自动标记缺考（不发信） */
  const endWritten = () => {
    const absent = stageApps('written').filter((app) => !app.checkins.written && app.result === '')
    setApps((prev) =>
      prev.map((app) =>
        app.stage === 'written' && !app.checkins.written && app.result === '' ? { ...app, result: 'absent' } : app,
      ),
    )
    setStep(STEP.writtenEnded)
    toast.success('笔试已结束', {
      description: absent.length > 0 ? `已自动标记 ${absent.length} 人缺考（不发信）。` : '没有人缺考。',
    })
  }

  /** 真实现：`adminRunRecruitAuto('advance_written')` */
  const advanceWritten = (ids: string[]) => {
    const picked = new Set(ids)
    const eligible = apps.filter(
      (app) => app.stage === 'written' && (app.result === '' || app.result === 'attended'),
    )
    const winners = eligible.filter((app) => picked.has(app.id))
    const losers = eligible.filter((app) => !picked.has(app.id))
    applyPromotion(winners, losers, 'interview')

    pushMails([
      ...winners.map((app) => logMail(app, 'interview_invite')),
      ...losers.map((app) => logMail(app, 'thanks_written')),
    ])
    setStep(STEP.interviewOngoing)
    setSelection(new Set())
    setThreshold('')
    toast.success('面试名单已确认', { description: '晋级者收到面试邀请函（见面试 QQ 群），其余收到感谢信。' })
  }

  // ----- 面试 -----

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

  /** 真实现：`adminRunRecruitAuto('advance_interview')` */
  const confirmInterview = (ids: string[]) => {
    const picked = new Set(ids)
    const eligible = apps.filter(
      (app) => app.stage === 'interview' && (app.result === '' || app.result === 'attended'),
    )
    const winners = eligible.filter((app) => picked.has(app.id))
    const losers = eligible.filter((app) => !picked.has(app.id))
    applyPromotion(winners, losers, 'defense')

    pushMails([
      ...winners.map((app) => logMail(app, 'interview_passed')),
      ...losers.map((app) => logMail(app, 'thanks_interview')),
    ])
    setStep(STEP.defenseOngoing)
    setSelection(new Set())
    toast.success('录取名单已确认', { description: '录取者进入预备期（预备成员群号见邮件），其余收到感谢信。' })
  }

  // ----- 答辩 -----

  const endDefense = () => {
    const absent = stageApps('defense').filter((app) => !app.checkins.defense && app.result === '')
    setApps((prev) =>
      prev.map((app) =>
        app.stage === 'defense' && !app.checkins.defense && app.result === '' ? { ...app, result: 'absent' } : app,
      ),
    )
    setStep(STEP.defenseEnded)
    toast.success('答辩已结束', {
      description: absent.length > 0 ? `已自动标记 ${absent.length} 人缺考。` : '没有人缺考。',
    })
  }

  /** 真实现：`adminRunRecruitAuto('advance_defense')`，通过者签发一次性邀请函 */
  const confirmDefense = (ids: string[]) => {
    const picked = new Set(ids)
    const eligible = apps.filter((app) => app.stage === 'defense' && (app.result === '' || app.result === 'attended'))
    const winners = eligible.filter((app) => picked.has(app.id))
    const losers = eligible.filter((app) => !picked.has(app.id))

    const now = new Date().toISOString()
    const winnerIds = new Set(winners.map((app) => app.id))
    const loserIds = new Set(losers.map((app) => app.id))
    setApps((prev) =>
      prev.map((app) =>
        winnerIds.has(app.id)
          ? {
              ...app,
              stage: 'onboard',
              result: '',
              invitedAt: now,
              inviteUrl: `${location.origin}/invite/${makeId('tk')}`,
            }
          : loserIds.has(app.id)
            ? { ...app, result: 'failed' }
            : app,
      ),
    )
    // 邀请函正文里带的是逐人的链接，日志只留主题，所以这里给一份带链接的副本
    pushMails([
      ...winners.map((app) =>
        logMail({ ...app, inviteUrl: `${location.origin}/invite/${makeId('tk')}` }, 'offer'),
      ),
      ...losers.map((app) => logMail(app, 'thanks_defense')),
    ])
    setStep(STEP.onboard)
    setSelection(new Set())
    toast.success('最终名单已确认', { description: '通过者收到正式邀请函（一次性确认链接）。' })
  }

  // ----- 转正收尾 -----

  /** 真实现：`adminRunRecruitAuto('close_cycle')` —— 导出存档 → 清空数据 → 周期置结束 */
  const closeCycle = () => {
    setStep(STEP.archive)
    toast.success('本届已关闭', { description: '名单 CSV 已导出留底（页面不列往届存档），报名数据已清空。' })
  }

  /**
   * 下载归档 CSV。这是本届的最后一个动作：文件真的下一次，下完就自动回到休眠 ——
   * 归档即收尾，不再需要一个「本届已结束」的停留页；要再招新就重新点「启动系统」。
   */
  const downloadArchive = () => {
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(apps.map(toExportRow), `招新名单-${today}.csv`)
    toDormant()
    toast.success('归档已下载，系统回到休眠', {
      description: '本届数据已清空；要再招新就点「启动系统」开一个新周期。',
    })
  }

  // ----- 名单页的批量与单人动作（真实现：adminBulkApplications / adminUpdateApplication） -----

  const bulkCheckin = (ids: string[]) => {
    const picked = new Set(ids)
    setApps((prev) =>
      prev.map((app) => {
        if (!picked.has(app.id)) return app
        const field = scoreFieldOf(app.stage)
        if (!field) return app
        return {
          ...app,
          checkins: { ...app.checkins, [field]: true },
          // 补签同时撤销「缺考」：人确实来过就不该被刷掉
          result: app.result === 'absent' || app.result === '' ? 'attended' : app.result,
        }
      }),
    )
    toast.success(`已为 ${ids.length} 人标记签到`, { description: '人确实来过，缺考标记会一并撤销。' })
  }

  const bulkAbsent = (ids: string[]) => {
    const picked = new Set(ids)
    setApps((prev) => prev.map((app) => (picked.has(app.id) ? { ...app, result: 'absent' } : app)))
    toast.success(`已标记 ${ids.length} 人未参加`, { description: '不发信。' })
  }

  const bulkWithdraw = (ids: string[]) => {
    const picked = new Set(ids)
    setApps((prev) => prev.map((app) => (picked.has(app.id) ? { ...app, result: 'withdrawn' } : app)))
    toast.success(`已把 ${ids.length} 人标记为退出报名`)
  }

  /** 补发某一封信（真实现：单独调用发信接口） */
  const sendMail = (id: string, kind: RecruitMailKind) => {
    const app = apps.find((item) => item.id === id)
    if (!app) return
    pushMails([logMail(app, kind)])
    toast.success(`已给 ${app.name} 补发「${mailLabel(kind)}」`)
  }

  /**
   * 群发通知（真实现：adminNotifyApplications）。
   * 正文按人渲染后直接发出；发信日志表只有「收件人 / 主题 / 结果」三列、没有正文，
   * 所以 body 用不到（显式 void 掉，免得被当成漏用）。
   */
  const notify = (ids: string[], subject: string, body: string) => {
    const picked = new Set(ids)
    const targets = apps.filter((app) => picked.has(app.id))
    void body
    pushMails(targets.map((app) => logMail(app, '', renderDemo(subject, varsFor(app)))))
    toast.success(`已群发 ${targets.length} 人`, { description: '邮件发出后无法撤回。' })
  }

  /** 勾选的人推进到下一阶段，其余在本阶段判未通过 —— 三处晋级动作用同一套写法 */
  function applyPromotion(winners: MockApp[], losers: MockApp[], nextStage: StageKey) {
    const winnerIds = new Set(winners.map((app) => app.id))
    const loserIds = new Set(losers.map((app) => app.id))
    setApps((prev) =>
      prev.map((app) =>
        winnerIds.has(app.id)
          ? { ...app, stage: nextStage, result: '' }
          : loserIds.has(app.id)
            ? { ...app, result: 'failed' }
            : app,
      ),
    )
  }

  return {
    // 状态
    started,
    step,
    setStep,
    apps,
    codes,
    mails,
    templates,
    cycleName,
    groups,
    // 原始 setter：表单边填边改、点「保存」才落库（避免逐字弹 toast）
    setCycleName,
    setGroups,
    ttlDraft,
    setTtlDraft,
    viewing,
    setViewing,
    selection,
    setSelection,
    threshold,
    setThreshold,
    confirming,
    setConfirming,
    topView,
    setTopView,
    currentStage,
    view,
    funnel,
    stageApps,
    patch,

    // 动作
    ask,
    toDormant,
    resetDemo,
    startCycle,
    saveGroups,
    saveTemplates,
    openApply,
    addApplicant,
    markRejected,
    deleteApp,
    endApply,
    confirmWrittenList,
    issueCode,
    revokeCode,
    addWrittenApplicant,
    endWritten,
    advanceWritten,
    endInterview,
    confirmInterview,
    endDefense,
    confirmDefense,
    closeCycle,
    downloadArchive,
    bulkCheckin,
    bulkAbsent,
    bulkWithdraw,
    sendMail,
    notify,

    // 展示辅助
    formatTime,
  }
}

export type DemoRecruit = ReturnType<typeof useDemoRecruit>
