import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { adminLogout, adminMe, type AdminIdentity } from '@/api/endpoints'
import { AdminLayout } from './AdminLayout'
import { LoginPage } from './LoginPage'
import { Dashboard } from './Dashboard'
import { ContentPage } from './ContentPage'
import { ApplicationsPage } from './ApplicationsPage'
import { AuditPage } from './AuditPage'
import { SettingsPage } from './SettingsPage'

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
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="content/:resource" element={<ContentPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage identity={identity} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminLayout>
      <Toaster position="top-center" />
    </>
  )
}
