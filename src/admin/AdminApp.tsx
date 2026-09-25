import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { adminLogout, adminMe, type AdminIdentity } from '@/api/endpoints'
import { AdminLayout } from './AdminLayout'
import { LoginPage } from './LoginPage'
import { Dashboard } from './Dashboard'
import { ContentPage } from './ContentPage'
import { AuditPage } from './AuditPage'
import { SettingsPage } from './SettingsPage'
import { BoardPage } from './recruit/BoardPage'
import { CyclePage } from './recruit/CyclePage'
import { ApplicationsPage } from './recruit/ApplicationsPage'
import { ScoresPage } from './recruit/ScoresPage'
import { AutoPage } from './recruit/AutoPage'
import { TemplatesPage } from './recruit/TemplatesPage'
import { MailsPage } from './recruit/MailsPage'
import { StoragePage } from './StoragePage'

export function AdminApp() {
  const [identity, setIdentity] = useState<AdminIdentity | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true
    adminMe()
      .then((me) => active && setIdentity(me))
      .catch(() => active && setIdentity(null))
      .finally(() => active && setChecking(false))
    return () => {
      active = false
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await adminLogout()
    } finally {
      setIdentity(null)
    }
  }, [])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (!identity) {
    return (
      <>
        <LoginPage onSuccess={setIdentity} />
        <Toaster position="top-center" />
      </>
    )
  }

  return (
    <>
      <AdminLayout identity={identity} onLogout={logout}>
        <Routes>
          <Route index element={<Dashboard />} />
          {/* 招新模块：一个侧栏入口 + 内部页签（看板 / 周期 / 报名 / 成绩 / 自动流程 / 模板 / 日志） */}
          <Route path="recruit" element={<BoardPage />} />
          <Route path="recruit/cycle" element={<CyclePage />} />
          <Route path="recruit/applications" element={<ApplicationsPage />} />
          <Route path="recruit/scores" element={<ScoresPage />} />
          <Route path="recruit/auto" element={<AutoPage />} />
          <Route path="recruit/templates" element={<TemplatesPage />} />
          <Route path="recruit/mails" element={<MailsPage />} />
          <Route path="content/:resource" element={<ContentPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="settings" element={<SettingsPage identity={identity} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminLayout>
      <Toaster position="top-center" />
    </>
  )
}
