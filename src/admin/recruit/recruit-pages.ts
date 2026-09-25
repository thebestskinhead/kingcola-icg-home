/**
 * 招新后台的页面地图（纯常量，刻意与组件分文件）。
 *
 * 为什么单独一个文件：`react-refresh/only-export-components` 要求「组件文件只导出组件」，
 * 把常量挂在组件文件里会让热更新失效。`useRecruitSettings.ts` 出于同样的原因单独成文件。
 */

import type { RecruitAutoTask } from '@shared/recruit'

/**
 * 内部页签。
 *
 * 主体是**五个阶段**（准备 → 报名 → 笔试 → 面试 → 答辩 → 转正），
 * 按阶段分页而不是按功能分页：同一时刻能做的事由「现在走到哪一段」决定，
 * 一个页签里就是这个阶段该做的全部事情（操作区 + 数据区）。
 * 看板 / 名单 / 邮件模板 / 邮件日志是跨阶段的全局工具，排在后半段。
 */
export const RECRUIT_TABS: ReadonlyArray<{ to: string; label: string; end: boolean }> = [
  { to: '/admin/recruit', label: '看板', end: true },
  { to: '/admin/recruit/prepare', label: '准备', end: false },
  { to: '/admin/recruit/apply', label: '报名', end: false },
  { to: '/admin/recruit/written', label: '笔试', end: false },
  { to: '/admin/recruit/interview', label: '面试', end: false },
  { to: '/admin/recruit/defense', label: '答辩', end: false },
  { to: '/admin/recruit/onboard', label: '转正', end: false },
  { to: '/admin/recruit/roster', label: '名单', end: false },
  { to: '/admin/recruit/templates', label: '邮件模板', end: false },
  { to: '/admin/recruit/mails', label: '邮件日志', end: false },
]

/**
 * 自动流程任务 → 它所属的阶段页。
 *
 * 任务不再单独占一页，而是以操作卡内嵌在对应阶段页里，
 * 所以看板的「待处理事项」要跳到那个阶段页，而不是一个不存在的自动流程页。
 */
export const RECRUIT_TASK_PAGE: Record<RecruitAutoTask, string> = {
  confirm_written: '/admin/recruit/apply',
  mark_absent: '/admin/recruit/written',
  advance_written: '/admin/recruit/written',
  advance_interview: '/admin/recruit/interview',
  advance_defense: '/admin/recruit/defense',
  close_cycle: '/admin/recruit/prepare',
}
