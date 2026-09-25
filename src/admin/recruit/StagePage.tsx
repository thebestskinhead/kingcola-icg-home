import { useCallback, useState, type ReactNode } from 'react'
import { RecruitOpsGuard, RecruitTabs } from './RecruitTabs'
import { useRecruitSettings } from './useRecruitSettings'
import { StageRoster, StageShell } from './StageKit'
import { AutoTaskCard } from './AutoTaskCard'
import { ManualEntryCard } from './ManualEntryCard'
import { SessionPanel } from './SessionPanel'
import { ScorePanel } from './ScorePanel'
import { RECRUIT_STAGE_HINTS, RECRUIT_STAGE_LABELS, type RecruitStage } from '@shared/recruit'

/**
 * 一个阶段一页：**操作区（上）+ 数据区（下）**。
 *
 * 为什么按阶段组织而不是按功能：同一时刻能做的事是由「现在走到哪一段」决定的，
 * 按功能分页会把「笔试阶段的签到、成绩、分流」拆到三个页面里，管理员每次都要自己拼。
 * 按阶段组织后，一个页签里就是这个阶段该做的全部事情，顺序也照实际流程排。
 *
 * 「不可能出现的操作」不删除、而是折叠并写明原因（`OperationCard` 的 blocked），
 * 原因直接取自服务端的自动流程预览 —— 前端不另算一套判断。
 */
export function StagePage({ stage }: { stage: RecruitStage }) {
  const { settings, loading, reload } = useRecruitSettings()
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((prev) => prev + 1), [])

  /** 三个阶段共用「场次 + 成绩」两块，只有报名与转正没有 */
  const withSession = stage === 'written' || stage === 'interview' || stage === 'defense'

  const operations: ReactNode[] = []

  if (stage === 'apply') {
    operations.push(
      <ManualEntryCard key="manual" onCreated={bump} />,
      <AutoTaskCard
        key="confirm_written"
        task="confirm_written"
        onDone={bump}
        extraHint="确认名单后：这些同学进入笔试并收到笔试邀请函（邮件里会列出全部笔试场次），同时报名通道关闭。"
      />,
    )
  }

  if (withSession) {
    operations.push(<SessionPanel key={`session-${stage}`} stage={stage} onChanged={bump} />)
    operations.push(<ScorePanel key={`score-${stage}`} stage={stage} onSaved={bump} />)
  }

  if (stage === 'written') {
    operations.push(
      <AutoTaskCard
        key="mark_absent"
        task="mark_absent"
        onDone={bump}
        extraHint="笔试结束并过了宽限期仍未签到的同学，会被标记为「未参加」，流程到此结束（不发信）。"
      />,
      <AutoTaskCard
        key="advance_written"
        task="advance_written"
        onDone={bump}
        extraHint="按当前晋级规则算出名单：进入面试的同学收到面试邀请函，其余同学收到感谢信。"
      />,
    )
  }

  if (stage === 'interview') {
    operations.push(
      <AutoTaskCard
        key="advance_interview"
        task="advance_interview"
        onDone={bump}
        extraHint="勾选录取的同学进入预备期并收到面试通过通知（含预备期起止），其余同学收到感谢信。"
      />,
    )
  }

  if (stage === 'defense') {
    operations.push(
      <AutoTaskCard
        key="advance_defense"
        task="advance_defense"
        onDone={bump}
        extraHint="勾选通过的同学转正并收到正式邀请函（邮件里带一次性确认链接），其余同学收到感谢信。"
      />,
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reload} />

      <RecruitOpsGuard settings={settings} loading={loading}>
        <StageShell
          title={`${RECRUIT_STAGE_LABELS[stage]}阶段`}
          hint={RECRUIT_STAGE_HINTS[stage]}
          operations={operations.length > 0 ? operations : undefined}
        >
          <div className={operations.length === 0 ? '' : 'mt-0'}>
            {stage === 'onboard' && (
              <p className="mb-3 rounded-lg border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                这个阶段不需要你操作：同学确认加入后会自动写入成员表并出现在官网「团队成员」里。
                想催一下没收到的同学，去「名单」页勾选后发通知信。
              </p>
            )}
            <StageRoster stage={stage} refreshKey={version} />
          </div>
        </StageShell>
      </RecruitOpsGuard>
    </div>
  )
}
