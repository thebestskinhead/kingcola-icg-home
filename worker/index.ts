/**
 * 拾光工作室官网 · Worker 入口
 *
 * 静态资源由 Cloudflare 直接返回（wrangler.toml 里 run_worker_first = ["/api/*"]），
 * 只有 /api/* 会进入本函数，因此静态访问不消耗 Worker 调用配额。
 */

import type { Env } from './env'
import { readSession } from './lib/auth'
import { fail, preflight, withCors } from './lib/http'
import { matchRoute, type RequestContext, type RouteDef } from './lib/router'
import { readStudentSession } from './lib/student-auth'
import {
  bootstrap,
  changePassword,
  login,
  logout,
  me,
  seedContent,
} from './routes/admin-auth'
import {
  deleteApplicationAdmin,
  downloadApplicationFile,
  getApplicationAdmin,
  listApplicationsAdmin,
  updateApplicationAdmin,
} from './routes/admin-applications'
import {
  createContent,
  deleteContent,
  getAdminConfig,
  getAudit,
  getContent,
  getStats,
  listContent,
  updateAdminConfig,
  updateContent,
} from './routes/admin-content'
import { confirmInvite, getInvite, myApplication, submitApplication } from './routes/applications'
import { getRuntimeConfig } from './routes/config'
import { sendTestMail } from './routes/mail'
import { getBootstrap, getPublicContent, getSiteConfigRoute, health } from './routes/public'
import { ssoCallback, ssoLogin, ssoLogout, ssoMe } from './routes/sso'
import { serveFile, uploadImage } from './routes/uploads'

const routes: RouteDef[] = [
  // ---- 自检与运行时配置 ----
  { method: 'GET', path: '/api/health', handler: health },
  { method: 'GET', path: '/api/config/runtime', handler: getRuntimeConfig },

  // ---- 公开只读内容 ----
  { method: 'GET', path: '/api/public/site-config', handler: getSiteConfigRoute },
  { method: 'GET', path: '/api/public/bootstrap', handler: getBootstrap },
  { method: 'GET', path: '/api/public/content/:resource', handler: getPublicContent },

  // ---- 文件（头像等）：上传需管理员，读取公开且长缓存 ----
  // 例外：applications/ 前缀是报名表（含个人信息），只有管理员下载得到，见 serveFile
  { method: 'POST', path: '/api/admin/uploads', handler: uploadImage, auth: 'admin' },
  { method: 'GET', path: '/api/files/*', handler: serveFile },

  // ---- 招新报名（学生侧，身份由教务网会话背书） ----
  { method: 'POST', path: '/api/applications', handler: submitApplication, auth: 'student' },
  { method: 'GET', path: '/api/applications/me', handler: myApplication, auth: 'student' },
  // 邀请函：凭证即密权，不要求登录（会话过期了也能确认加入）
  { method: 'GET', path: '/api/applications/invite/:token', handler: getInvite },
  { method: 'POST', path: '/api/applications/invite/:token', handler: confirmInvite },

  // ---- 教务网单点登录（授权码模式，授权服务器部署在国内 EdgeOne） ----
  { method: 'GET', path: '/api/auth/login', handler: ssoLogin },
  { method: 'GET', path: '/api/auth/callback', handler: ssoCallback },
  { method: 'GET', path: '/api/auth/me', handler: ssoMe },
  { method: 'POST', path: '/api/auth/logout', handler: ssoLogout },

  // ---- 管理员认证 ----
  { method: 'POST', path: '/api/admin/bootstrap', handler: bootstrap },
  { method: 'POST', path: '/api/admin/login', handler: login },
  { method: 'POST', path: '/api/admin/logout', handler: logout },
  { method: 'GET', path: '/api/admin/me', handler: me, auth: 'admin' },
  { method: 'POST', path: '/api/admin/change-password', handler: changePassword, auth: 'admin' },
  { method: 'POST', path: '/api/admin/seed-content', handler: seedContent, auth: 'admin' },

  // ---- 后台：概览 / 审计 / 配置 ----
  { method: 'GET', path: '/api/admin/stats', handler: getStats, auth: 'admin' },
  { method: 'GET', path: '/api/admin/audit', handler: getAudit, auth: 'admin' },
  { method: 'GET', path: '/api/admin/config', handler: getAdminConfig, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/config', handler: updateAdminConfig, auth: 'admin' },

  // ---- 邮件通知（SMTP，当前为空实现，配置见 runtime.mail） ----
  { method: 'POST', path: '/api/admin/mail/test', handler: sendTestMail, auth: 'admin' },

  // ---- 后台：招新报名管理（状态流转 + 通知邮件 + 报名表下载） ----
  { method: 'GET', path: '/api/admin/applications', handler: listApplicationsAdmin, auth: 'admin' },
  { method: 'GET', path: '/api/admin/applications/:id', handler: getApplicationAdmin, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/applications/:id', handler: updateApplicationAdmin, auth: 'admin' },
  { method: 'GET', path: '/api/admin/applications/:id/file', handler: downloadApplicationFile, auth: 'admin' },
  { method: 'DELETE', path: '/api/admin/applications/:id', handler: deleteApplicationAdmin, auth: 'admin' },

  // ---- 后台：内容 CRUD（资源无关，由 shared/resources.ts 驱动） ----
  { method: 'GET', path: '/api/admin/content/:resource', handler: listContent, auth: 'admin' },
  { method: 'POST', path: '/api/admin/content/:resource', handler: createContent, auth: 'admin' },
  { method: 'GET', path: '/api/admin/content/:resource/:id', handler: getContent, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/content/:resource/:id', handler: updateContent, auth: 'admin' },
  { method: 'DELETE', path: '/api/admin/content/:resource/:id', handler: deleteContent, auth: 'admin' },
]

async function handle(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return preflight(request, env)

  const matched = matchRoute(routes, request.method, url.pathname)

  if (!matched) {
    if (url.pathname.startsWith('/api/')) {
      return fail(404, 'NOT_FOUND', `接口不存在：${request.method} ${url.pathname}`)
    }
    // 兜底：若未配置 run_worker_first，静态资源仍可正常返回
    return env.ASSETS.fetch(request)
  }

  const ctx: RequestContext = {
    request,
    env,
    url,
    params: matched.params,
    exec,
  }

  if (matched.route.auth === 'admin') {
    const session = await readSession(request, env)
    if (!session) return fail(401, 'UNAUTHENTICATED', '未登录或会话已过期')
    ctx.admin = session
  } else if (matched.route.auth === 'student') {
    // 报名学生会话（教务网登录后签发），与管理员会话互不影响
    const session = await readStudentSession(request, env)
    if (!session) {
      return fail(401, 'UNAUTHENTICATED', '请先用教务网账号完成身份认证')
    }
    ctx.student = session
  }

  try {
    return await matched.route.handler(ctx)
  } catch (error) {
    console.error('[worker] handler failed', { path: url.pathname, error })
    return fail(500, 'INTERNAL_ERROR', '服务异常，请稍后重试')
  }
}

export default {
  async fetch(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const response = await handle(request, env, exec)
    return withCors(response, request, env)
  },
} satisfies ExportedHandler<Env>
