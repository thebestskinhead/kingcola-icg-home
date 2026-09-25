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
import { StagePage } from './recruit/StagePage'
import { DemoEventDrivenPage } from './recruit/DemoEventDrivenPage'
import { RecruitSettingsPage } from './recruit/RecruitSettingsPage'
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
          {/* 招新模块：一个侧栏入口 + 内部页签。
              主体按**阶段**组织（准备 → 报名 → 笔试 → 面试 → 答辩 → 转正），
              每个阶段页 = 操作区 + 数据区；看板 / 名单 / 模板 / 日志是跨阶段的全局页。
              成绩录入与自动流程不再单独开页，已并入对应阶段页。 */}
          <Route path="recruit" element={<BoardPage />} />
          <Route path="recruit/prepare" element={<CyclePage />} />
          <Route path="recruit/apply" element={<StagePage stage="apply" />} />
          <Route path="recruit/written" element={<StagePage stage="written" />} />
          <Route path="recruit/interview" element={<StagePage stage="interview" />} />
          <Route path="recruit/defense" element={<StagePage stage="defense" />} />
          <Route path="recruit/onboard" element={<StagePage stage="onboard" />} />
          <Route path="recruit/roster" element={<ApplicationsPage />} />
          {/* ⚠️ 临时 DEMO（事件驱动信息架构，假数据）：确认后删除本行与 DemoEventDrivenPage.tsx */}
          <Route path="recruit/demo" element={<DemoEventDrivenPage />} />
          <Route path="recruit/settings" element={<RecruitSettingsPage />} />
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
