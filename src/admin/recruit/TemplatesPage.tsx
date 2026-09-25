import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { adminSaveRecruit } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import {
  RECRUIT_MAIL_KINDS,
  RECRUIT_MAIL_META,
  RECRUIT_MAIL_VARIABLES,
  renderTemplate,
  unknownTemplateVariables,
  type RecruitMailKind,
  type RecruitTemplates,
} from '@shared/recruit'
import { cn } from '@/lib/utils'
import { AlertTriangle, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { RecruitTabs } from './RecruitTabs'
import { useRecruitSettings } from './useRecruitSettings'

/** 预览用的假数据：让管理员点开就能看到真实信件长什么样 */
const SAMPLE_VARS: Record<string, string> = {
  name: '张同学',
  studentId: '2026010101',
  cycleName: '2026 年秋季招新',
  writtenAt: '2026 年 10 月 8 日 14:00',
  writtenPlace: '实验楼 B203 机房',
  interviewAt: '2026 年 10 月 12 日 19:00',
  interviewPlace: '实验楼 B203 会议室',
  defenseStart: '2026 年 10 月 20 日',
  defenseEnd: '2026 年 12 月 20 日',
  onboardDeadline: '2026 年 12 月 28 日 23:59',
  inviteLink: 'https://example.edu.cn/invite/a1b2c3d4e5f6',
  studio: '拾光工作室',
  contactEmail: 'studio@example.edu.cn',
  contactAddress: '某某大学 计算机学院 实验楼 B203',
}

/**
 * 邮件模板中心：5 类共 7 条模板（感谢信按阶段分 3 条）的主题与正文都在这里改。
 * 支持 `{变量}` 占位，右侧实时预览；写错的变量会当场标出来。
 */
export function TemplatesPage() {
  const { settings, loading, reload } = useRecruitSettings()
  const [draft, setDraft] = useState<RecruitTemplates | null>(null)
  const [active, setActive] = useState<RecruitMailKind>('written_invite')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings) setDraft(settings.templates)
  }, [settings])

  if (loading || !draft) {
    return (
      <div className="mx-auto max-w-5xl">
        <RecruitTabs settings={settings} loading={loading} onReload={reload} />
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      </div>
    )
  }

  const template = draft[active]
  const meta = RECRUIT_MAIL_META[active]
  const unknown = [
    ...new Set([...unknownTemplateVariables(template.subject), ...unknownTemplateVariables(template.body)]),
  ]

  const setTemplate = (patch: Partial<typeof template>) =>
    setDraft({ ...draft, [active]: { ...template, ...patch } })

  const save = async () => {
    setSaving(true)
    try {
      await adminSaveRecruit({ templates: draft })
      toast.success('邮件模板已保存')
      reload()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reload} />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">邮件模板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            状态推进时按模板自动发信；停用某条模板后状态照常流转，只是不发这封信。
          </p>
        </div>
        <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存全部模板
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        {/* 左侧：模板列表 */}
        <nav className="space-y-1.5">
          {RECRUIT_MAIL_KINDS.map((kind) => (
            <button
              key={kind}
              onClick={() => setActive(kind)}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                kind === active
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border hover:bg-secondary',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{RECRUIT_MAIL_META[kind].label}</span>
                {!draft[kind].enabled && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    已停用
                  </span>
                )}
              </div>
              <div
                className={cn(
                  'mt-0.5 text-[11px]',
                  kind === active ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                发给：{RECRUIT_MAIL_META[kind].audience}
              </div>
            </button>
          ))}

          <div className="mt-4 rounded-lg border border-border p-3">
            <div className="text-[11px] font-medium text-muted-foreground">可用变量</div>
            <div className="mt-2 space-y-1">
              {RECRUIT_MAIL_VARIABLES.map((item) => (
                <div key={item.token} className="flex gap-2 text-[11px]">
                  <code className="shrink-0 text-accent">{item.token}</code>
                  <span className="text-muted-foreground">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* 右侧：编辑与预览 */}
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{meta.label}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{meta.trigger}</p>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={template.enabled} onCheckedChange={(v) => setTemplate({ enabled: v })} />
                启用自动发送
              </label>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">邮件主题</Label>
                <Input value={template.subject} onChange={(e) => setTemplate({ subject: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">正文</Label>
                <Textarea
                  rows={14}
                  className="font-mono text-xs"
                  value={template.body}
                  onChange={(e) => setTemplate({ body: e.target.value })}
                />
              </div>
            </div>

            {unknown.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  这些变量系统不认识，发信时会原样保留：{unknown.join('、')}。请对照左侧变量清单检查拼写。
                </span>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">预览（示例数据）</h2>
            <div className="rounded-lg border border-border bg-secondary/30 p-4">
              <div className="border-b border-border pb-2 text-xs font-medium">
                主题：{renderTemplate(template.subject, SAMPLE_VARS)}
              </div>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed">
                {renderTemplate(template.body, SAMPLE_VARS)}
              </pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
