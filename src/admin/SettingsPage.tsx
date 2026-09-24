import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_RUNTIME_CONFIG, isSsoReady, ssoStatusText, type RuntimeConfig } from '@shared/runtime'
import { DEFAULT_SITE_CONFIG, type SiteConfig } from '@shared/types'
import { parseJoinSteps, parseStatLabels, renderCopyright, splitLines, splitParagraphs } from '@shared/site'
import { ImageField } from './ImageField'
import { adminChangePassword, adminGetConfig, adminUpdateConfig, type AdminIdentity } from '@/api/endpoints'
import { ApiError, refreshRuntimeConfig } from '@/api/client'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeftRight, Eye, KeyRound, Save } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 带标签 + 提示的输入项 */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function SettingsPage({ identity }: { identity: AdminIdentity }) {
  const [site, setSite] = useState<SiteConfig>(DEFAULT_SITE_CONFIG)
  const [runtime, setRuntime] = useState<RuntimeConfig>(DEFAULT_RUNTIME_CONFIG)
  const [loading, setLoading] = useState(true)
  const [savingSite, setSavingSite] = useState(false)
  const [savingRuntime, setSavingRuntime] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    let active = true
    adminGetConfig()
      .then((response) => {
        if (!active) return
        setSite(response.site)
        setRuntime(response.runtime)
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : '加载配置失败'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  /** 局部更新站点配置 */
  const patch = (next: Partial<SiteConfig>) => setSite((prev) => ({ ...prev, ...next }))

  const saveSite = async () => {
    setSavingSite(true)
    try {
      await adminUpdateConfig({ site })
      toast.success('已保存，官网 30 秒内生效')
      refreshRuntimeConfig()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSavingSite(false)
    }
  }

  const saveRuntime = async () => {
    setSavingRuntime(true)
    try {
      const response = await adminUpdateConfig({ runtime })
      if (response.runtime) setRuntime(response.runtime)
      toast.success('流量通道已生效', {
        description: '新通道最迟 1 分钟内对全部访客生效，存量页面会在下次刷新配置时切换',
      })
      refreshRuntimeConfig()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSavingRuntime(false)
    }
  }

  const changePassword = async () => {
    if (newPassword.length < 8) return toast.error('新密码至少 8 位')
    if (newPassword !== confirmPassword) return toast.error('两次输入的新密码不一致')
    setChanging(true)
    try {
      await adminChangePassword(currentPassword, newPassword)
      toast.success('密码已修改，请使用新密码重新登录')
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '修改失败')
    } finally {
      setChanging(false)
    }
  }

  // ===== 实时预览：把多行文本框解析成人能读懂的结果，避免填错格式 =====
  const preview = useMemo(
    () => ({
      paragraphs: splitParagraphs(site.aboutParagraphs).length,
      statLabels: parseStatLabels(site.statLabels, ['在组成员', '毕业成员', '工作室项目', '团队动态']),
      steps: parseJoinSteps(site.joinSteps),
      requirements: splitLines(site.joinRequirements),
      copyright: renderCopyright(site.footerCopyright),
    }),
    [site],
  )

  const SaveBar = ({ children }: { children?: ReactNode }) => (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <div className="text-[11px] text-muted-foreground">{children}</div>
      <Button onClick={() => void saveSite()} disabled={savingSite} className="gap-1.5">
        <Save className="h-4 w-4" /> {savingSite ? '保存中…' : '保存'}
      </Button>
    </div>
  )

  const channel = (
    label: string,
    value: RuntimeConfig['join'],
    onChange: (next: RuntimeConfig['join']) => void,
    hint: string,
  ) => (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex gap-1.5">
          {(['cloudflare', 'edgeone'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onChange({ ...value, mode })}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs transition-colors',
                value.mode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-foreground/70 hover:bg-secondary',
              )}
            >
              {mode === 'cloudflare' ? 'Cloudflare 本站' : '国内 EdgeOne'}
            </button>
          ))}
        </div>
      </div>
      {value.mode === 'edgeone' && (
        <div className="mt-3 grid gap-1.5">
          <Label className="text-xs">国内服务基址</Label>
          <Input
            value={value.edgeone}
            onChange={(e) => onChange({ ...value, edgeone: e.target.value })}
            placeholder="https://qr.example.cn"
          />
          {!value.edgeone && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-600">
              <AlertTriangle className="h-3 w-3" /> 未填写基址时，请求会自动回落到本站通道
            </p>
          )}
        </div>
      )}
    </div>
  )

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">系统设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            工作室的品牌、文案、联系方式与流量通道都在这里维护，保存后官网 30 秒内生效
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open('/', '_blank')}>
          <Eye className="h-3.5 w-3.5" /> 预览官网
        </Button>
      </div>

      <Tabs defaultValue="brand">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="brand">品牌与联系方式</TabsTrigger>
          <TabsTrigger value="about">首页简介</TabsTrigger>
          <TabsTrigger value="recruit">招新与加入我们</TabsTrigger>
          <TabsTrigger value="footer">页脚</TabsTrigger>
          <TabsTrigger value="channel">流量通道</TabsTrigger>
          <TabsTrigger value="security">管理员密码</TabsTrigger>
        </TabsList>

        {/* ===== 品牌与联系方式 ===== */}
        <TabsContent value="brand" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-5">
            <Field label="工作室 Logo" hint="建议正方形透明底 PNG，≤2MB；留空则使用内置标识">
              <ImageField
                value={site.logoUrl}
                onChange={(next) => patch({ logoUrl: next })}
                scope="brand"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="工作室名称" hint="用于导航栏、页脚与浏览器标题">
                <Input value={site.studioName} onChange={(e) => patch({ studioName: e.target.value })} />
              </Field>
              <Field label="英文名 / 副标题" hint="显示在页脚右下角">
                <Input value={site.studioNameEn} onChange={(e) => patch({ studioNameEn: e.target.value })} />
              </Field>
            </div>

            <Field label="一句话定位" hint="显示在页脚，建议不超过 40 字">
              <Textarea value={site.slogan} rows={2} onChange={(e) => patch({ slogan: e.target.value })} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="联系邮箱">
                <Input
                  value={site.contactEmail}
                  onChange={(e) => patch({ contactEmail: e.target.value })}
                  placeholder="studio@example.edu.cn"
                />
              </Field>
              <Field label="联系电话" hint="留空则页脚不显示这一行">
                <Input
                  value={site.contactPhone}
                  onChange={(e) => patch({ contactPhone: e.target.value })}
                  placeholder="选填"
                />
              </Field>
              <Field label="联系地址">
                <Input
                  value={site.contactAddress}
                  onChange={(e) => patch({ contactAddress: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <SaveBar>修改名称或 Logo 后，官网导航栏、页脚与浏览器标签会一起更新</SaveBar>
        </TabsContent>

        {/* ===== 首页简介 ===== */}
        <TabsContent value="about" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-5">
            <Field label="简介标题">
              <Input value={site.aboutTitle} onChange={(e) => patch({ aboutTitle: e.target.value })} />
            </Field>

            <Field
              label="简介正文"
              hint={`空行分段，当前 ${preview.paragraphs} 段`}
            >
              <Textarea
                value={site.aboutParagraphs}
                rows={10}
                onChange={(e) => patch({ aboutParagraphs: e.target.value })}
                placeholder="第一段…&#10;&#10;第二段…"
              />
            </Field>

            <Field
              label="统计数字的标签"
              hint="逗号分隔，共 4 个，依次对应下方四个数字"
            >
              <Input value={site.statLabels} onChange={(e) => patch({ statLabels: e.target.value })} />
            </Field>

            <div className="flex flex-wrap gap-2">
              {preview.statLabels.map((label, index) => (
                <span key={index} className="rounded-full bg-secondary px-3 py-1 text-xs text-foreground/70">
                  {label}
                </span>
              ))}
            </div>
          </div>
          <SaveBar>统计数字本身由成员 / 项目 / 新闻数量自动计算，这里只改标签文字</SaveBar>
        </TabsContent>

        {/* ===== 招新与加入我们 ===== */}
        <TabsContent value="recruit" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-5">
            <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
              <div>
                <div className="text-sm font-medium">开放招新报名</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  关闭后「加入我们」不再提供报名入口，首页招新横幅与顶部提示也会隐藏
                </p>
              </div>
              <Switch checked={site.recruitOpen} onCheckedChange={(checked) => patch({ recruitOpen: checked })} />
            </div>

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

            <Field
              label="招新流程"
              hint={`每行一条，格式「标题 | 描述」，当前 ${preview.steps.length} 条`}
            >
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
                {preview.steps.map((step) => (
                  <div key={step.no} className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-border py-2.5 last:border-b-0">
                    <span className="font-display text-accent">{step.no}</span>
                    <div>
                      <div className="text-sm font-medium">{step.title || '（缺少标题）'}</div>
                      <div className="text-xs text-muted-foreground">{step.desc || '（无描述）'}</div>
                    </div>
                  </div>
                ))}
                {preview.steps.length === 0 && (
                  <p className="text-xs text-muted-foreground">还没有填写流程</p>
                )}
              </div>
            </div>

            <Field
              label="对报名者的期望"
              hint={`每行一条，当前 ${preview.requirements.length} 条；留空则不显示该区块`}
            >
              <Textarea
                value={site.joinRequirements}
                rows={5}
                onChange={(e) => patch({ joinRequirements: e.target.value })}
              />
            </Field>
          </div>
          <SaveBar>这里的内容同时驱动首页招新横幅与「加入我们」页面</SaveBar>
        </TabsContent>

        {/* ===== 页脚 ===== */}
        <TabsContent value="footer" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-5">
            <Field label="底部跑马灯文案" hint="会横向滚动重复播放，建议用「·」分隔的短语">
              <Textarea value={site.marqueeText} rows={2} onChange={(e) => patch({ marqueeText: e.target.value })} />
            </Field>
            <Field label="版权行" hint="可用 {year} 表示当前年份">
              <Input
                value={site.footerCopyright}
                onChange={(e) => patch({ footerCopyright: e.target.value })}
              />
            </Field>
            <div className="rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm">
              预览：{preview.copyright}
            </div>
          </div>
          <SaveBar>页脚右上角的英文名与「一句话定位」在「品牌与联系方式」里修改</SaveBar>
        </TabsContent>

        {/* ===== 流量通道 ===== */}
        <TabsContent value="channel" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">
            高峰期可把「加入我们」相关接口切到国内边缘服务分流；
            教务网登录的开关与授权服务器地址在这里维护，保存后官网立即生效
          </p>

          <div className="mt-5 grid gap-4">
            <div className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">教务网登录</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    关闭后官网不展示登录入口；已登录的同学保持登录态，不受影响
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs',
                      runtime.sso.enabled ? 'font-medium text-emerald-600' : 'text-muted-foreground',
                    )}
                  >
                    {runtime.sso.enabled ? '已开启' : '已关闭'}
                  </span>
                  <Switch
                    checked={runtime.sso.enabled}
                    onCheckedChange={(checked) =>
                      setRuntime({ ...runtime, sso: { ...runtime.sso, enabled: checked } })
                    }
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-1.5">
                <Label className="text-xs">授权服务器地址</Label>
                <Input
                  value={runtime.sso.authorizeBase}
                  onChange={(e) =>
                    setRuntime({ ...runtime, sso: { ...runtime.sso, authorizeBase: e.target.value } })
                  }
                  placeholder="https://sso.example.cn"
                />
                <p
                  className={cn(
                    'text-[11px]',
                    isSsoReady(runtime.sso) ? 'text-emerald-600' : 'text-amber-600',
                  )}
                >
                  {ssoStatusText(runtime.sso)}
                </p>
              </div>

              <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                授权服务器部署在国内 EdgeOne（另一个仓库维护）。这里的地址必须与服务端登记一致；
                客户端密钥 <code className="rounded bg-secondary px-1">SSO_CLIENT_SECRET</code> 与回调地址{' '}
                <code className="rounded bg-secondary px-1">SSO_REDIRECT_URI</code> 属于敏感配置，
                仍由服务端环境变量管理，不在后台填写。
              </p>
            </div>

            {channel(
              '报名提交',
              runtime.join,
              (next) => setRuntime({ ...runtime, join: next }),
              '报名提交接口属于下一阶段，通道配置先在这里预留',
            )}

            <div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
              <div>
                <div className="text-sm font-medium">失败自动切换备用通道</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  主通道超时或返回 5xx 时自动重试备用通道（仅幂等请求）
                </p>
                <div className="mt-2">
                  <Switch
                    checked={runtime.failover}
                    onCheckedChange={(checked) => setRuntime({ ...runtime, failover: checked })}
                  />
                </div>
              </div>
              <div>
                <div className="text-sm font-medium">灰度比例</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  按设备哈希把指定百分比的流量导向国内通道，0 表示全量走主通道
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={String(runtime.rolloutPercent)}
                    onChange={(e) =>
                      setRuntime({
                        ...runtime,
                        rolloutPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                      })
                    }
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              当前生效版本 v{runtime.version}
              {runtime.updatedAt ? ` · 最近切换 ${new Date(runtime.updatedAt).toLocaleString('zh-CN')}` : ''}
            </p>
          </div>

          <div className="mt-6 flex justify-end border-t border-border pt-4">
            <Button onClick={() => void saveRuntime()} disabled={savingRuntime} className="gap-1.5">
              <ArrowLeftRight className="h-4 w-4" /> {savingRuntime ? '切换中…' : '保存并生效'}
            </Button>
          </div>
        </TabsContent>

        {/* ===== 管理员密码 ===== */}
        <TabsContent value="security" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <KeyRound className="h-4 w-4 text-accent" /> 管理员密码
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            当前账号：{identity.name}（@{identity.username}）· 修改后所有已登录设备都会退出
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="当前密码">
              <Input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
            <Field label="新密码（≥8 位）">
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <Field label="确认新密码">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-6 flex justify-end border-t border-border pt-4">
            <Button onClick={() => void changePassword()} disabled={changing}>
              {changing ? '修改中…' : '修改密码'}
            </Button>
          </div>

          <div className="mt-6 rounded-xl border border-dashed border-border bg-secondary/30 p-4">
            <h3 className="text-sm font-bold">换届交接说明</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              账号数据存放在 Cloudflare D1，不绑定任何个人云账号。交接时把项目交接文档与 Cloudflare 账号一并移交，
              下一届成员即可在此页面自行改密码、继续维护内容。若密码丢失，可用交接文档中保管的恢复口令重置。
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
