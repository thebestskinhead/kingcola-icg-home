/**
 * 文件上传与读取。
 *
 *   POST /api/admin/uploads   管理员上传图片（multipart/form-data，字段名 file）
 *   GET  /api/files/*         读取文件（公开，长缓存）
 *
 * 上传走 Worker 而不是预签名直传：头像这类小文件经 Worker 更简单，
 * 也不用处理 CORS 与签名过期。报名表那种大文件将来单独走 R2 预签名直传。
 */

import { formatLimit, uploadImageLimit } from '../../shared/resources'
import { readSession } from '../lib/auth'
import { clientIp, fail, ok } from '../lib/http'
import { writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { getStorage, purposeFromKey, storageReady } from '../lib/storage'
import { buildObjectKey, isPrivateKey, sniffImage } from '../lib/uploads'

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

export async function uploadImage(ctx: RequestContext): Promise<Response> {
  // 目标桶由后台「对象存储」页的 site 目标决定（R2 binding 或任意 S3 兼容存储）
  if (!(await storageReady(ctx.env, 'site'))) {
    return fail(503, 'STORAGE_UNAVAILABLE', '对象存储未接通，无法上传文件（请到后台「对象存储」检查配置）')
  }
  const storage = await getStorage(ctx.env, 'site')

  let form: FormData
  try {
    form = await ctx.request.formData()
  } catch (error) {
    // 带上底层原因，便于排查不同客户端的 multipart 实现差异
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[uploads] formData 解析失败', {
      contentType: ctx.request.headers.get('content-type'),
      contentLength: ctx.request.headers.get('content-length'),
      reason,
    })
    return fail(400, 'INVALID_BODY', `请求必须是 multipart/form-data 表单：${reason}`)
  }

  let file = form.get('file')
  if (!(file instanceof File)) {
    // 容错：部分客户端（如 PowerShell 的 -Form）上传文件片段时省略 name，
    // 此时退化为「取表单里的第一个文件」。浏览器与 curl 都会正常带 name。
    for (const value of form.values()) {
      if (value instanceof File && value.size > 0) {
        file = value
        break
      }
    }
  }
  if (!(file instanceof File)) {
    return fail(400, 'NO_FILE', '未收到文件字段 file')
  }
  if (file.size === 0) {
    return fail(400, 'EMPTY_FILE', '文件内容为空')
  }

  // 上限按上传子目录区分（头像 2MB、首页轮播 50MB），见 shared/resources.ts
  const scope = String(form.get('scope') ?? 'misc')
  const limit = uploadImageLimit(scope)
  if (file.size > limit) {
    return fail(413, 'TOO_LARGE', `图片不能超过 ${formatLimit(limit)}`)
  }

  // 只取文件头做类型嗅探，整份内容以 Blob 直接交给 R2 —— 不把大图再复制一份到内存
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const kind = sniffImage(head)
  if (!kind) {
    return fail(415, 'UNSUPPORTED_TYPE', '仅支持 JPG / PNG / GIF / WebP 图片，仅改扩展名无效')
  }

  const key = buildObjectKey(scope, file.name || 'file', kind.ext)

  await storage.put(key, file, {
    contentType: kind.mime,
    cacheControl: IMMUTABLE_CACHE,
  })

  await writeAudit(ctx.env, {
    actor: ctx.admin?.username ?? '(unknown)',
    action: 'upload',
    resource: scope,
    targetId: key,
    detail: `${kind.mime} ${(file.size / 1024).toFixed(1)}KB`,
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  return ok(
    // 站点图配置了 publicBase 直链时，这里返回的就是直链地址，前端 <img> 直连桶
    { key, url: storage.objectUrl(key), size: file.size, contentType: kind.mime },
    { status: 201 },
  )
}

export async function serveFile(ctx: RequestContext): Promise<Response> {
  const key = ctx.params['*']
  if (!key || key.includes('..')) {
    return fail(400, 'INVALID_KEY', '文件路径不合法')
  }

  // 目标桶按 key 前缀路由：applications/ 属报名表目标，其余归站点图片目标
  const storage = await getStorage(ctx.env, purposeFromKey(key))

  // 报名表等私有文件（applications/ 前缀）含学号、姓名、联系方式：
  // 只有管理员会话能读，其余一律按「不存在」回应 —— 不透露「这里有个文件」这回事。
  // 管理员下载走 GET /api/admin/applications/:id/file（还带原始文件名）。
  const priv = isPrivateKey(key)
  if (priv && !(await readSession(ctx.request, ctx.env))) {
    return fail(404, 'FILE_NOT_FOUND', '文件不存在或已被删除')
  }

  const object = await storage.get(key)
  if (!object) {
    return fail(404, 'FILE_NOT_FOUND', '文件不存在或已被删除')
  }

  const headers = new Headers({
    'content-type': object.contentType ?? 'application/octet-stream',
    // 私有文件一律不缓存
    'cache-control': priv ? 'no-store' : IMMUTABLE_CACHE,
  })

  // 公开文件的名字带随机后缀、内容不会变，用 etag 做 304 协商；私有文件跳过协商，避免多一层缓存
  if (!priv && object.etag) {
    headers.set('etag', object.etag)
    if (ctx.request.headers.get('if-none-match') === object.etag) {
      return new Response(null, { status: 304, headers })
    }
  }

  return new Response(object.body as unknown as BodyInit, { headers })
}
