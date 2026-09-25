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
import { RecruitPage } from './recruit/RecruitPage'
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
          {/* 招新模块：一页到底（休眠 → 启动 → 备招 → 报名 → 笔试 → 面试 → 答辩 → 转正 → 归档）。
              阶段的开与关全部由管理员点击推进，页面不出现任何时间字段；
              内部四个视图：流程 / 名单 / 邮件日志 / 设置。 */}
          <Route path="recruit" element={<RecruitPage />} />
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
