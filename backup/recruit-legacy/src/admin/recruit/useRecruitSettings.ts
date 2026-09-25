import { useCallback, useEffect, useState } from 'react'
import { adminGetRecruit, type AdminRecruitSettings } from '@/api/endpoints'
import { ApiError } from '@/api/client'

/**
 * 招新模块共用的配置数据：周期、邮件模板、当前阶段。
 *
 * 每个页面各自调用一次（招新期后台并发很低，不值得为它做全局缓存），
 * 好处是页面之间零耦合 —— 改完配置在任何一个页面 `reload()` 都能拿到最新值。
 */
export function useRecruitSettings() {
  const [settings, setSettings] = useState<AdminRecruitSettings | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setSettings(await adminGetRecruit())
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '招新配置加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { settings, loading, error, reload }
}
