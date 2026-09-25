/**
 * 邮件日志视图（演示）。
 *
 * 对应旧版的「邮件日志」页：谁在什么时候收到了哪封信、结果如何。
 * 失败的可以在「名单」里对那个人重发；关闭本届时这份日志会随报名数据一起清空。
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Mail } from 'lucide-react'
import type { DemoRecruit } from './useDemoRecruit'

export function DemoMailPage({ demo }: { demo: DemoRecruit }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold">邮件日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          共 {demo.mails.length} 条。发信失败不影响流程推进，失败的可以在「名单」里对那个人重发。
          关闭本届时这份日志会随报名数据一起清空。
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">时间</TableHead>
              <TableHead className="w-40">信件</TableHead>
              <TableHead className="w-56">收件人</TableHead>
              <TableHead className="w-24">结果</TableHead>
              <TableHead>说明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {demo.mails.map((mail) => (
              <TableRow key={mail.id}>
                <TableCell className="text-xs text-muted-foreground">{demo.formatTime(mail.at)}</TableCell>
                <TableCell className="text-xs">{mail.label}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{mail.to}</TableCell>
                <TableCell className="text-xs">
                  {mail.ok ? (
                    <span className="text-emerald-700">已发出</span>
                  ) : (
                    <span className="text-destructive">失败</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="truncate">{mail.subject}</div>
                  {!mail.ok && <div className="text-destructive">{mail.error}</div>}
                </TableCell>
              </TableRow>
            ))}
            {demo.mails.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-14">
                  <div className="flex flex-col items-center text-center">
                    <Mail className="h-6 w-6 text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      还没有发过信。确认笔试名单之后，这里会出现每一封邀请函与感谢信。
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
