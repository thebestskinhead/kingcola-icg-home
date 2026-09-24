/**
 * 前后端共享的实体类型（唯一事实源）。
 * 前端通过 `@shared/types` 引用，Worker 通过相对路径引用，两边永远一致。
 */

export type MemberStatus = 'current' | 'alumni'

export interface Member {
  id: string
  name: string
  nameEn: string
  title: string
  /** 在组期间的负责方向 */
  direction: string
  /** 毕业去向（已毕业成员填写） */
  destination?: string
  email: string
  joinYear: string
  status: MemberStatus
  isPI: boolean
  bio: string
  /** 头像地址，形如 /api/files/avatars/xxx.jpg；为空时前台用姓名首字占位头像 */
  avatarUrl?: string
  sortOrder?: number
}

export interface NewsItem {
  id: string
  title: string
  category: string
  /** YYYY-MM-DD */
  date: string
  summary: string
  content: string
  pinned: boolean
  sortOrder?: number
}

export interface Project {
  /** 自增主键，由数据库分配 */
  id: number
  name: string
  tagline: string
  description: string
  tags: string[]
  /** 所获荣誉，可空 */
  honor?: string
  /** 是否设为首页精选 */
  featured?: boolean
  year: string
  link: string
}

/** 轮播的两种形态：文字版（大标题排版）/ 图片版（整屏铺满的图片） */
export type SlideType = 'text' | 'image'

export interface Slide {
  id: string
  /** 轮播形态，缺省视为文字版 */
  type: SlideType
  /** 顶部小字（文字版、图片版都可用作图片上方的小字） */
  kicker: string
  /** 大标题；图片版可留空，仅展示图片 */
  title: string
  subtitle: string
  /** 图片版轮播的图片地址，形如 /api/files/slides/xxx.jpg；文字版为空 */
  imageUrl?: string
  ctaText: string
  ctaPage: PageKey
  sortOrder?: number
}

// ===== 招新报名（状态机规则见 shared/recruit.ts） =====

/**
 * 报名流水线的 14 个状态，覆盖「报名 → 笔试 → 面试 → 预备期 → 转正」全流程。
 * 中文名 / 所属阶段 / 允许的流转都在 `shared/recruit.ts`，与前端共用同一份。
 */
export type ApplicationStatus =
  /** 已提交报名（待安排笔试） */
  | 'submitted'
  /** 材料未通过初筛 */
  | 'rejected'
  /** 已安排笔试 */
  | 'written_scheduled'
  /** 笔试通过 */
  | 'written_passed'
  /** 笔试未通过 */
  | 'written_failed'
  /** 已安排面试 */
  | 'interview_scheduled'
  /** 面试通过 */
  | 'interview_passed'
  /** 面试未通过 */
  | 'interview_failed'
  /** 预备成员（试用期） */
  | 'probation'
  /** 预备期未通过 */
  | 'probation_failed'
  /** 已发送邀请函（待本人确认） */
  | 'invited'
  /** 正式成员（已写入成员表） */
  | 'member'
  /** 收到邀请但放弃 */
  | 'declined'
  /** 主动退出 / 失联 */
  | 'withdrawn'

export interface Application {
  id: string
  /** 学号，来自教务网会话；同一位同学只保留一条记录 */
  studentId: string
  /** 报名人姓名，来自教务网会话，学生不可自行修改 */
  name: string
  email: string
  phone: string
  qq: string
  /** 报名表在 R2 的相对地址，形如 /api/files/applications/xxx.pdf（含个人信息，仅管理员可下载） */
  fileUrl: string
  fileName: string
  fileSize: number
  status: ApplicationStatus

  // ---- 笔试 ----
  /** 笔试时间（YYYY-MM-DDTHH:mm，用于邀请邮件与后台展示） */
  writtenAt: string
  writtenScore: string
  writtenNote: string

  // ---- 面试 ----
  interviewAt: string
  interviewNote: string

  // ---- 预备期 ----
  probationNote: string

  // ---- 邀请函与转正 ----
  invitedAt: string
  confirmedAt: string
  /** 转正后对应 members.id */
  memberId: string

  /** 管理员备注（不对学生展示） */
  note: string
  createdAt?: string
  updatedAt?: string
}

export type PageKey = 'home' | 'members' | 'projects' | 'news' | 'join'

/** 后台可管理的资源名（与 D1 表一一对应） */
export type ResourceKey = 'members' | 'projects' | 'news' | 'slides'

// ===== 枚举常量（前后端共用） =====

export const MEMBER_ROLES = [
  '指导老师',
  '前端开发',
  '后端开发',
  '算法工程师',
  '移动端开发',
  'UI 设计',
  '产品运营',
] as const

export const NEWS_CATEGORIES = ['通知公告', '团队活动', '竞赛获奖'] as const

export const RECRUIT_DIRECTIONS = [
  '前端开发',
  '后端开发',
  '算法 / AI',
  '移动端开发',
  'UI 设计',
  '方向不限 / 待沟通',
] as const

export const PAGE_KEYS = ['home', 'members', 'projects', 'news', 'join'] as const

export const SLIDE_TYPES = ['text', 'image'] as const

export const PAGE_LABELS: Record<PageKey, string> = {
  home: '首页',
  members: '团队成员',
  projects: '项目介绍',
  news: '新闻动态',
  join: '加入我们',
}

/**
 * 各板块的前台路由路径 —— 唯一一份，导航、页脚、首页按钮、轮播按钮全用它。
 * 数据库里轮播的 `ctaPage` 存的是 `PageKey`，靠这张表翻译成路径。
 */
export const PAGE_PATHS: Record<PageKey, string> = {
  home: '/',
  members: '/members',
  projects: '/projects',
  news: '/news',
  join: '/join',
}

/** 新闻详情的路径（新闻列表与首页「最新动态」共用） */
export function newsPath(id: string): string {
  return `${PAGE_PATHS.news}/${encodeURIComponent(id)}`
}

/**
 * 邀请函确认页的路径。
 * 它不是一个「板块」（不进导航），所以与 PAGE_PATHS 分开；但路径同样只在这里声明一次。
 */
export const INVITE_PATH = '/invite'

/** 邀请函确认页地址；`token` 是邮件里的一次性凭证 */
export function invitePath(token: string): string {
  return `${INVITE_PATH}/${encodeURIComponent(token)}`
}

// ===== 站点公开配置（工作室自身的全部信息，均可在后台编辑） =====

export interface SiteConfig {
  // ---- 招新 ----
  recruitOpen: boolean
  recruitTitle: string
  recruitDesc: string

  // ---- 品牌 ----
  /** 工作室名称（中文），用于导航栏、页脚、浏览器标题 */
  studioName: string
  /** 英文名 / 副标题 */
  studioNameEn: string
  /** 一句话定位，显示在页脚 */
  slogan: string
  /** 自定义 Logo；留空则用内置标识 */
  logoUrl: string

  // ---- 联系方式 ----
  contactEmail: string
  contactAddress: string
  contactPhone: string

  // ---- 页脚 ----
  /** 底部跑马灯文案 */
  marqueeText: string
  /** 版权行，可用 {year} 表示当前年份 */
  footerCopyright: string

  // ---- 首页 · 工作室简介 ----
  aboutTitle: string
  /** 简介正文，空行分段 */
  aboutParagraphs: string
  /** 四个统计数字的标签，逗号分隔 */
  statLabels: string

  // ---- 加入我们 ----
  joinTitle: string
  joinIntro: string
  /** 招新流程，每行一条，格式「标题 | 描述」 */
  joinSteps: string
  /** 对报名者的期望，每行一条 */
  joinRequirements: string
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  recruitOpen: true,
  recruitTitle: '2026 年秋季招新进行中',
  recruitDesc:
    '无论你想写前端、做后端、搞算法还是做设计，这里都有真实的项目等着你。零基础但学习意愿强的同学同样欢迎。',

  studioName: '拾光工作室',
  studioNameEn: 'SHIGUANG STUDIO',
  slogan: '学生计算机工作室：Web 全栈 · 人工智能应用 · 移动开发',
  logoUrl: '',

  contactEmail: 'studio@example.edu.cn',
  contactAddress: '某某大学 计算机学院 实验楼 B203',
  contactPhone: '',

  marqueeText: 'CODE · CREATE · SHIP · 拾光工作室 · SHIGUANG STUDIO · ',
  footerCopyright: '© {year} 拾光工作室',

  aboutTitle: '工作室简介',
  aboutParagraphs: [
    '拾光工作室成立于 2019 年，是一个由计算机相关专业学生组成的开发团队，由指导老师带队，成员覆盖前端、后端、算法、移动端与设计等方向。',
    '我们坚持「用真实项目锻炼人」——工作室的项目都来自校园内外的真实需求，从需求分析、原型设计到开发上线，成员全程参与。除项目外，工作室定期举办技术分享会，组织成员参加各类学科竞赛，形成了「传帮带」的学习氛围。',
    '在这里，你写下的每一行代码，都可能被上千名真实用户使用。',
  ].join('\n\n'),
  statLabels: '在组成员,毕业成员,工作室项目,团队动态',

  joinTitle: '加入我们',
  joinIntro:
    '工作室常年招收对软件开发、人工智能与设计感兴趣的同学。在这里你会参与真实的产品开发，体验从想法到上线的完整流程。',
  joinSteps: [
    '扫码完成身份认证 | 使用微信扫描二维码，经学校教务网认证身份后自动获得提交凭证。',
    '提交报名表 | 将填写完整的报名表（PDF / DOCX）上传至工作室。',
    '面谈交流 | 工作室将在一周内联系你，安排与老师或学长学姐面谈。',
  ].join('\n'),
  joinRequirements: [
    '对技术有热情，愿意动手实践',
    '具备基本的编程基础（零基础但愿意学习也欢迎）',
    '每周能投入一定时间参与项目',
  ].join('\n'),
}

// ===== 统一响应包装 =====

export interface ApiOk<T> {
  ok: true
  data: T
}

export interface ApiErr {
  ok: false
  error: { code: string; message: string }
}

export type ApiResult<T> = ApiOk<T> | ApiErr
