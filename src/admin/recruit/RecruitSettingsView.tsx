/**
 * 设置：七封邮件的模板 + 本届名称与四个 QQ 群号 + 官网招新文案。
 *
 * 模板里**没有任何时间与地点变量** —— 安排一律让同学看对应的 QQ 群，
 * 所以可用变量清单里只有四个群号（外加姓名、学号、邀请链接、工作室信息）。
 *
 * 未知变量由后端算好（`admin.unknownVariables`），前端不另判一套。
 */

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AlertTriangle, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import {
  RECRUIT_GROUP_LABELS,
  RECRUIT_MAIL_KINDS,
  RECRUIT_MAIL_META,
  RECRUIT_MAIL_VARIABLES,
  renderTemplate,
  validateQQGroups,
  type RecruitGroupKey,
  type RecruitMailKind,
  type RecruitQQGroups,
  type RecruitTemplates,
} from '@shared/recruit'
import type { SiteConfig } from '@shared/types'
import { adminGetConfig, adminUpdateConfig } from '@/api/endpoints'
import type { RecruitAdmin } from './useRecruitAdmin'

/** 「招新与加入我们」这一块改的是站点配置（与招新周期无关，休眠期也能改） */
type JoinCopy = Pick<
  SiteConfig,
  'recruitTitle' | 'recruitDesc' | 'joinTitle' | 'joinIntro' | 'joinSteps' | 'joinRequirements'
>

export function RecruitSettingsView({ admin }: { admin: RecruitAdmin }) {
  const [templates, setTemplates] = useState<RecruitTemplates>(admin.templates)
  const [active, setActive] = useState<RecruitMailKind>('written_invite')
  const [cycleName, setCycleName] = useState(admin.cycle.name)
  const [groups, setGroups] = useState<RecruitQQGroups>(admin.cycle.groups)
  const [site, setSite] = useState<SiteConfig | null>(null)
  const [join, setJoin] = useState<JoinCopy | null>(null)
  const [saving, setSaving] = useState(false)

  // 别处（流程页）改过设置后跟着刷新
  useEffect(() => setTemplates(admin.templates), [admin.templates])
  useEffect(() => {
    setCycleName(admin.cycle.name)
    setGroups(admin.cycle.groups)
  }, [admin.cycle])

  useEffect(() => {
    adminGetConfig()
      .then((config) => {
        setSite(config.site)
        setJoin({
          recruitTitle: config.site.recruitTitle,
          recruitDesc: config.site.recruitDesc,
          joinTitle: config.site.joinTitle,
          joinIntro: config.site.joinIntro,
          joinSteps: config.site.joinSteps,
          joinRequirements: config.site.joinRequirements,
        })
      })
      .catch(() => toast.error('官网文案加载失败，稍后可重试'))
  }, [])

  const template = templates[active]
  const meta = RECRUIT_MAIL_META[active]
  const unknown = admin.unknownVariables[active] ?? []

  /** 预览用的示例数据（群号用当前填的，没填就照实显示占位符） */
  const previewVars: Record<string, string> = {
    name: '张同学',
    studentId: '2026001',
    cycleName: cycleName || '本次招新',
    writtenGroup: groups.written || '（待公布）',
    interviewGroup: groups.interview || '（待公布）',
    probationGroup: groups.probation || '（待公布）',
    formalGroup: groups.formal || '（待公布）',
    inviteLink: `${window.location.origin}/invite/abc123`,
    studio: site?.studioName ?? '',
    contactEmail: site?.contactEmail ?? '',
    contactAddress: site?.contactAddress ?? '',
  }

  const patchTemplate = (changes: Partial<RecruitTemplates[RecruitMailKind]>) =>
    setTemplates((prev) => ({ ...prev, [active]: { ...prev[active], ...changes } }))

  const saveAll = async () => {
    const invalid = validateQQGroups(groups)
    if (invalid) return toast.error(invalid)

    setSaving(true)
    try {
      await admin.saveCycleInfo({ name: cycleName.trim(), groups })
      await admin.saveTemplates(templates)
      if (join) {
        await adminUpdateConfig({ site: join })
        toast.success('官网文案已保存')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            邮件模板、四个 QQ 群号与官网招新文案。邮件里不写时间与地点 —— 安排一律通过对应的 QQ 群通知。
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => void saveAll()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存全部设置
        </Button>
      </div>

      <Tabs defaultValue="mail">
        <TabsList>
          <TabsTrigger value="mail">邮件模板</TabsTrigger>
          <TabsTrigger value="join">招新与加入我们</TabsTrigger>
        </TabsList>

        <TabsContent value="mail" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
            <div className="space-y-4">
              <div className="space-y-1">
                {RECRUIT_MAIL_KINDS.map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setActive(kind)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      active === kind
                        ? 'border-transparent bg-primary text-primary-foreground'
                        : 'border-border text-foreground/70 hover:bg-secondary',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{RECRUIT_MAIL_META[kind].label}</span>
                      {!templates[kind].enabled && (
                        <span
                          className={cn(
                            'ml-auto rounded px-1.5 text-[10px]',
                            active === kind ? 'bg-primary-foreground/20' : 'bg-secondary',
                          )}
                        >
                          已停用
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 text-[10px] leading-snug',
                        active === kind ? 'text-primary-foreground/70' : 'text-muted-foreground',
                      )}
                    >
                      {RECRUIT_MAIL_META[kind].trigger}
                    </div>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 text-xs font-semibold">可用变量</h3>
                <ul className="space-y-1">
                  {RECRUIT_MAIL_VARIABLES.map((item) => (
                    <li key={item.token} className="text-[11px] text-muted-foreground">
                      <code className="text-foreground">{item.token}</code> {item.desc}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{meta.label}</h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      发给{meta.audience} · {meta.trigger}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={template.enabled}
                      onCheckedChange={(checked) => patchTemplate({ enabled: checked })}
                    />
                    启用自动发送
                  </label>
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-xs">主题</Label>
                  <Input
                    value={template.subject}
                    onChange={(event) => patchTemplate({ subject: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">正文</Label>
                  <Textarea
                    rows={14}
                    value={template.body}
                    onChange={(event) => patchTemplate({ body: event.target.value })}
                  />
                </div>

                {unknown.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      这些变量系统不认识：{unknown.join('、')}。发信时会原样保留，请对照左侧变量清单检查拼写。
                    </span>
                  </div>
                )}

                {!template.enabled && (
                  <p className="text-[11px] text-muted-foreground">
                    这封信当前停用：状态照常流转，只是不发出这封信（日志里也不会出现）。
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-xs font-semibold text-muted-foreground">预览（示例数据）</h3>
                <div className="rounded-lg bg-secondary/40 p-4">
                  <div className="text-sm font-medium">
                    {renderTemplate(template.subject, previewVars) || '（没有主题）'}
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {renderTemplate(template.body, previewVars)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="join" className="mt-4 space-y-4">
          <div className="grid gap-5 rounded-xl border border-border bg-card p-5">
            <div className="grid gap-1.5">
              <Label className="text-xs">本届名称</Label>
              <Input value={cycleName} onChange={(event) => setCycleName(event.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(RECRUIT_GROUP_LABELS) as RecruitGroupKey[]).map((key) => (
                <div key={key} className="grid gap-1.5">
                  <Label className="text-xs">{RECRUIT_GROUP_LABELS[key]}</Label>
                  <Input
                    inputMode="numeric"
                    value={groups[key]}
                    placeholder="如 123456789"
                    onChange={(event) => setGroups({ ...groups, [key]: event.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {key === 'written' && '笔试邀请函里给的就是它'}
                    {key === 'interview' && '面试邀请函里给的就是它'}
                    {key === 'probation' && '面试通过通知里给的就是它'}
                    {key === 'formal' && '正式邀请函里给的就是它'}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              所有时间与地点安排都在对应的群里通知，邮件里不再出现。群号改了会立刻体现在之后发出的邀请函里；
              还没建群可以先留空（邮件里会显示「（待公布）」）。
            </p>
          </div>

          {join && (
            <div className="grid gap-5 rounded-xl border border-border bg-card p-5">
              <div className="grid gap-1.5">
                <Label className="text-xs">首页招新横幅标题</Label>
                <Input
                  value={join.recruitTitle}
                  onChange={(event) => setJoin({ ...join, recruitTitle: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">首页招新横幅描述</Label>
                <Textarea
                  rows={2}
                  value={join.recruitDesc}
                  onChange={(event) => setJoin({ ...join, recruitDesc: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">「加入我们」页面标题</Label>
                <Input
                  value={join.joinTitle}
                  onChange={(event) => setJoin({ ...join, joinTitle: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">「加入我们」页面描述</Label>
                <Textarea
                  rows={2}
                  value={join.joinIntro}
                  onChange={(event) => setJoin({ ...join, joinIntro: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">招新流程（每行一条「标题 | 描述」）</Label>
                <Textarea
                  rows={4}
                  value={join.joinSteps}
                  onChange={(event) => setJoin({ ...join, joinSteps: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">对报名者的期望（每行一条）</Label>
                <Textarea
                  rows={3}
                  value={join.joinRequirements}
                  onChange={(event) => setJoin({ ...join, joinRequirements: event.target.value })}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                同时驱动首页招新横幅与「加入我们」页面（横幅只在报名通道开着时显示）。改完记得点右上角「保存全部设置」。
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
