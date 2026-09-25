/**
 * 时间工具 —— **全站统一按北京时间（UTC+8）理解与展示**。
 *
 * 为什么需要它：后台填的是「2026-09-25T09:00」这种不带时区的本地时间字符串，
 * 而 Worker 跑在 UTC 上。若直接用 `new Date('2026-09-25T09:00')`，在 Worker 里会被当成
 * UTC 09:00（即北京时间 17:00），自动开启报名会整整晚 8 小时；反过来展示时又会早 8 小时。
 *
 * 所以约定：
 *   - 存库与传输：一律用「北京时间字符串」`YYYY-MM-DDTHH:mm`（不写时区，含义固定为 UTC+8）；
 *   - 需要比较大小/算截止：用 `cnTimeToEpoch()` 换成绝对时间戳；
 *   - 需要展示：用 `cnTimeToText()` 之类，不再经过 `Date` 的本地时区。
 */

/** 北京时间相对 UTC 的偏移 */
const CN_OFFSET_MINUTES = 8 * 60

const CN_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/

/** `YYYY-MM-DDTHH:mm`（北京时间）→ epoch 毫秒；无法识别返回 null */
export function cnTimeToEpoch(value: string | undefined | null): number | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  const match = CN_PATTERN.exec(raw)
  if (!match) return null
  const [, year, month, day, hour, minute] = match
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? '0'),
    Number(minute ?? '0'),
  )
  return utc - CN_OFFSET_MINUTES * 60_000
}

/** epoch 毫秒 → `YYYY-MM-DDTHH:mm`（北京时间） */
export function epochToCnTime(epochMs: number): string {
  const shifted = new Date(epochMs + CN_OFFSET_MINUTES * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(
    shifted.getUTCHours(),
  )}:${pad(shifted.getUTCMinutes())}`
}

/** 当前时间的北京时间字符串 */
export function nowCnTime(now: Date = new Date()): string {
  return epochToCnTime(now.getTime())
}

/** `YYYY-MM-DDTHH:mm`（北京时间）→ `2026 年 9 月 25 日 09:00`；空值或非法值原样返回 */
export function cnTimeToText(value: string | undefined | null): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const match = CN_PATTERN.exec(raw)
  if (!match) return raw
  const [, year, month, day, hour, minute] = match
  const time = hour ? ` ${hour}:${minute}` : ''
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日${time}`
}

/** `YYYY-MM-DDTHH:mm` → `2026-09-25 09:00`（后台表格里用的紧凑写法） */
export function cnTimeToShort(value: string | undefined | null): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const match = CN_PATTERN.exec(raw)
  if (!match) return raw
  const [, year, month, day, hour, minute] = match
  return hour ? `${year}-${month}-${day} ${hour}:${minute}` : `${year}-${month}-${day}`
}

/** 把 ISO（带时区，如入库的审计时间）转成北京时间字符串 */
export function isoToCnTime(iso: string | undefined | null): string {
  const raw = (iso ?? '').trim()
  if (!raw) return ''
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? epochToCnTime(parsed) : raw
}
