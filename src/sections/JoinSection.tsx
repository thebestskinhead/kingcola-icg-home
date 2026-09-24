import { useCallback, useEffect, useState } from 'react'
import { ApplicationProgress } from '@/components/ApplicationProgress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  STUDENT_LOGIN_URL,
  myApplication,
  studentLogout,
  studentMe,
  submitApplication,
} from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { useSsoTarget } from '@/api/hooks'
import {
  APPLICATION_DOC_ACCEPT,
  APPLICATION_DOC_HINT,
  APPLICATION_DOC_LIMIT,
  validateApplicationForm,
} from '@shared/recruit'
import { isSsoReady } from '@shared/runtime'
import { parseJoinSteps, splitLines } from '@shared/site'
import type { Application, SiteConfig } from '@/types'
import { CheckCircle2, QrCode, ShieldCheck, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Identity {
  studentId: string
  name: string
}

type AuthState = 'checking' | 'anonymous' | 'authenticated'

/** 回调原因 → 给用户看的话。登录失败一律回首页并带一个原因码，这里翻译成人话。 */
const LOGIN_NOTICE: Record<string, string> = {
  denied: '你取消了授权，未登录',
  state_mismatch: '登录校验未通过，请重试',
  not_configured: '教务网登录尚未接通',
  upstream_unreachable: '暂时联系不上登录服务，请稍后重试',
  exchange_failed: '登录服务未能确认你的身份，请重试',
  invalid_credential: '身份凭证校验未通过，请重新登录',
}

/** 读取并清掉地址栏里的回调提示，避免刷新时重复弹出 */
function consumeLoginNotice(): { ok: boolean; text: string } | null {
  const params = new URLSearchParams(window.location.search)
  const flag = params.get('login')
  if (!flag) return null

  params.delete('login')
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )

  if (flag === 'ok') return { ok: true, text: '登录成功' }
  return { ok: false, text: LOGIN_NOTICE[flag] ?? '登录未完成，请重试' }
}

/** 文件大小的人类可读写法 */
function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function JoinSection({ site }: { site: SiteConfig }) {
  const recruitOpen = site.recruitOpen
  const steps = parseJoinSteps(site.joinSteps)
  const requirements = splitLines(site.joinRequirements)
  // 登录入口是否展示由后台决定：开关打开且填了授权服务器地址才算接通
  const sso = useSsoTarget()
  const ssoReady = isSsoReady(sso)

  const [auth, setAuth] = useState<AuthState>('checking')
  const [identity, setIdentity] = useState<Identity | null>(null)
  /** 已提交过的报名记录；有它就不再展示上传表单，改展示进度 */
  const [application, setApplication] = useState<Application | null>(null)
  const [inviteUrl, setInviteUrl] = useState('')
  const [appLoading, setAppLoading] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [qq, setQq] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadApplication = useCallback(async () => {
    setAppLoading(true)
    try {
      const result = await myApplication()
      setApplication(result.application)
      setInviteUrl(result.inviteUrl ?? '')
    } catch {
      // 查询失败不阻断页面：表单照常可用，提交时后端还会再查一次
      setApplication(null)
      setInviteUrl('')
    } finally {
      setAppLoading(false)
    }
  }, [])

  const refreshIdentity = useCallback(async () => {
    try {
      const me = await studentMe()
      if (me.authenticated && me.studentId) {
        setIdentity({ studentId: me.studentId, name: me.name ?? '' })
        setAuth('authenticated')
        await loadApplication()
      } else {
        setIdentity(null)
        setApplication(null)
        setInviteUrl('')
        setAuth('anonymous')
      }
    } catch {
      // 查询失败不阻断页面：按未登录处理，用户仍可手动点登录
      setIdentity(null)
      setAuth('anonymous')
    }
  }, [loadApplication])

  useEffect(() => {
    const notice = consumeLoginNotice()
    if (notice) {
      if (notice.ok) toast.success(notice.text)
      else toast.error(notice.text)
    }
    void refreshIdentity()
  }, [refreshIdentity])

  const signIn = () => {
    // 整页跳转：授权流程跨域，必须交给浏览器，不能用 fetch
    window.location.href = STUDENT_LOGIN_URL
  }

  const signOut = async () => {
    try {
      await studentLogout()
    } catch {
      // 接口失败也继续刷新状态，避免界面与实际登录态不一致
    }
    await refreshIdentity()
    toast.success('已退出登录')
  }

  // ===== 报名表文件：校验真实文件头，仅改后缀无效 =====
  const checkFile = async (f: File): Promise<boolean> => {
    const head = new Uint8Array(await f.slice(0, 8).arrayBuffer())
    const isPdf = head[0] === 0x25 && head[1] === 0x50 // %P
    const isDocx = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 // ZIP 头
    if (isPdf || isDocx) return true
    setFileError('文件校验失败：仅支持 PDF 或 DOCX 格式的真实文件，仅修改后缀无效')
    return false
  }

  const onPickFile = async (f: File | null) => {
    setFileError('')
    if (!f) return
    if (!/\.(pdf|docx)$/i.test(f.name)) {
      setFileError('仅支持 .pdf 或 .docx 文件')
      return
    }
    if (f.size > APPLICATION_DOC_LIMIT) {
      setFileError(`文件不能超过 ${formatSize(APPLICATION_DOC_LIMIT)}`)
      return
    }
    if (!(await checkFile(f))) return
    setFile(f)
  }

  const submit = async () => {
    if (!file) return toast.error('请先选择报名表文件')
    const invalid = validateApplicationForm({ email, phone, qq })
    if (invalid) return toast.error(invalid)

    const form = new FormData()
    form.append('file', file)
    form.append('email', email.trim())
    form.append('phone', phone.trim())
    form.append('qq', qq.trim())

    setSubmitting(true)
    try {
      const created = await submitApplication(form)
      setApplication(created)
      setInviteUrl('')
      setFile(null)
      toast.success('报名表已提交，我们会尽快安排笔试', {
        description: '笔试与面试安排会同时发到你的邮箱，请留意查收',
      })
    } catch (error) {
      // 已经报过名：把已有记录取回来展示进度，而不是让同学对着报错发呆
      if (error instanceof ApiError && error.code === 'ALREADY_APPLIED') {
        await loadApplication()
        toast.info(error.message)
      } else {
        toast.error(error instanceof ApiError ? error.message : '提交失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl animate-fade-up px-4 py-14 sm:px-6">
      <div className="mb-12">
        <h1 className="font-display text-4xl font-bold sm:text-5xl">{site.joinTitle}</h1>
        <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {site.joinIntro}
        </p>
      </div>

      <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr]">
        {/* ===== 左：流程说明 ===== */}
        <div>
          <h2 className="mb-6 font-display text-2xl font-bold">招新流程</h2>
          <div>
            {steps.map((s) => (
              <div key={s.no} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-6 last:border-b">
                <span className="font-display text-xl text-accent">{s.no}</span>
                <div>
                  <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                  {s.desc && <p className="mt-1 text-sm leading-relaxed text-foreground/75">{s.desc}</p>}
                </div>
              </div>
            ))}
            {steps.length === 0 && (
              <div className="border-y border-border py-8 text-center text-sm text-muted-foreground">
                暂未填写招新流程
              </div>
            )}
          </div>
          {requirements.length > 0 && (
            <div className="mt-8 text-sm leading-relaxed text-muted-foreground">
              <p>我们希望你：</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ===== 右：登录 / 报名表上传 / 进度 ===== */}
        <div className="border border-border bg-card p-6 sm:p-8">
          {!recruitOpen && !(auth === 'authenticated' && application) ? (
            <div className="flex flex-col items-center py-16 text-center">
              <h3 className="font-display text-2xl font-bold">当前不在招新期</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                报名通道暂未开放。也欢迎先通过页脚邮箱与我们取得联系。
              </p>
            </div>
          ) : auth === 'checking' || (auth === 'authenticated' && appLoading) ? (
            <div className="flex flex-col items-center py-16">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <p className="mt-3 text-sm text-muted-foreground">
                {auth === 'checking' ? '正在确认登录状态…' : '正在读取你的报名进度…'}
              </p>
            </div>
          ) : auth === 'anonymous' ? (
            /* ---- 未登录 ---- */
            !ssoReady ? (
              /* 后台未接通教务网登录：不展示登录入口，给出可执行的替代方案 */
              <div className="flex flex-col items-center py-12 text-center">
                <h3 className="font-display text-2xl font-bold">教务网登录暂未开放</h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  身份认证入口尚未开放，请稍后再来，或先通过页脚邮箱与我们取得联系。
                </p>
              </div>
            ) : (
              /* 一键跳转教务网 */
              <div className="flex flex-col items-center py-10 text-center">
                <h3 className="font-display text-2xl font-bold">提交你的报名表</h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  提交前需通过学校教务网完成身份认证。登录状态保留 30 天，期间无需重复验证。
                </p>
                <Button className="mt-6 gap-2" onClick={signIn}>
                  <QrCode className="h-4 w-4" /> 使用教务网账号登录
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">
                  将跳转到教务网认证页面，用微信扫码并在手机上确认后自动返回本页
                </p>
              </div>
            )
          ) : application ? (
            /* ---- 已登录且已提交过：展示进度 ---- */
            <>
              <ApplicationProgress application={application} inviteUrl={inviteUrl} />
              <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                <span>
                  {identity?.name || '已登录'} {identity?.studentId}
                </span>
                <button onClick={() => void signOut()} className="hover:text-accent">
                  更换账号
                </button>
              </div>
            </>
          ) : (
            /* ---- 已登录且尚未报名：填写并上传 ---- */
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-bold">提交你的报名表</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 已登录
                </span>
              </div>

              {/* 已登录身份 */}
              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-secondary/40 px-4 py-3">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{identity?.name || '已登录'}</span>
                  <span className="ml-2 text-muted-foreground">{identity?.studentId}</span>
                </div>
                <button
                  onClick={() => void signOut()}
                  className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-accent"
                >
                  更换账号
                </button>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">
                身份信息由学校教务网提供，不可手动修改 · {APPLICATION_DOC_HINT}
              </p>

              {/* 文件拖放区 */}
              <label
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  void onPickFile(e.dataTransfer.files?.[0] ?? null)
                }}
                className={cn(
                  'mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                  dragOver ? 'border-accent bg-accent/5' : 'border-border bg-secondary/40 hover:border-accent/50',
                )}
              >
                <input
                  type="file"
                  accept={APPLICATION_DOC_ACCEPT}
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  {file ? file.name : '点击选择或拖拽报名表到此处'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {file
                    ? `${formatSize(file.size)} · 校验通过`
                    : '仅限 .pdf / .docx，仅修改后缀的文件无法通过校验'}
                </p>
                {fileError && <p className="mt-3 max-w-xs text-xs text-destructive">{fileError}</p>}
              </label>

              {file && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-4 py-2.5">
                  <span className="truncate text-sm">{file.name}</span>
                  <button
                    onClick={() => setFile(null)}
                    className="ml-3 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="移除文件"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>邮箱 *</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.edu.cn"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    笔试、面试通知与邀请函都会发到这个邮箱，请填写常用的
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label>手机号 *</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="11 位手机号"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>QQ 号 *</Label>
                  <Input value={qq} onChange={(e) => setQq(e.target.value)} placeholder="用于加入招新通知群" />
                </div>
              </div>

              <Button onClick={() => void submit()} className="mt-6 w-full" disabled={!file || submitting}>
                {submitting ? '正在上传…' : '上传并提交'}
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                提交后可在本页随时查看进度；一位同学只保留一条报名记录。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
