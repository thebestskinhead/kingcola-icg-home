import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  adminListApplications,
  adminUpdateApplication,
  type AdminApplication,
  type UpdateApplicationBody,
} from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { applicationLabel, RECRUIT_STAGE_LABELS, type RecruitStage } from '@shared/recruit'
import { cn } from '@/lib/utils'
import { ArrowRight, Loader2, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { RecruitOpsGuard, RecruitTabs } from './RecruitTabs'
import { useRecruitSettings } from './useRecruitSettings'

/** 三个阶段各自对应的成绩/评语字段 */
const COLUMNS = {
  written: { score: 'writtenScore', note: 'writtenNote', label: '笔试成绩', noteLabel: '笔试地点 / 备注' },
  interview: { score: 'interviewScore', note: 'interviewNote', label: '面试成绩', noteLabel: '面试评语' },
  defense: { score: 'defenseScore', note: 'defenseNote', label: '答辩成绩', noteLabel: '答辩评语' },
} as const

/**
 * 成绩与排名录入。
 *
 * 只列**当前阶段**的同学（笔试阶段录笔试分、预备期录答辩分），
 * 名次按分数从高到低实时算出来 —— 这样「取前 N 名晋级」在执行前就能看到大致范围。
 */
export function ScoresPage() {
  const { settings, loading, reload } = useRecruitSettings()
  const [stage, setStage] = useState<Exclude<RecruitStage, 'apply' | 'onboard'>>('written')
  const [items, setItems] = useState<AdminApplication[]>([])
  const [draft, setDraft] = useState<Record<string, { score: string; note: string }>>({})
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const columns = COLUMNS[stage]

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const response = await adminListApplications({ stages: [stage], limit: 500 })
      setItems(response.items)
      const next: Record<string, { score: string; note: string }> = {}
      for (const item of response.items) {
        next[item.id] = {
          score: String(item[columns.score] ?? ''),
          note: String(item[columns.note] ?? ''),
        }
      }
      setDraft(next)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setBusy(false)
    }
  }, [stage, columns.score, columns.note])

  useEffect(() => {
    void load()
  }, [load])

  /** 名次：按分数从高到低，没填分的排最后 */
  const ranked = [...items]
    .map((item) => ({
      item,
      score: Number((draft[item.id]?.score ?? '').match(/-?\d+(\.\d+)?/)?.[0] ?? NaN),
    }))
    .sort((a, b) => (Number.isNaN(b.score) ? -1 : b.score) - (Number.isNaN(a.score) ? -1 : a.score))
  const rankOf = new Map(ranked.map((entry, index) => [entry.item.id, index + 1]))

  const saveAll = async () => {
    setSaving(true)
    try {
      // 逐条提交：成绩是人工核对过的数据，宁可慢一点也不做「一把梭」的批量覆盖
      for (const item of items) {
        const value = draft[item.id]
        if (!value) continue
        const changed =
          String(item[columns.score] ?? '') !== value.score || String(item[columns.note] ?? '') !== value.note
        if (!changed) continue
        // 字段名由 COLUMNS 决定，所以这里按动态键构造后再收窄类型
        const patch: Record<string, string> = {
          [columns.score]: value.score,
          [columns.note]: value.note,
        }
        await adminUpdateApplication(item.id, patch as UpdateApplicationBody)
      }
      toast.success('成绩已保存', {
        description: '接着到「自动流程」页生成晋级名单并发邀请函。',
      })
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const ruleText =
    settings?.cycle.advanceRule === 'score'
      ? `分数线 ${settings?.cycle.advanceScore} 分`
      : `取前 ${settings?.cycle.advanceTop} 名`

  return (
    <div className="mx-auto max-w-5xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reload} />

      <RecruitOpsGuard settings={settings} loading={loading}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold">成绩与排名录入</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              当前晋级规则：<span className="text-foreground">{ruleText}</span>（在「周期与签到」里改）
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              {(['written', 'interview', 'defense'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setStage(value)}
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
            <Button variant="outline" size="icon" onClick={() => void load()} title="刷新">
              <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">名次</TableHead>
                <TableHead className="w-44">报名人</TableHead>
                <TableHead className="w-32">当前状态</TableHead>
                <TableHead className="w-32">{columns.label}</TableHead>
                <TableHead>{columns.noteLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map(({ item }) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs text-muted-foreground">{rankOf.get(item.id)}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.studentId}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {applicationLabel(item.stage, item.result)}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      value={draft[item.id]?.score ?? ''}
                      placeholder="如 78"
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [item.id]: { score: e.target.value, note: prev[item.id]?.note ?? '' },
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      value={draft[item.id]?.note ?? ''}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [item.id]: { score: prev[item.id]?.score ?? '', note: e.target.value },
                        }))
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && !busy && (
                <TableRow>
                  <TableCell colSpan={5} className="py-14 text-center text-sm text-muted-foreground">
                    当前阶段还没有同学
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/admin/recruit/auto"
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
          >
            录完分去「自动流程」生成名单 <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Button onClick={() => void saveAll()} disabled={saving || items.length === 0} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存全部成绩
          </Button>
        </div>
      </RecruitOpsGuard>
    </div>
  )
}
