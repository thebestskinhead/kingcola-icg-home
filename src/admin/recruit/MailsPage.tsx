import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { adminGetRecruitMails, type MailLogRow } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { RECRUIT_MAIL_META, type RecruitMailKind } from '@shared/recruit'
import { cn } from '@/lib/utils'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { RecruitTabs } from './RecruitTabs'
import { useRecruitSettings } from './useRecruitSettings'

/** ISO 时间 → 北京时间展示 */
function formatTime(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return iso
  const shifted = new Date(parsed + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

function kindLabel(kind: string): string {
  if (kind === 'custom') return '自定义通知'
  if (kind === 'close_cycle') return '关闭本届'
  return RECRUIT_MAIL_META[kind as RecruitMailKind]?.label ?? kind
}

/**
 * 发信日志：每次发信（含失败）都有一行，用来回答「他到底收到没有」。
 * 关闭本届时会与报名数据一起清空。
 */
export function MailsPage() {
  const { settings, loading, reload } = useRecruitSettings()
  const [logs, setLogs] = useState<MailLogRow[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const response = await adminGetRecruitMails(500)
      setLogs(response.logs)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-6xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reload} />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">邮件日志</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            最近 {logs.length} 条发送记录 · 失败的可以在「报名管理」里对该同学重发
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} title="刷新">
          <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">时间</TableHead>
              <TableHead className="w-32">信件</TableHead>
              <TableHead>收件人</TableHead>
              <TableHead className="w-20">结果</TableHead>
              <TableHead>说明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-xs text-muted-foreground">{formatTime(log.createdAt)}</TableCell>
                <TableCell className="text-xs">{kindLabel(log.kind)}</TableCell>
                <TableCell className="text-xs">
                  <div className="truncate">{log.recipient || '—'}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{log.subject}</div>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      log.ok ? 'bg-emerald-500/10 text-emerald-700' : 'bg-destructive/10 text-destructive',
                    )}
                  >
                    {log.ok ? '已发出' : log.code}
                  </span>
                </TableCell>
                <TableCell className="max-w-[22rem] truncate text-xs text-muted-foreground" title={log.message}>
                  {log.message}
                </TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && !busy && (
              <TableRow>
                <TableCell colSpan={5} className="py-14 text-center text-sm text-muted-foreground">
                  还没有发信记录
                </TableCell>
              </TableRow>
            )}
            {busy && logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-14 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
