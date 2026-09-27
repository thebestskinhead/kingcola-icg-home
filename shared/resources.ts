/**
 * 资源描述表 —— 后台 CRUD 与 D1 读写的唯一元数据来源。
 *
 * 一份配置同时驱动：
 *   - Worker：SQL 生成、行 ↔ 实体映射、字段校验
 *   - 后台 UI：表格列、表单控件、校验提示
 * 新增一个内容类型只需要在这里加一条，无需改路由与页面。
 */

import type { ResourceKey } from './types'
import { MEMBER_ROLES, NEWS_CATEGORIES, PAGE_KEYS, PAGE_LABELS, SLIDE_TYPES } from './types'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'switch'
  | 'number'
  | 'date'
  | 'tags'
  | 'image'

/**
 * 图片上传的体积上限（按 R2 子目录区分），后台表单与 Worker 共用这一份。
 *
 * 为什么不能真的「无限大」：Cloudflare 单请求体上限约 100MB（超出在到达 Worker 前就被平台拒掉），
 * 而 multipart 解析本身会把整份文件读进内存（Worker 内存 128MB）。
 * 所以这里给的是**实际可用的上限**：头像 2MB 足够，首页轮播是整屏大图，放到 50MB。
 */
export const UPLOAD_IMAGE_LIMITS: Record<string, number> = {
  avatars: 2 * 1024 * 1024,
  slides: 50 * 1024 * 1024,
}

/** 未单独声明的子目录统一按这个来 */
export const DEFAULT_IMAGE_LIMIT = 2 * 1024 * 1024

export function uploadImageLimit(scope?: string | null): number {
  return UPLOAD_IMAGE_LIMITS[scope ?? ''] ?? DEFAULT_IMAGE_LIMIT
}

export function formatLimit(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`
}

export interface FieldDef {
  /** 前端字段名（camelCase，即 API 契约字段） */
  key: string
  /** D1 列名（snake_case） */
  column: string
  label: string
  type: FieldType
  required?: boolean
  options?: readonly string[]
  /** select 选项在后台的显示名（取值仍是 options 里的英文标识） */
  optionLabels?: Record<string, string>
  placeholder?: string
  hint?: string
  /** 出现在后台表格列表里 */
  inList?: boolean
  /** 表格列宽 / 短字段标记 */
  compact?: boolean
  defaultValue?: string | number | boolean | string[]
  /** image 字段上传到 R2 的子目录，缺省为 misc */
  scope?: string
  /** image 字段在后台表单里的预览框形状，缺省为方形 */
  preview?: 'square' | 'circle' | 'wide'
  /** 仅当另一个字段等于指定值时才在表单里显示（用于二选一的字段） */
  showWhen?: { key: string; equals: string[] }
  /** 与 showWhen 同条件，但表达的是「此时才必填」 */
  requiredWhen?: { key: string; equals: string[] }
}

export interface ResourceDef {
  key: ResourceKey
  table: string
  /** 后台菜单名 */
  label: string
  /** 单条记录的说法，用于按钮与提示文案 */
  singular: string
  description: string
  /** 固定 SQL 排序片段（本文件内受控，不接受用户输入） */
  orderBy: string
  fields: FieldDef[]
  /** 参与搜索的字段 key */
  searchKeys: string[]
  /** 前台是否可匿名读取 */
  isPublic: boolean
  /** 主键由数据库自增分配（此时 id 为 number，新增时不需要也不允许指定） */
  autoId?: boolean
}

export const RESOURCES: Record<ResourceKey, ResourceDef> = {
  members: {
    key: 'members',
    table: 'members',
    label: '团队成员',
    singular: '成员',
    description: '在组与已毕业成员的公开信息，前台按加入年份分组展示',
    orderBy: 'is_pi DESC, join_year DESC, sort_order ASC, name ASC',
    isPublic: true,
    searchKeys: ['name', 'nameEn', 'title', 'direction'],
    fields: [
      { key: 'name', column: 'name', label: '姓名', type: 'text', required: true, inList: true, placeholder: '张三' },
      { key: 'nameEn', column: 'name_en', label: '英文名', type: 'text', inList: true, placeholder: 'San Zhang' },
      {
        key: 'avatarUrl',
        column: 'avatar_url',
        label: '头像',
        type: 'image',
        inList: true,
        compact: true,
        scope: 'avatars',
        preview: 'circle',
        hint: `建议正方形（1:1），JPG / PNG / WebP / GIF，不超过 ${formatLimit(
          uploadImageLimit('avatars'),
        )}。留空则自动使用姓名首字占位头像。`,
        defaultValue: '',
      },
      {
        key: 'title',
        column: 'title',
        label: '角色',
        type: 'select',
        options: MEMBER_ROLES,
        required: true,
        inList: true,
        defaultValue: '前端开发',
      },
      {
        key: 'direction',
        column: 'direction',
        label: '负责方向',
        type: 'text',
        inList: true,
        showWhen: { key: 'status', equals: ['current'] },
        requiredWhen: { key: 'status', equals: ['current'] },
        placeholder: '如：Web 前端 · 可视化',
        hint: '在组成员必填，会显示在成员卡片上',
      },
      {
        key: 'destination',
        column: 'destination',
        label: '毕业去向',
        type: 'text',
        inList: true,
        showWhen: { key: 'status', equals: ['alumni'] },
        requiredWhen: { key: 'status', equals: ['alumni'] },
        placeholder: '如：某互联网大厂 前端工程师 / 本校读研',
        hint: '已毕业成员必填，会显示在成员卡片上',
        defaultValue: '',
      },
      { key: 'email', column: 'email', label: '邮箱', type: 'text', inList: true, placeholder: 'name@example.edu.cn' },
      { key: 'joinYear', column: 'join_year', label: '加入年份', type: 'text', required: true, inList: true, compact: true, placeholder: '2026' },
      {
        key: 'status',
        column: 'status',
        label: '状态',
        type: 'select',
        options: ['current', 'alumni'],
        inList: true,
        compact: true,
        defaultValue: 'current',
      },
      { key: 'isPI', column: 'is_pi', label: '工作室负责人', type: 'switch', inList: true, compact: true, defaultValue: false },
      { key: 'bio', column: 'bio', label: '个人简介', type: 'textarea', placeholder: '简要介绍研究方向与指导理念…' },
      { key: 'sortOrder', column: 'sort_order', label: '排序权重', type: 'number', hint: '数字越小越靠前', defaultValue: 0 },
    ],
  },

  projects: {
    key: 'projects',
    table: 'projects',
    label: '项目介绍',
    singular: '项目',
    description: '工作室对外展示的项目作品（主键由数据库自增分配）',
    orderBy: 'featured DESC, year DESC, id ASC',
    isPublic: true,
    autoId: true,
    searchKeys: ['name', 'tagline', 'description', 'honor'],
    fields: [
      {
        key: 'featured',
        column: 'featured',
        label: '设为精选',
        type: 'switch',
        inList: true,
        compact: true,
        defaultValue: false,
        hint: '精选项目会显示在首页「精选项目」区块，最多展示 3 个',
      },
      { key: 'name', column: 'name', label: '项目名称', type: 'text', required: true, inList: true },
      {
        key: 'tagline',
        column: 'tagline',
        label: '一句话简介',
        type: 'text',
        inList: true,
        placeholder: '面向本校学生的课表查询小程序',
      },
      {
        key: 'honor',
        column: 'honor',
        label: '所获荣誉',
        type: 'text',
        inList: true,
        placeholder: '如：2026 年大学生计算机设计大赛 省级一等奖',
        hint: '留空则不显示，可写多项荣誉用「；」分隔',
        defaultValue: '',
      },
      {
        key: 'year',
        column: 'year',
        label: '年份',
        type: 'text',
        required: true,
        inList: true,
        compact: true,
        placeholder: '2026',
      },
      {
        key: 'tags',
        column: 'tags',
        label: '技术标签',
        type: 'tags',
        inList: true,
        placeholder: 'React, TypeScript, Tailwind',
        defaultValue: [],
      },
      { key: 'description', column: 'description', label: '详细介绍', type: 'textarea' },
      { key: 'link', column: 'link', label: '项目链接', type: 'text', placeholder: 'https://…', defaultValue: '' },
    ],
  },

  news: {
    key: 'news',
    table: 'news',
    label: '新闻动态',
    singular: '新闻',
    description: '通知公告、团队活动与竞赛获奖',
    orderBy: 'pinned DESC, date DESC, sort_order ASC',
    isPublic: true,
    searchKeys: ['title', 'summary', 'content'],
    fields: [
      { key: 'title', column: 'title', label: '标题', type: 'text', required: true, inList: true },
      {
        key: 'category',
        column: 'category',
        label: '分类',
        type: 'select',
        options: NEWS_CATEGORIES,
        required: true,
        inList: true,
        compact: true,
        defaultValue: '通知公告',
      },
      { key: 'date', column: 'date', label: '发布日期', type: 'date', required: true, inList: true, compact: true },
      { key: 'summary', column: 'summary', label: '摘要', type: 'textarea', hint: '一句话概括，显示在列表页' },
      { key: 'content', column: 'content', label: '正文', type: 'textarea', hint: '空行分段' },
      { key: 'pinned', column: 'pinned', label: '置顶', type: 'switch', inList: true, compact: true, defaultValue: false },
      { key: 'sortOrder', column: 'sort_order', label: '排序权重', type: 'number', defaultValue: 0 },
    ],
  },

  slides: {
    key: 'slides',
    table: 'slides',
    label: '首页轮播',
    singular: '轮播',
    description: '首页首屏轮播，支持「文字版」与「图片版」两种形态',
    orderBy: 'sort_order ASC, id ASC',
    isPublic: true,
    searchKeys: ['title', 'subtitle', 'kicker'],
    fields: [
      {
        key: 'type',
        column: 'type',
        label: '轮播类型',
        type: 'select',
        options: SLIDE_TYPES,
        optionLabels: { text: '文字版', image: '图片版' },
        required: true,
        inList: true,
        compact: true,
        defaultValue: 'text',
        hint: '文字版：大标题 + 描述文案 + 按钮；图片版：只放一张铺满首屏的图片，不叠加任何文字。',
      },
      {
        key: 'imageUrl',
        column: 'image_url',
        label: '轮播图片',
        type: 'image',
        scope: 'slides',
        preview: 'wide',
        inList: true,
        compact: true,
        showWhen: { key: 'type', equals: ['image'] },
        hint: `建议横图（16:9 或更宽，≥1920×1080），JPG / PNG / WebP / GIF，单张不超过 ${formatLimit(
          uploadImageLimit('slides'),
        )}。前台会铺满首屏并按比例裁切，重要内容请放在画面中间。`,
        defaultValue: '',
      },
      {
        key: 'kicker',
        column: 'kicker',
        label: '顶部小字',
        type: 'text',
        inList: true,
        showWhen: { key: 'type', equals: ['text'] },
        placeholder: 'SHIGUANG STUDIO · EST. 2019',
      },
      {
        key: 'title',
        column: 'title',
        label: '大标题',
        type: 'text',
        inList: true,
        showWhen: { key: 'type', equals: ['text'] },
        requiredWhen: { key: 'type', equals: ['text'] },
      },
      {
        key: 'subtitle',
        column: 'subtitle',
        label: '描述文案',
        type: 'textarea',
        showWhen: { key: 'type', equals: ['text'] },
      },
      {
        key: 'ctaText',
        column: 'cta_text',
        label: '按钮文字',
        type: 'text',
        defaultValue: '了解更多',
        showWhen: { key: 'type', equals: ['text'] },
      },
      {
        key: 'ctaPage',
        column: 'cta_page',
        label: '按钮跳转页面',
        type: 'select',
        options: PAGE_KEYS,
        optionLabels: { ...PAGE_LABELS },
        inList: true,
        compact: true,
        showWhen: { key: 'type', equals: ['text'] },
        requiredWhen: { key: 'type', equals: ['text'] },
        defaultValue: 'home',
      },
      { key: 'sortOrder', column: 'sort_order', label: '排序权重', type: 'number', hint: '数字越小越靠前', defaultValue: 0 },
    ],
  },
}

export const RESOURCE_KEYS = Object.keys(RESOURCES) as ResourceKey[]

export function isResourceKey(value: string): value is ResourceKey {
  return Object.prototype.hasOwnProperty.call(RESOURCES, value)
}

/** 用于拼接 SQL 的列名校验：只允许本文件定义的字母数字下划线列名 */
export function isSafeIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,62}$/.test(value)
}

// ===== 行 ↔ 实体映射（booleans / JSON） =====

function decodeValue(field: FieldDef, raw: unknown): unknown {
  if (raw === null || raw === undefined) {
    if (field.type === 'switch') return false
    if (field.type === 'tags') return []
    if (field.type === 'number') return field.defaultValue ?? 0
    return ''
  }
  switch (field.type) {
    case 'switch':
      return raw === 1 || raw === true || raw === '1'
    case 'number':
      return Number(raw) || 0
    case 'tags':
      if (Array.isArray(raw)) return raw
      try {
        const parsed = JSON.parse(String(raw))
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return String(raw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
    default:
      return String(raw)
  }
}

function encodeValue(field: FieldDef, raw: unknown): unknown {
  switch (field.type) {
    case 'switch':
      return raw ? 1 : 0
    case 'number':
      return Number(raw) || 0
    case 'tags':
      return JSON.stringify(Array.isArray(raw) ? raw : [])
    default:
      return raw === null || raw === undefined ? '' : String(raw)
  }
}

export function rowToEntity(def: ResourceDef, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (row.id !== undefined && row.id !== null) {
    out.id = def.autoId ? Number(row.id) : String(row.id)
  }
  for (const field of def.fields) {
    out[field.key] = decodeValue(field, row[field.column])
  }
  return out
}

/**
 * 路由参数里的 id 字符串 → 数据库比较用的值。
 * 自增主键必须转成数字，否则 `WHERE id = '3'` 匹配不到 INTEGER 3；
 * 非法值返回 -1，让它查不到任何记录而不是误伤。
 */
export function normalizeId(def: ResourceDef, id: string): string | number {
  if (!def.autoId) return id
  const parsed = Number(id)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : -1
}

/** D1 查询用的列清单：id 固定在最前 */
export function columnList(def: ResourceDef): string[] {
  return ['id', ...def.fields.map((f) => f.column)]
}

export function entityToRow(def: ResourceDef, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of def.fields) {
    if (field.key === 'id') continue
    if (!(field.key in input)) continue
    out[field.column] = encodeValue(field, input[field.key])
  }
  return out
}

/**
 * 字段在当前数据下是否生效。
 * showWhen 决定表单是否显示该字段（如「图片版轮播」才显示图片），
 * requiredWhen 表达的是「满足条件时才必填」（如标题只在文字版必填）。
 * 后台表单与 Worker 校验共用这一份判断，避免两端规则跑偏。
 */
export function isFieldActive(field: FieldDef, input: Record<string, unknown>): boolean {
  for (const condition of [field.showWhen, field.requiredWhen]) {
    if (!condition) continue
    if (!condition.equals.includes(String(input[condition.key] ?? ''))) return false
  }
  return true
}

/** 校验并规范化一份提交数据；返回 null 表示通过 */
export function validateEntity(
  def: ResourceDef,
  input: Record<string, unknown>,
): string | null {
  for (const field of def.fields) {
    if (field.key === 'id') continue
    if (!field.required && !field.requiredWhen) continue
    if (!isFieldActive(field, input)) continue
    const value = input[field.key]
    if (value === undefined || value === null || String(value).trim() === '') {
      return `「${field.label}」为必填项`
    }
  }
  for (const field of def.fields) {
    if (field.type !== 'select' || !field.options) continue
    const value = input[field.key]
    if (value === undefined || value === '') continue
    if (!field.options.includes(String(value))) {
      return `「${field.label}」的取值不合法：${String(value)}`
    }
  }
  return null
}

/** 生成默认值表单对象 */
export function defaultEntity(def: ResourceDef): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of def.fields) {
    if (field.key === 'id') continue
    if (field.defaultValue !== undefined) {
      out[field.key] = field.defaultValue
    } else if (field.type === 'switch') {
      out[field.key] = false
    } else if (field.type === 'tags') {
      out[field.key] = []
    } else if (field.type === 'number') {
      out[field.key] = 0
    } else {
      out[field.key] = ''
    }
  }
  return out
}
