import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LogoMark } from '@/components/brand'
import { adminLogin, type AdminIdentity } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { toast } from 'sonner'
import { KeyRound, ShieldCheck } from 'lucide-react'

export function LoginPage({ onSuccess }: { onSuccess: (identity: AdminIdentity) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('请输入用户名与密码')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const identity = await adminLogin(username.trim(), password)
      toast.success(`欢迎回来，${identity.name}`)
      onSuccess(identity)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '登录失败，请稍后重试'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="h-10 w-10" />
          <h1 className="mt-4 font-display text-2xl font-bold">内容管理后台</h1>
          <p className="mt-2 text-sm text-muted-foreground">拾光工作室 · 仅限内部成员使用</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-7">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="admin-username">用户名</Label>
              <Input
                id="admin-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="admin-password">密码</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            )}

            <Button type="submit" disabled={submitting} className="mt-1 w-full gap-1.5">
              <KeyRound className="h-4 w-4" />
              {submitting ? '登录中…' : '登录'}
            </Button>
          </form>

          <p className="mt-5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            账号由工作室管理员维护。若忘记密码，请查阅交接文档中的恢复口令流程。
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <a href="/" className="hover:text-foreground">
            ← 返回官网
          </a>
        </p>
      </div>
    </div>
  )
}
