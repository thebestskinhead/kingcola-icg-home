/**
 * 设置视图（演示）。
 *
 * 两件事：① 七封邮件的模板（主题 / 正文 / 启用开关 / 变量清单 / 未知变量告警 / 实时预览）；
 * ② 招新与「加入我们」页面的文案，以及四个 QQ 群号（群号也会出现在 `备招` 面板，随时可改）。
 *
 * 模板里**不再有任何时间与地点变量** —— 安排一律通过对应的 QQ 群通知。
 */

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AlertTriangle, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { RecruitMailKind, RecruitTemplates } from '@shared/recruit'
import {
  DEMO_MAIL_META,
  DEMO_VARIABLES,
  MAIL_KINDS,
  QQ_GROUPS,
  renderDemo,
  sampleVars,
  unknownDemoVars,
  validateGroupNumbers,
  type GroupNumbers,
} from './demo-model'
import type { DemoRecruit } from './useDemoRecruit'

export function DemoSettingsPage({ demo }: { demo: DemoRecruit }) {
  const [templates, setTemplates] = useState<RecruitTemplates>(demo.templates)
  const [active, setActive] = useState<RecruitMailKind>('written_invite')
  const [cycleName, setCycleName] = useState(demo.cycleName)
  const [groups, setGroups] = useState<GroupNumbers>(demo.groups)

  // 「加入我们」与首页横幅的文案（真实现里存在站点配置，不在招新周期里）
  const [site, setSite] = useState({
    recruitTitle: '2026 年秋季招新进行中',
    recruitDesc: '无论你想写前端、做后端、搞算法还是做设计，这里都有真实的项目等着你。',
    joinTitle: '加入我们',
    joinIntro: '每年秋天，我们面向全校招募一批新成员。报名后按笔试、面试、答辩依次进行。',
    joinSteps: '扫码完成身份认证 | 使用微信扫描二维码\n填写报名信息 | 上传你的报名表',
    joinRequirements: '对技术有好奇心\n每周能保证一定的投入时间',
  })

  const template = templates[active]
  const meta = DEMO_MAIL_META[active]
  const unknown = unknownDemoVars(`${template.subject}\n${template.body}`)
  const vars = sampleVars(cycleName, groups)

  const patchTemplate = (changes: Partial<RecruitTemplates[RecruitMailKind]>) =>
    setTemplates((prev) => ({ ...prev, [active]: { ...prev[active], ...changes } }))

  const saveGroups = () => {
    const invalid = validateGroupNumbers(groups)
    if (invalid) return toast.error(invalid)
    demo.saveGroups(cycleName, groups)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            邮件模板与官网招新文案。邮件里不写时间与地点 —— 安排一律通过对应的 QQ 群通知。
          </p>
        </div>
        <Button
          className="gap-1.5"
          onClick={() => {
            demo.saveTemplates(templates)
            demo.saveGroups(cycleName, groups)
          }}
        >
          <Save className="h-4 w-4" /> 保存全部设置
        </Button>
      </div>

      <Tabs defaultValue="mail">
        <TabsList>
          <TabsTrigger value="mail">邮件模板</TabsTrigger>
          <TabsTrigger value="join">招新与加入我们</TabsTrigger>
        </TabsList>

        <TabsContent value="mail" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
            {/* 左：七封信 + 变量清单 */}
            <div className="space-y-4">
              <div className="space-y-1">
                {MAIL_KINDS.map((kind) => (
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
                      <span className="truncate">{MAIL_KIND_LABELS[kind]}</span>
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
                      {DEMO_MAIL_META[kind].trigger}
                    </div>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 text-xs font-semibold">可用变量</h3>
                <ul className="space-y-1">
                  {DEMO_VARIABLES.map((item) => (
                    <li key={item.token} className="text-[11px] text-muted-foreground">
                      <code className="text-foreground">{item.token}</code> {item.desc}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* 右：编辑 + 预览 */}
            <div className="space-y-4">
              <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{MAIL_KIND_LABELS[active]}</h3>
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
                    {renderDemo(template.subject, vars) || '（没有主题）'}
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {renderDemo(template.body, vars)}
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
              {QQ_GROUPS.map((group) => (
                <div key={group.key} className="grid gap-1.5">
                  <Label className="text-xs">{group.label}</Label>
                  <Input
                    inputMode="numeric"
                    value={groups[group.key]}
                    placeholder="如 123456789"
                    onChange={(event) => setGroups({ ...groups, [group.key]: event.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">{group.hint}</p>
                </div>
              ))}
              <p className="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2">
                所有时间与地点安排都在对应的群里通知，邮件里不再出现。群号改了会立刻体现在之后发出的邀请函里。
              </p>
            </div>

            <Button className="justify-self-start gap-1.5" onClick={saveGroups}>
              <Save className="h-4 w-4" /> 保存群号
            </Button>
          </div>

          <div className="grid gap-5 rounded-xl border border-border bg-card p-5">
            <div className="grid gap-1.5">
              <Label className="text-xs">首页招新横幅标题</Label>
              <Input
                value={site.recruitTitle}
                onChange={(event) => setSite({ ...site, recruitTitle: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">首页招新横幅描述</Label>
              <Textarea
                rows={2}
                value={site.recruitDesc}
                onChange={(event) => setSite({ ...site, recruitDesc: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">「加入我们」页面标题</Label>
              <Input value={site.joinTitle} onChange={(event) => setSite({ ...site, joinTitle: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">「加入我们」页面描述</Label>
              <Textarea
                rows={2}
                value={site.joinIntro}
                onChange={(event) => setSite({ ...site, joinIntro: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">招新流程（每行一条「标题 | 描述」）</Label>
              <Textarea
                rows={4}
                value={site.joinSteps}
                onChange={(event) => setSite({ ...site, joinSteps: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">对报名者的期望（每行一条）</Label>
              <Textarea
                rows={3}
                value={site.joinRequirements}
                onChange={(event) => setSite({ ...site, joinRequirements: event.target.value })}
              />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
              <span className="text-xs text-muted-foreground">
                同时驱动首页招新横幅与「加入我们」页面（真实现里存站点配置）
              </span>
              <Button size="sm" onClick={() => toast.success('已保存（演示）')}>
                保存文案
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

const MAIL_KIND_LABELS: Record<RecruitMailKind, string> = {
  written_invite: '笔试邀请函',
  interview_invite: '面试邀请函',
  interview_passed: '面试通过通知',
  offer: '正式成员邀请函',
  thanks_written: '感谢信 · 笔试',
  thanks_interview: '感谢信 · 面试',
  thanks_defense: '感谢信 · 答辩',
}
