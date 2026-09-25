import { useCallback, useEffect, useState, type ReactNode } from 'react'
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
import { applicationFileUrl, adminListApplications, type AdminApplication } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import {
  applicationLabel,
  RECRUIT_STAGE_LABELS,
  type RecruitStage,
} from '@shared/recruit'
import { cn } from '@/lib/utils'
import { AlertTriangle, ChevronDown, Download, Loader2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

/**
 * 阶段页的骨架：**操作区（上）+ 数据区（下）** 两块分开。
 *
 * 为什么分开：同一个阶段在不同时刻能做的事完全不同（笔试阶段「考试中」只有签到/补签，
 * 「改卷时」只有成绩与生成名单），而这两块的信息密度也差得远 ——
 * 操作区是「我现在该做什么」，数据区是「现在是什么情况」，混在一起两边都看不清。
 */
export function StageShell({
  title,
  hint,
  operations,
  children,
}: {
  title: string
  hint?: string
  /** 操作区内容；不传则不渲染这一块 */
  operations?: ReactNode
  /** 数据区内容 */
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>

      {operations && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs tracking-[0.2em] text-muted-foreground">本阶段可以做的事</h2>
          <div className="space-y-3">{operations}</div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs tracking-[0.2em] text-muted-foreground">本阶段的同学</h2>
        {children}
      </section>
    </div>
  )
}

/**
 * 一张操作卡。
 *
 * `blocked` 非空表示「现在还不能做」，此时**默认折叠并写明原因** ——
 * 这正是「当前阶段不可能出现的操作要隐藏或折叠」的落地方式：
 * 不藏起来（管理员会以为功能没做），也不平铺（会误点），而是折叠 + 说清为什么。
 * 原因文案直接来自服务端的自动流程预览（`preview.blocked`），不在前端另算一套。
 */
export function OperationCard({
  title,
  description,
  badge,
  blocked,
  actions,
  children,
  onReload,
  reloading,
  defaultOpen = false,
}: {
  title: string
  description?: string
  /** 角标：待处理人数 */
  badge?: number
  /** 不能执行的原因；非空则折叠 */
  blocked?: string
  /** 头部右侧的操作按钮 */
  actions?: ReactNode
  children?: ReactNode
  onReload?: () => void
  reloading?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen || !blocked)

  return (
    <div className={cn('rounded-xl border bg-card', blocked ? 'border-border/70' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <ChevronDown
            className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold">{title}</span>
              {badge !== undefined && badge > 0 && (
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{badge}</span>
              )}
              {blocked && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                  暂不可做
                </span>
              )}
            </span>
            {description && (
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{description}</span>
            )}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {onReload && (
            <Button variant="ghost" size="sm" onClick={onReload} disabled={reloading}>
              <RefreshCw className={cn('h-3.5 w-3.5', reloading && 'animate-spin')} />
            </Button>
          )}
          {actions}
        </div>
      </div>

      {blocked && (
        <div className="flex items-start gap-2 border-t border-border bg-amber-500/5 px-5 py-2.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{blocked}</span>
        </div>
      )}

      {open && children && <div className="border-t border-border">{children}</div>}
    </div>
  )
}

/** 阶段 → 该阶段的签到列与成绩列 */
const STAGE_FIELDS = {
  apply: null,
  written: { checkin: 'writtenCheckinAt', score: 'writtenScore' },
  interview: { checkin: 'interviewCheckinAt', score: 'interviewScore' },
  defense: { checkin: 'defenseCheckinAt', score: 'defenseScore' },
  onboard: null,
} as const

function moment(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return raw
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 阶段名单（数据区）。只读为主 —— 改状态、批量操作走「名单」页，
 * 这里回答的是「这个阶段现在有哪些人、他们到哪一步了」。
 */
export function StageRoster({ stage, refreshKey = 0 }: { stage: RecruitStage; refreshKey?: number }) {
  const [items, setItems] = useState<AdminApplication[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(true)

  const fields = STAGE_FIELDS[stage]

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const response = await adminListApplications({ stages: [stage], limit: 1000 })
      setItems(response.items)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '名单加载失败')
    } finally {
      setBusy(false)
    }
  }, [stage])

  // refreshKey 由阶段页在上面的操作卡执行成功后 +1，把最新名单拉回来
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const term = query.trim().toLowerCase()
  const shown = term
    ? items.filter((item) =>
        [item.name, item.studentId, item.email, item.phone, item.qq]
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
    : items

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {RECRUIT_STAGE_LABELS[stage]}阶段共 <strong className="text-foreground">{items.length}</strong> 人
          </span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索姓名 / 学号 / 联系方式"
              className="h-8 w-56 pl-8 text-xs"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            刷新
          </Button>
        </div>
      </div>

      <div className="max-h-[30rem] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">报名人</TableHead>
              <TableHead className="w-52">联系方式</TableHead>
              <TableHead className="w-28">当前状态</TableHead>
              {fields && <TableHead className="w-32">签到</TableHead>}
              {fields && <TableHead className="w-24">成绩</TableHead>}
              <TableHead className="w-36">材料</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {item.name || '—'}
                    {item.source === 'manual' && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        补录
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{item.studentId}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div className="truncate">{item.email || '—'}</div>
                  <div>
                    {item.phone || '—'}
                    {item.qq ? ` · QQ ${item.qq}` : ''}
                  </div>
                </TableCell>
                <TableCell className="text-xs">{applicationLabel(item.stage, item.result)}</TableCell>
                {fields && (
                  <TableCell className="text-xs text-muted-foreground">
                    {item[fields.checkin] ? moment(item[fields.checkin]) : '未签到'}
                  </TableCell>
                )}
                {fields && (
                  <TableCell className="text-xs">
                    {String(item[fields.score] ?? '') || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                <TableCell>
                  {item.fileUrl ? (
                    <a
                      href={applicationFileUrl(item.id)}
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> 报名表
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">无</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && !busy && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  {items.length === 0 ? '这个阶段还没有同学' : '没有匹配的同学'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
