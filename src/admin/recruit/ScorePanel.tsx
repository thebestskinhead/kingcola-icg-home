import { useCallback, useEffect, useState } from 'react'
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
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { OperationCard } from './StageKit'

type ScoredStage = Exclude<RecruitStage, 'apply' | 'onboard'>

/** 三个阶段各自对应的成绩 / 评语字段 */
const COLUMNS = {
  written: { score: 'writtenScore', note: 'writtenNote', scoreLabel: '笔试成绩', noteLabel: '阅卷备注' },
  interview: { score: 'interviewScore', note: 'interviewNote', scoreLabel: '面试成绩', noteLabel: '面试评语' },
  defense: { score: 'defenseScore', note: 'defenseNote', scoreLabel: '答辩成绩', noteLabel: '答辩评语' },
} as const

/**
 * 成绩与评语录入（阶段页内嵌）。
 *
 * 名次按分数从高到低实时算出来 —— 「生成面试名单」要人工过一遍名单，
 * 有排名在旁边才好评「分数线切在哪」。
 */
export function ScorePanel({ stage, onSaved }: { stage: ScoredStage; onSaved?: () => void }) {
  const columns = COLUMNS[stage]

  const [items, setItems] = useState<AdminApplication[]>([])
  const [draft, setDraft] = useState<Record<string, { score: string; note: string }>>({})
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)

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

  const pendingCount = items.filter((item) => {
    const value = draft[item.id]
    if (!value) return false
    return (
      String(item[columns.score] ?? '') !== value.score || String(item[columns.note] ?? '') !== value.note
    )
  }).length

  const saveAll = async () => {
    setSaving(true)
    try {
      // 逐条提交：成绩是人工核对过的数据，宁可慢一点也不做「一把梭」的批量覆盖
      for (const item of items) {
        const value = draft[item.id]
        if (!value) continue
        const changed =
          String(item[columns.score] ?? '') !== value.score ||
          String(item[columns.note] ?? '') !== value.note
        if (!changed) continue
        // 字段名由 COLUMNS 决定，所以按动态键构造后再收窄类型
        const patch: Record<string, string> = {
          [columns.score]: value.score,
          [columns.note]: value.note,
        }
        await adminUpdateApplication(item.id, patch as UpdateApplicationBody)
      }
      toast.success('成绩已保存')
      await load()
      onSaved?.()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <OperationCard
      title={`${RECRUIT_STAGE_LABELS[stage]}成绩与评语`}
      description="名次按分数实时排好，便于判断名单切在哪。改完记得保存。"
      badge={pendingCount}
      defaultOpen={items.length > 0}
      onReload={() => void load()}
      reloading={busy}
      actions={
        <Button size="sm" className="gap-1.5" onClick={() => void saveAll()} disabled={saving || pendingCount === 0}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存成绩{pendingCount > 0 ? `（${pendingCount}）` : ''}
        </Button>
      }
    >
      <div className="max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">名次</TableHead>
              <TableHead className="w-44">报名人</TableHead>
              <TableHead className="w-28">当前状态</TableHead>
              <TableHead className="w-28">{columns.scoreLabel}</TableHead>
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
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  这个阶段还没有同学
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </OperationCard>
  )
}
