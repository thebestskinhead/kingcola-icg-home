/**
 * 运行时配置下发 —— 支撑「Cloudflare 主站 + 国内 serverless 降级」的流量切换。
 *
 * 读取优先级：KV 缓存 → D1 site_config['runtime'] → 环境变量默认值。
 * 响应固定 no-store，保证后台一切换，下一个页面加载就能拿到新通道。
 */

import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig, type RuntimeConfigResponse } from '../../shared/runtime'
import { ok } from '../lib/http'
import { countAdmins } from '../lib/auth'
import { getConfigValue, getSiteConfig } from '../lib/repo'
import type { RequestContext } from '../lib/router'

const RUNTIME_CONFIG_KEY = 'runtime'
const KV_CACHE_TTL_SECONDS = 60

/**
 * 部署引导值（可选）。
 *
 * 教务网登录的开关与地址现在以后台设置为准（存在 D1）。
 * 这里保留环境变量只是为了让「已经配了 SSO_AUTHORIZE_BASE 的老部署」平滑过渡：
 * 一旦后台保存过一次，D1 里的值会覆盖它（merge 时 stored 在最外层）。
 */
function bootstrapDefaults(env: RequestContext['env']): Partial<RuntimeConfig> {
  const authorizeBase = (env.SSO_AUTHORIZE_BASE ?? '').trim()
  if (!authorizeBase) return {}
  return { sso: { enabled: true, authorizeBase } }
}

function merge(base: RuntimeConfig, ...patches: Partial<RuntimeConfig>[]): RuntimeConfig {
  let result = base
  for (const patch of patches) {
    result = {
      ...result,
      ...patch,
      sso: { ...result.sso, ...(patch.sso ?? {}) },
      mail: { ...result.mail, ...(patch.mail ?? {}) },
    }
  }
  return result
}

export async function resolveRuntimeConfig(ctx: RequestContext): Promise<RuntimeConfig> {
  const { env } = ctx

  if (env.CONFIG_KV) {
    const cached = await env.CONFIG_KV.get(RUNTIME_CONFIG_KEY, 'json')
    if (cached) return merge(DEFAULT_RUNTIME_CONFIG, cached as Partial<RuntimeConfig>)
  }

  const stored = await getConfigValue<Partial<RuntimeConfig>>(env, RUNTIME_CONFIG_KEY)
  const config = merge(DEFAULT_RUNTIME_CONFIG, bootstrapDefaults(env), stored ?? {})

  if (env.CONFIG_KV) {
    ctx.exec.waitUntil(env.CONFIG_KV.put(RUNTIME_CONFIG_KEY, JSON.stringify(config), { expirationTtl: KV_CACHE_TTL_SECONDS }))
  }
  return config
}

/** 后台切换通道后调用，立即失效 KV 缓存 */
export async function invalidateRuntimeConfigCache(env: RequestContext['env']): Promise<void> {
  if (env.CONFIG_KV) await env.CONFIG_KV.delete(RUNTIME_CONFIG_KEY)
}

export async function getRuntimeConfig(ctx: RequestContext): Promise<Response> {
  const [config, site, admins] = await Promise.all([
    resolveRuntimeConfig(ctx),
    getSiteConfig(ctx.env),
    countAdmins(ctx.env),
  ])

  const payload: RuntimeConfigResponse = {
    config,
    site,
    initialized: admins > 0,
  }

  return ok(payload, {
    headers: {
      'cache-control': 'no-store',
      'x-runtime-version': String(config.version),
    },
  })
}
