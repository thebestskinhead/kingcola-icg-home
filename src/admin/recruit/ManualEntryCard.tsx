import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminCreateApplication } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { OperationCard } from './StageKit'

const EMPTY = { name: '', studentId: '', email: '', phone: '', qq: '' }

/**
 * 补录未报名考生（报名阶段的操作卡）。
 *
 * 开放参加制下「没报名但来考了」是常态：签到页允许他们直接填姓名学号，
 * 但那样信息进不了名单、后面发通知也找不到人 —— 所以在这里补一条记录。
 * 刻意不要求报名表文件，联系方式也全部可选（人已经站在考场里了，缺什么后补）。
 * 补录完他们就处在报名阶段，确认笔试名单时和官网报名的人一起推进、一起收邀请函。
 */
export function ManualEntryCard({ onCreated }: { onCreated?: () => void }) {
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const set = (patch: Partial<typeof EMPTY>) => setForm((prev) => ({ ...prev, ...patch }))

  const submit = async () => {
    if (!form.name.trim()) return toast.error('请填写姓名')
    if (!form.studentId.trim()) return toast.error('请填写学号')

    setSaving(true)
    try {
      await adminCreateApplication(form)
      toast.success('已补录', { description: `${form.name}（${form.studentId}）已进入报名名单。` })
      setForm(EMPTY)
      setOpen(false)
      onCreated?.()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '补录失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <OperationCard
      title="补录未报名考生"
      description="没在官网报名但来考了的同学：填姓名 + 学号即可入名单（联系方式选填，报名表不做硬性要求）。"
      defaultOpen={false}
      actions={
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen((prev) => !prev)}>
          <UserPlus className="h-3.5 w-3.5" /> {open ? '收起' : '补录一人'}
        </Button>
      }
    >
      {open && (
        <div className="space-y-3 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">姓名 *</Label>
              <Input
                className="h-9"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="与学籍一致"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">学号 *</Label>
              <Input
                className="h-9"
                value={form.studentId}
                onChange={(e) => set({ studentId: e.target.value })}
                placeholder="教务网学号"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">邮箱</Label>
              <Input
                className="h-9"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="不填则收不到邮件通知"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">手机号</Label>
              <Input
                className="h-9"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="11 位，选填"
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs">QQ 号</Label>
              <Input
                className="h-9"
                value={form.qq}
                onChange={(e) => set({ qq: e.target.value })}
                placeholder="5–12 位数字，选填"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => void submit()} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} 确认补录
            </Button>
            <span className="text-[11px] text-muted-foreground">
              补录的人会在名单里带「补录」标记；确认笔试名单时一并推进并发邀请函。
            </span>
          </div>
        </div>
      )}
    </OperationCard>
  )
}
