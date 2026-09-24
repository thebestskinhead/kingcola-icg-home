/**
 * 文件上传工具：类型嗅探、key 生成、URL 与 key 的互转、孤儿文件清理。
 *
 * 只信任「文件头魔数」，不信任扩展名与浏览器上报的 MIME —— 后者都能伪造。
 */

import type { Env } from '../env'
import { randomHex } from './crypto'

/** 文件访问路径前缀，数据库里存的就是带这个前缀的相对地址 */
export const FILE_URL_PREFIX = '/api/files/'

export interface ImageKind {
  ext: string
  mime: string
}

/**
 * 通过文件头判断真实图片类型；无法识别返回 null。
 * 只需要开头十来个字节就能判定，所以上传接口传 `file.slice(0, 16)` 即可，不必读整份文件。
 */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { ext: 'png', mime: 'image/png' }
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { ext: 'gif', mime: 'image/gif' }
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' }
  }
  return null
}

/**
 * 生成存储 key：`<scope>/<安全名>-<时间戳36进制>-<随机>.ext`
 * scope 会被清洗，避免路径穿越。
 */
export function buildObjectKey(scope: string, safeName: string, ext: string): string {
  const cleanScope = scope.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/\.+/g, '').replace(/^\/+/, '') || 'misc'
  const cleanName =
    safeName
      .replace(/\.[a-zA-Z0-9]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40)
      .toLowerCase() || 'file'
  return `${cleanScope}/${cleanName}-${Date.now().toString(36)}-${randomHex(4)}.${ext}`
}

export function fileUrl(key: string): string {
  return `${FILE_URL_PREFIX}${key}`
}

/** 从数据库存的相对地址反推出 R2 key；不是本站文件则返回 null */
export function keyFromUrl(url: string | undefined | null): string | null {
  if (!url || !url.startsWith(FILE_URL_PREFIX)) return null
  const key = url.slice(FILE_URL_PREFIX.length).trim()
  if (!key || key.includes('..')) return null
  return key
}

/** 删除本站托管文件；外部链接或删除失败都静默忽略，不影响主流程 */
export async function deleteLocalFile(env: Env, url: string | undefined | null): Promise<void> {
  const key = keyFromUrl(url)
  if (!key || !env.FILES) return
  try {
    await env.FILES.delete(key)
  } catch {
    // 清理失败只留下一个孤儿文件，不阻断业务
  }
}
