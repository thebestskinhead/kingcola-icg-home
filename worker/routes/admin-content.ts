/**
 * 后台内容管理接口（全部需要管理员会话）。
 *
 * 路由是「资源无关」的：/api/admin/content/:resource 支持 members|projects|news|slides，
 * 校验、SQL、审计都由 shared/resources.ts 的元数据驱动，新增内容类型无需改这里。
 */

import type { SmtpConfig } from '../../shared/mail'
import { RESOURCES, isResourceKey, validateEntity } from '../../shared/resources'
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '../../shared/runtime'
import type { SiteConfig } from '../../shared/types'
import { invalidateRuntimeConfigCache, publicRuntimeConfig, resolveRuntimeConfig } from './config'
import { encryptMailPassword, mailPasswordSourceOf } from '../lib/mailer'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import {
  countEntities,
  createEntity,
  deleteEntity,
  getEntity,
  getSiteConfig,
  listAuditLogs,
  listEntities,
  setConfigValue,
  setSiteConfig,
  updateEntity,
  writeAudit,
  type Entity,
} from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { deleteStoredFile } from '../lib/storage'

function resolveDef(ctx: RequestContext) {
  const key = ctx.params.resource
  if (!isResourceKey(key)) return null
  return RESOURCES[key]
}

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

export async function listContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const search = ctx.url.searchParams.get('q') ?? undefined
  const limit = Number(ctx.url.searchParams.get('limit') ?? 500)
  const offset = Number(ctx.url.searchParams.get('offset') ?? 0)

  const [items, total] = await Promise.all([
    listEntities(ctx.env, def, { search, limit, offset }),
    countEntities(ctx.env, def, search),
  ])

  return ok({ resource: def.key, items, total })
}

export async function getContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const item = await getEntity(ctx.env, def, ctx.params.id)
  if (!item) return fail(404, 'NOT_FOUND', '记录不存在')
  return ok(item)
}

export async function createContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const body = await readJsonBody<Entity>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const error = validateEntity(def, body)
  if (error) return fail(400, 'VALIDATION_FAILED', error)

  const created = await createEntity(ctx.env, def, body)
  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'create',
    resource: def.key,
    targetId: String(created.id),
    detail: JSON.stringify(body).slice(0, 500),
    ...requestMeta(ctx),
  })

  return ok(created, { status: 201 })
}

export async function updateContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const body = await readJsonBody<Entity>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const error = validateEntity(def, body)
  if (error) return fail(400, 'VALIDATION_FAILED', error)

  const before = await getEntity(ctx.env, def, ctx.params.id)
  if (!before) return fail(404, 'NOT_FOUND', '记录不存在')

  const updated = await updateEntity(ctx.env, def, ctx.params.id, body)
  if (!updated) return fail(404, 'NOT_FOUND', '记录不存在')

  // 图片字段被替换时顺手删掉旧文件，避免桶里堆积孤儿文件
  for (const field of def.fields) {
    if (field.type !== 'image') continue
    const oldValue = before[field.key]
    if (typeof oldValue === 'string' && oldValue && oldValue !== body[field.key]) {
      await deleteStoredFile(ctx.env, oldValue)
    }
  }

  const changed = Object.keys(body).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(body[key]))
  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'update',
    resource: def.key,
    targetId: ctx.params.id,
    detail: `字段：${changed.join(', ')}`,
    ...requestMeta(ctx),
  })

  return ok(updated)
}

export async function deleteContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const before = await getEntity(ctx.env, def, ctx.params.id)
  if (!before) return fail(404, 'NOT_FOUND', '记录不存在')

  const removed = await deleteEntity(ctx.env, def, ctx.params.id)
  if (!removed) return fail(404, 'NOT_FOUND', '记录不存在')

  // 删除记录时一并清理它引用的本站文件
  for (const field of def.fields) {
    if (field.type !== 'image') continue
    await deleteStoredFile(ctx.env, before[field.key] as string | undefined)
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'delete',
    resource: def.key,
    targetId: ctx.params.id,
    detail: String(before.name ?? before.title ?? ''),
    ...requestMeta(ctx),
  })

  return ok({ id: ctx.params.id })
}

// ===== 站点配置与流量开关 =====

export async function getAdminConfig(ctx: RequestContext): Promise<Response> {
  const [site, runtime] = await Promise.all([getSiteConfig(ctx.env), resolveRuntimeConfig(ctx)])
  return ok({
    site,
    // 后台同样拿不到密码明文，只拿到「有没有配、配在哪」—— 所以表单留空即代表「不修改」
    runtime: publicRuntimeConfig(runtime),
    mailPasswordSource: mailPasswordSourceOf(ctx.env, runtime.mail),
  })
}

interface SiteConfigBody {
  site?: Partial<SiteConfig>
  runtime?: Partial<RuntimeConfig>
}

export async function updateAdminConfig(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<SiteConfigBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  let site: SiteConfig | null = null
  let runtime: RuntimeConfig | null = null
  let mailPasswordSource: 'database' | 'env' | 'none' | undefined

  if (body.site) {
    site = await setSiteConfig(ctx.env, body.site)
    await writeAudit(ctx.env, {
      actor: actorOf(ctx),
      action: 'update',
      resource: 'site_config',
      detail: JSON.stringify(body.site).slice(0, 500),
      ...requestMeta(ctx),
    })
  }

  if (body.runtime) {
    const current = await resolveRuntimeConfig(ctx)

    // SMTP 密码单独处理：前端永远看不到原值，所以
    // 没带 password 键 = 不修改；带空串 = 清除；带内容 = 更新（落库前加密）
    const incomingMail: Partial<SmtpConfig> = { ...(body.runtime.mail ?? {}) }
    const submittedPassword =
      typeof incomingMail.password === 'string' ? incomingMail.password.trim() : undefined
    delete incomingMail.password

    let password = current.mail.password ?? ''
    if (submittedPassword !== undefined) {
      password = submittedPassword ? await encryptMailPassword(ctx.env, submittedPassword) : ''
    }

    // body.runtime 里可能夹带着提交上来的 mail（含明文密码），先摘掉再合并，免得明文进落库对象
    const restRuntime: Partial<RuntimeConfig> = { ...body.runtime }
    delete restRuntime.mail

    const next: RuntimeConfig = {
      ...DEFAULT_RUNTIME_CONFIG,
      ...current,
      ...restRuntime,
      sso: { ...current.sso, ...(body.runtime.sso ?? {}) },
      mail: { ...current.mail, ...incomingMail, password },
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    }
    await setConfigValue(ctx.env, 'runtime', next)
    await invalidateRuntimeConfigCache(ctx.env)
    // 密码来源要在剥离前算（剥离后就看不出「数据库里有密码」了）
    mailPasswordSource = mailPasswordSourceOf(ctx.env, next.mail)
    // 回给前端的永远是剥离过的版本
    runtime = publicRuntimeConfig(next)

    await writeAudit(ctx.env, {
      actor: actorOf(ctx),
      action: 'switch_channel',
      resource: 'runtime_config',
      detail: `sso=${next.sso.enabled ? 'on' : 'off'} mail=${next.mail.enabled ? 'on' : 'off'} → v${next.version}`,
      ...requestMeta(ctx),
    })
  }

  return ok({ site, runtime, mailPasswordSource })
}

// ===== 概览与审计 =====

export async function getStats(ctx: RequestContext): Promise<Response> {
  const [members, projects, news, slides] = await Promise.all([
    countEntities(ctx.env, RESOURCES.members),
    countEntities(ctx.env, RESOURCES.projects),
    countEntities(ctx.env, RESOURCES.news),
    countEntities(ctx.env, RESOURCES.slides),
  ])

  const recent = await listEntities(ctx.env, RESOURCES.news, { limit: 5 })
  const recentMembers = await listEntities(ctx.env, RESOURCES.members, { limit: 5 })

  return ok({
    counts: { members, projects, news, slides },
    recentNews: recent,
    recentMembers,
  })
}

export async function getAudit(ctx: RequestContext): Promise<Response> {
  const limit = Number(ctx.url.searchParams.get('limit') ?? 100)
  const logs = await listAuditLogs(ctx.env, limit)
  return ok({ logs })
}
