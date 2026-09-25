/**
 * 招新模块的「设置」页 —— 内部用标签页切换对应功能：
 *   邮件模板         各阶段通知信的主题与正文（原「邮件模板」页并入）
 *   招新与加入我们   首页招新横幅与「加入我们」页文案（原「系统设置 → 招新与加入我们」迁来）
 *
 * 为什么收进来：这些配置只有管理招新的人会用，散在系统设置里要来回跳。
 * 注意「招新与加入我们」改的是站点配置（site_config['site']），与招新周期（site_config['recruit']）是两份数据。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_SITE_CONFIG, type SiteConfig } from '@shared/types'
import { parseJoinSteps, splitLines } from '@shared/site'
import { adminGetConfig, adminUpdateConfig } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { RecruitTabs } from './RecruitTabs'
import { useRecruitSettings } from './useRecruitSettings'
import { TemplatesPanel } from './TemplatesPage'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** 「招新与加入我们」的站点文案（自包含：自己读写 site_config['site']） */
function JoinCopyPanel() {
  const [site, setSite] = useState<SiteConfig>(DEFAULT_SITE_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    adminGetConfig()
      .then((response) => active && setSite(response.site))
      .catch((error) => toast.error(error instanceof ApiError ? error.message : '加载配置失败'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  const patch = (next: Partial<SiteConfig>) => setSite((prev) => ({ ...prev, ...next }))

  const save = async () => {
    setSaving(true)
    try {
      await adminUpdateConfig({ site })
      toast.success('已保存，官网 30 秒内生效')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const steps = useMemo(() => parseJoinSteps(site.joinSteps), [site.joinSteps])
  const requirementCount = useMemo(() => splitLines(site.joinRequirements).length, [site.joinRequirements])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Field label="首页招新横幅标题">
        <Input value={site.recruitTitle} onChange={(e) => patch({ recruitTitle: e.target.value })} />
      </Field>

      <Field label="首页招新横幅描述">
        <Textarea value={site.recruitDesc} rows={3} onChange={(e) => patch({ recruitDesc: e.target.value })} />
      </Field>

      <div className="border-t border-border pt-5">
        <Field label="「加入我们」页面标题">
          <Input value={site.joinTitle} onChange={(e) => patch({ joinTitle: e.target.value })} />
        </Field>
      </div>

      <Field label="「加入我们」页面描述">
        <Textarea value={site.joinIntro} rows={3} onChange={(e) => patch({ joinIntro: e.target.value })} />
      </Field>

      <Field label="招新流程" hint={`每行一条，格式「标题 | 描述」，当前 ${steps.length} 条`}>
        <Textarea
          value={site.joinSteps}
          rows={6}
          onChange={(e) => patch({ joinSteps: e.target.value })}
          placeholder="扫码完成身份认证 | 使用微信扫描二维码…"
        />
      </Field>

      <div className="grid gap-1.5">
        <Label>流程预览</Label>
        <div className="rounded-xl border border-border bg-secondary/30 p-4">
          {steps.map((step) => (
            <div key={step.no} className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-border py-2.5 last:border-b-0">
              <span className="font-display text-accent">{step.no}</span>
              <div>
                <div className="text-sm font-medium">{step.title || '（缺少标题）'}</div>
                <div className="text-xs text-muted-foreground">{step.desc || '（无描述）'}</div>
              </div>
            </div>
          ))}
          {steps.length === 0 && <p className="text-xs text-muted-foreground">还没有填写流程</p>}
        </div>
      </div>

      <Field label="对报名者的期望" hint={`每行一条，当前 ${requirementCount} 条；留空则不显示该区块`}>
        <Textarea value={site.joinRequirements} rows={5} onChange={(e) => patch({ joinRequirements: e.target.value })} />
      </Field>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">这些内容同时驱动首页招新横幅与「加入我们」页面</span>
        <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 保存
        </Button>
      </div>
    </div>
  )
}

export function RecruitSettingsPage() {
  const { settings, loading, reload } = useRecruitSettings()

  const reloadRef = useCallback(() => reload(), [reload])

  return (
    <div className="mx-auto max-w-5xl">
      <RecruitTabs settings={settings} loading={loading} onReload={reloadRef} />

      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          招新的文案与通知配置都收在这里，用标签页切换。
        </p>
      </div>

      <Tabs defaultValue="mail">
        <TabsList>
          <TabsTrigger value="mail">邮件模板</TabsTrigger>
          <TabsTrigger value="join">招新与加入我们</TabsTrigger>
        </TabsList>
        <TabsContent value="mail" className="mt-4">
          <TemplatesPanel />
        </TabsContent>
        <TabsContent value="join" className="mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <JoinCopyPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
