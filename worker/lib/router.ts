import type { Env } from '../env'
import type { AdminSession } from './auth'

export interface RequestContext {
  request: Request
  env: Env
  url: URL
  params: Record<string, string>
  exec: ExecutionContext
  /** 通过 auth: 'admin' 的路由会带上当前管理员会话 */
  admin?: AdminSession
}

export type RouteHandler = (ctx: RequestContext) => Promise<Response> | Response

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /**
   * 支持 `:param` 占位（如 /api/admin/content/:resource/:id），
   * 以及放在末尾的 `*` 通配（如 /api/files/*，捕获剩余路径到 params['*']）。
   */
  path: string
  handler: RouteHandler
  /** 'admin' 表示需要管理员会话 */
  auth?: 'admin'
}

export interface MatchResult {
  route: RouteDef
  params: Record<string, string>
}

export function matchRoute(routes: RouteDef[], method: string, pathname: string): MatchResult | null {
  const segments = pathname.split('/').filter(Boolean)

  for (const route of routes) {
    if (route.method !== method) continue
    const routeSegments = route.path.split('/').filter(Boolean)
    const wildcardIndex = routeSegments.indexOf('*')

    if (wildcardIndex === -1) {
      if (routeSegments.length !== segments.length) continue
    } else if (segments.length < wildcardIndex) {
      continue
    }

    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < routeSegments.length; i++) {
      const expected = routeSegments[i]

      if (expected === '*') {
        params['*'] = segments.slice(i).map((s) => decodeURIComponent(s)).join('/')
        break
      }
      if (expected.startsWith(':')) {
        if (i >= segments.length) {
          matched = false
          break
        }
        params[expected.slice(1)] = decodeURIComponent(segments[i])
      } else if (expected !== segments[i]) {
        matched = false
        break
      }
    }
    if (matched) return { route, params }
  }
  return null
}
