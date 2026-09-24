# kingcola（拾光工作室官网）· 长期记忆

## 项目定位
学生工作室对外官网 + 内部内容管理后台。前台只读，全部写操作收敛到 `/admin`。
前后端**同仓**：Vite React 前端 + Cloudflare Workers（`[assets] run_worker_first = ["/api/*"]`）。

## 环境约定（本机）
- PATH 里没有 node/npm，需 `Import-Module D:\usexxx\use-xxx.psm1; use-node 22.23.2`。
  **必须用 22.23.2**：Vite 7 要求 Node ≥20.19 / ≥22.12，20.15.1 会告警。
- **npm registry `https://npm.mirrors.msh.team` 已失效（ENOTFOUND）**，会中断安装并把 `node_modules` 弄坏。
  修法：`package-lock.json` 中把该主机名整体替换为 `https://registry.npmmirror.com/`，再 `npm install --registry=https://registry.npmmirror.com`。
- 含中文的 `.ps1` **必须用 `pwsh`** 运行（Windows PowerShell 5.1 会编码错乱报语法错）。
- wrangler 4.137.0；本地密钥在 `.dev.vars`（gitignore）；本地管理员 `admin` / `kingcola-dev-2026`。

## 命令约定
| 目的 | 命令 |
|---|---|
| 本地验收（最像线上，单命令） | `npm run local` → http://127.0.0.1:8787 |
| 带热更新的开发 | `npm run dev:api` + `npm run dev` → http://127.0.0.1:5175 |
| 类型检查 / 构建 / 部署 | `npm run typecheck` / `npm run build` / `npm run deploy` |
| D1 建表 | `npm run db:migrate:local` / `:remote` |
| 自检 | `pwsh -NoProfile -File scripts/smoke-api.ps1`（内容/设置/认证）、`scripts/smoke-applications.ps1`（招新报名链路）、`scripts/probe-local.ps1`（路由外壳） |

## 架构约定（改代码前必读）
- **`shared/` 是前后端唯一契约源**：`types.ts` 实体、`resources.ts` 资源字段元数据、`qr.ts` 扫码契约（已冻结）、`runtime.ts` 流量通道契约、`site.ts` 站点文案解析规则、`seed.ts` 演示数据。
  `resources.ts` 一份配置同时驱动 Worker 的 SQL/校验与后台的表格/表单 —— **新增内容类型只改这一处**。
  字段的声明式配置：`type`（含 `image`）、`showWhen`（按另一字段取值条件显示）、`requiredWhen`（同样条件下才必填，
  与 `showWhen` 共用 `isFieldActive(field, input)`，后台表单过滤与 Worker 校验同源）、`scope`（R2 上传子目录）、
  `optionLabels`（select 英文取值的中文显示名）、`preview`（image 预览形状 square/circle/wide）、
  `inList`/`compact`（表格列）、`hint`/`placeholder`、`autoId`（资源级，主键自增）。
- **`slides`（首页轮播）有两种形态**：`type='text'`（文字版：小字+大标题+描述+按钮）/ `'image'`（图片版：**只有图片**，
  `image_url` 铺满首屏，**不叠加任何文字**）；`type` 是必填 select，历史数据默认 `text`。
  文字版专属字段（`kicker`/`title`/`subtitle`/`ctaText`/`ctaPage`）都带 `showWhen type=['text']`，
  图片版表单里直接不显示；标题必填用 `requiredWhen` 表达。
  前台 `HeroCarousel.tsx` 的 `isImageSlide()` 要求 type=image **且**有图，缺图自动退回文字版避免首屏开天窗。
- **首屏尺寸与控制器位置必须两种类型共用**：高度写成一个常量 `HERO_HEIGHT`（`h-[62svh] min-h-[400px]`
  `md:h-[calc(100svh-4rem)] md:max-h-[840px]`，挂在 `<section>` 上），文字版与图片版都在这个盒子里
  垂直居中；控制器抽成 `CarouselControls` 放在内容骨架（`mx-auto max-w-6xl` 的 flex 列）的最后一行、
  `justify-end pb-5/6`，两种类型**同一位置**，只是 `dark` 配色 + 深色胶囊底随图片版变。
  用户明确要求过「固定尺寸、两种类型样式一致」—— 别再让某一版用内容撑高度或在别处放控制器。
  **顶部导航顺序**（`src/sections/Header.tsx` 的 `NAV_ITEMS`）：首页 / 新闻动态 / 项目介绍 / 团队成员 / 加入我们；
  导航里**没有**后台入口（2026-09-24 按用户要求删除，页脚「快捷入口」里仍有「管理后台」文字链）。
- **主键两制**：默认是应用生成的文本主键（`m-xxx`/`n-xxx`）；**`projects` 用 `autoId: true`**，主键为 SQLite 自增整数，
  新增不带 id（`createEntity` 用 `meta.last_row_id` 取回），查库前必须 `normalizeId()` 把路由 id 转成数字，否则 `WHERE id='3'` 匹配不到 INTEGER 3。
- `projects` 已删除「状态 status」与「排序权重 sort_order」；新增 `honor`（所获荣誉）与 `featured`（首页精选）。
  展示顺序 `featured DESC, year DESC, id ASC`；首页精选取 featured 记录，全空则退回最新 3 个。
- 成员字段约定：**`direction` = 负责方向（在组），`destination` = 毕业去向（已毕业）**，两者独立；
  后台表单靠 `showWhen: { key: 'status', equals: [...] }` 按状态只显示对应输入框。
- **前台是真实路由，不是内存切页**：`/` 首页、`/news` 新闻列表、`/news/:id` 新闻详情、`/projects`、`/members`、`/join`，
  后台 `/admin/*`，其余落 `NotFound`（404）。路径只声明在 `shared/types.ts` 的 `PAGE_PATHS`（+ `newsPath(id)`），
  导航/页脚/首页按钮/轮播按钮全部引它（`NavLink`、`Link`）—— **不要再写死 href，也不要用 useState 切板块**。
  新增板块要改四处：`PageKey` → `PAGE_LABELS`/`PAGE_PATHS` → `App.tsx` 的 `<Routes>` → `Header.tsx` 的 `NAV_ORDER`（导航顺序只看它）。
  依赖 `wrangler.toml` 的 `not_found_handling = "single-page-application"` 与 `vite.config.ts` 的 `base: '/'` 才能深层刷新。
- **所有接口响应统一信封** `{ ok: true, data }` / `{ ok: false, error: { code, message } }`，前端 `apiRequest` 统一解包。
- **D1 是唯一事实源**；KV 只做缓存（缺失时自动降级直读 D1）；**R2 已用于成员头像、首页轮播图与报名表**。
- **官网没有任何写死的文案**：工作室名称/Logo/简介/联系方式/页脚/招新文案全部来自 `site_config` 表的 `site` 键。
  契约在 `shared/types.ts` 的 `SiteConfig` + `DEFAULT_SITE_CONFIG`；列表类文案的解析规则统一放 `shared/site.ts`
  （`splitParagraphs` 空行分段 / `splitLines` 每行一条 / `parseJoinSteps` 「标题 | 描述」 / `parseStatLabels` 逗号分隔 /
  `renderCopyright` 支持 `{year}`）。**新增站点信息字段不需要 D1 迁移**（JSON 合并默认值），
  改三处即可：`SiteConfig` + `DEFAULT_SITE_CONFIG` → `SettingsPage.tsx` 加输入框 → 对应 section 读取。
- 文件上传约定：`POST /api/admin/uploads`（需管理员，按文件头魔数校验，不信任扩展名/MIME）→ 存 R2 →
  数据库只存**相对地址** `/api/files/<key>`；`GET /api/files/*` 公开读取 + `immutable` 长缓存 + ETag。
  **体积上限按 `scope` 区分**，声明在 `shared/resources.ts` 的 `UPLOAD_IMAGE_LIMITS`（**后台表单与 Worker 同源**，
  改一处两端提示自动跟着变）：`avatars` 2MB、`slides` 50MB、其余 2MB。真正的「不限大小」做不到：
  CF 单请求体上限约 100MB，Worker 内存 128MB，且 multipart 解析本身就要把整份文件读进内存。
  上传只读前 16 字节嗅探类型，整份内容以 **Blob 直接 put 进 R2**（不再 `arrayBuffer()` 复制一份，大图才安全）。
  换 R2 自定义域名只需改 `worker/lib/uploads.ts` 的 `FILE_URL_PREFIX`/`fileUrl()`。
  编辑换图或删除记录时会自动清理 R2 旧文件。
- SQL 的表名/列名只能来自 `resources.ts`，并用 `isSafeIdentifier` 白名单校验，不接受用户输入。
- 管理员账号存 D1 `admin_users`（PBKDF2-SHA256），**刻意不绑定个人云账号**，便于换届传承；`RECOVERY_TOKEN` 是灾备找回口令。
- **教务网单点登录（SSO）**：`shared/sso.ts`（OAuth2 授权码契约）/ `worker/routes/sso.ts`（主站消费端）/
  `worker/lib/student-auth.ts`（报名学生会话）。**两套会话并存互不影响**：管理员 `kc_admin`（`SESSION_SECRET`，12h）、
  报名学生 `kc_student`（`STUDENT_SESSION_SECRET`，30 天）。
  - **开关与授权服务器地址存在 D1 `site_config['runtime'].sso`，由后台「系统设置 → 流量通道」维护**；
    `wrangler.toml` 的 `SSO_AUTHORIZE_BASE` 只是老部署的引导值（后台保存即被覆盖）。
    `SSO_CLIENT_SECRET`（对应授权服务的 `APPLY_TOKEN_SECRET`）与 `SSO_REDIRECT_URI` 仍是服务端 env。
  - 是否接通统一用 **`isSsoReady()`**（`shared/runtime.ts`：开关开且地址非空）；官网 `useSsoTarget()` 据此显隐登录入口，
    未接通时 `JoinSection` 显示「暂未开放」而不是让用户点进死路。
  - 回调失败一律 302 回首页带 `?login=<原因>`，前端 `JoinSection` 的 `LOGIN_NOTICE` 翻成人话。
  - 授权服务器在**另一个仓库**（国内 EdgeOne），契约改动需三方同步。
- **邮件通知（SMTP）· 已实现（2026-09-24，接口与后台 UI 都齐）**：契约 `shared/mail.ts`（`SmtpConfig` +
  `DEFAULT_SMTP_CONFIG` + `isMailReady()` / `mailStatusText()` / `SMTP_PORT_PRESETS` / `securityForPort()`），
  配置存在 D1 `site_config['runtime'].mail`（`RuntimeConfig.mail`，**无迁移**），**密码只走服务端 `SMTP_PASSWORD`**
  （不落库、不下发、错误信息不回显）；后台只显示「已配置/未配置」（`getAdminConfig` 返回 `mailSecretConfigured`）。
  - 传输层 `worker/lib/smtp.ts`：`cloudflare:sockets` 的 `connect()`（465 `secureTransport:'on'`；587 `'starttls'`
    → 明文 EHLO → `STARTTLS` → `socket.startTls()` → **必须用新 socket 重建 reader/writer 并再 EHLO 一次**），
    逐条校验响应码（EHLO/HELO → AUTH LOGIN，仅当服务器回 5xx「不认这方式」才退 AUTH PLAIN，
    真认证失败不重试以免被风控 → MAIL FROM → RCPT TO 逐个（部分被拒仍继续）→ DATA → QUIT）；
    正文做点行首点数化；**STARTTLS 协商失败不静默降级明文**，直接报 `TLS_FAILED`。
  - 业务层 `worker/lib/mailer.ts`：`buildMimeMessage()`（显示名/主题 RFC 2047 Base64、正文 Base64 每 76 字符折行、
    有 HTML 就用 `multipart/alternative`、`Date` 固定 +0000、`Message-ID` 用 randomHex@发件域名）+
    `sendMail(env, config, message)` 归一化错误码。
  - 接口 `POST /api/admin/mail/test`（管理员；`to` 留空用站点联系邮箱）：`NOT_CONFIGURED` / `INVALID_MESSAGE` → **400**，
    其余（CONNECT_FAILED / TLS_FAILED / AUTH_FAILED / REJECTED / TIMEOUT）→ **502**，并把服务端原话拼进 message。
  - 后台 UI：`SettingsPage.tsx` 新增「邮件通知」页签（开关 / 服务器 / 用户名 / 465·587 预设按钮 / 发件邮箱·显示名·回信地址 /
    发送测试邮件），与「流量通道」共用 `saveRuntime()`（两者都在 runtime 里）。
  - **平台硬限制**：25 端口被封；生产不能连 localhost 与私有网段（**本地 miniflare 可以**，官方文档的限制在本地不生效）；
    不能连 CF 自己的 IP 段；socket 不能在全局作用域创建。
  - **坑**：`cloudflare:sockets` 模块**只导出 `connect`**；`Socket` 是 workers-types 的全局接口，
    `import { connect, type Socket } from 'cloudflare:sockets'` 会报 TS2305。
  - 已端到端验证：本地 `python -m smtpd -n -c DebuggingServer 127.0.0.1:2525` + 后台配 `127.0.0.1:2525` 不加密 →
    200 + messageId，收到报文中文完整（RFC 2047 头 + Base64 正文解码无误）；端口改 2526 → 502 CONNECT_FAILED；
    关开关 → 400 NOT_CONFIGURED。**已接入业务场景**：招新报名的笔试/面试邀请、感谢信、邀请函都走它
    （见下方「招新报名」）。
- **招新报名（`applications`）· 2026-09-24 实现**：14 态状态机 + R2 报名表 + 一键转正。**它刻意不进 `resources.ts`**
  （不是普通内容类型，是「学生写、管理员读」的流水线，有自己的侧效），改用专用路由与专用后台页。
  - 契约集中在 **`shared/recruit.ts`**：状态枚举表 `APPLICATION_STATUS_META`（中文名/阶段/tone/给学生的提示）、
    `APPLICATION_STAGES` 5 段（报名·笔试·面试·预备期·转正）、**`APPLICATION_TRANSITIONS` 允许的流转**
    （`canTransition` / `nextApplicationStatuses`）、`noticeForStatus(to)` 决定该发哪封信、表单校验
    `validateApplicationForm`（邮箱/11 位手机号/5–12 位 QQ）、`APPLICATION_DOC_LIMIT` 20MB、邀请函 14 天 TTL。
    状态类型本身在 `shared/types.ts`（与其它枚举常量一致）。
  - 14 态：`submitted` / `rejected` / `written_scheduled` / `written_passed` / `written_failed` /
    `interview_scheduled` / `interview_passed` / `interview_failed` / `probation` / `probation_failed` /
    `invited` / `member` / `declined` / `withdrawn`。**`member` 是唯一不可再流转的终态**；
    未通过的状态可以改判回通过，但**改判不发邮件**（只按「目标状态」判该不该发）。
  - 数据层 `worker/lib/applications.ts`：显式列映射表（不用 resources 的声明式模型），
    `ApplicationRecord` 多带 `inviteToken`/`inviteExpiresAt`；`toStudentView()` 会抹掉成绩/评语/备注/凭证。
  - 接口：学生 `POST /api/applications`（multipart，`auth:'student'`）/ `GET /api/applications/me`；
    公开 `GET|POST /api/applications/invite/:token`；管理员 `GET|PUT|DELETE /api/admin/applications[/:id]`
    + `GET /api/admin/applications/:id/file`。**路由表的 `auth` 新增 `'student'`**（`worker/lib/router.ts` 的
    `RequestContext.student`，`index.ts` 里用 `readStudentSession` 注入）。
  - **状态流转只有 PUT 一个写口**：同一次请求里改状态 + 写过程字段 + 发邮件，避免「状态变了信没发」；
    返回 `{ application, mail }`，后台把 `mail.code` 如实弹给管理员（失败不阻断流转）。
  - **报名表是私有文件**：存 R2 `applications/` 前缀，`worker/lib/uploads.ts` 的 `PRIVATE_KEY_PREFIXES`
    让 `GET /api/files/*` 对它一律 404（**匿名与学生本人都拿不到**），只有管理员那个专用下载口能取到
    （`no-store` + RFC 5987 中文文件名）。新增私有前缀只改 `PRIVATE_KEY_PREFIXES`。
    `sniffDocument()` 判 PDF（`%PDF`）与 DOCX（ZIP 头 + 要求 `.docx` 扩展名，因为 DOCX 与 xlsx/pptx 同头）。
  - **邀请函转正**：进 `invited` 时签发 `randomHex(24)` 凭证 + `invite_expires_at`；
    同学在 `/invite/:token`（`InviteSection.tsx`，不要求登录，凭证即密权）填方向/英文名/负责方向/简介后确认 →
    服务端 `createEntity(members)`（`join_year` 取当前年份、`status='current'`）→ 报名记录置 `member` 并记 `member_id`。
    链接用后即失效（状态不再是 invited）。后台详情可复制链接（邮件没接通时用微信发）。
  - 前台：`JoinSection.tsx` 已接真实提交（文件+邮箱+手机号+QQ），**有记录就改展示进度**
    （`src/components/ApplicationProgress.tsx`：五段进度条 + 当前状态 + 时间线 + 邀请函入口）；
    招新截止（`recruitOpen=false`）后，已报名的同学**仍能看进度**。
    邀请函确认页路径常量在 `shared/types.ts` 的 `INVITE_PATH` / `invitePath()`，与 `PAGE_PATHS` 分开。
  - 后台：`src/admin/ApplicationsPage.tsx`（路由 `/admin/applications`，`AdminLayout` 里单列「招新」分组）——
    状态筛选 chips（带计数）、点行开详情、填笔试/面试安排后点「→ 目标状态」推进、下载报名表、复制邀请链接。
  - 迁移 `migrations/0006_applications.sql`（**已有数据的库要用 `d1 execute --file=` 单独跑**）。
  - 自检 `scripts/smoke-applications.ps1`（42 项全绿）：含会话伪造（直接用 HMAC 造 `kc_student` Token）、
    非法流转、隐私拦截、邮件结果码、R2 清理。
- 交接与运维全部写给 `docs/HANDOVER.md`，部署/密钥/找回流程改动后必须同步更新它。
- ⚠️ **这个工作区会被多个会话/工具并行修改**：动任何文件前先读当前内容，不要凭上一次的记忆直接改。

## 已知坑
- `vite.config.ts` 的 `base` **必须是 `'/'`**：后台有多级路由，用 `'./'` 时深层路径刷新会 404。
- wrangler 异常退出会残留 `workerd` 占住 8787，导致新 `wrangler dev` 一直 not ready；需按命令行含 `wrangler` 的 node 进程 + `workerd` 一起清理。
- **本机端口 3000 与 5173 长期被 IDE 内部服务（`~/.workbuddy/.../node.exe server.mjs`）占用**，
  前端 dev 端口已固定为 **5175** 并开启 `strictPort: true`（撞车时直接报错，而不是悄悄换端口导致访问到别的服务）。
  排查"拒绝访问"时先确认目标端口到底有没有在监听：`Get-NetTCPConnection -LocalPort <port> -State Listen`。
- wrangler dev 只监听 IPv4 `127.0.0.1`，`[::1]:8787` 连不上；用 `127.0.0.1:8787` 或 `localhost:8787` 都可（本机 localhost 可回退到 IPv4）。
- **PowerShell 7 的 `Invoke-RestMethod -Form` 上传文件时不带 `name`**，会让 `request.formData()` 抛
  `Content-Disposition header in FormData part is missing a name`。测上传要用 `curl.exe -F 'file=@x.png;type=image/png'`
  （与浏览器 FormData 形态一致）；服务端也已加容错：找不到 `file` 字段时取表单里第一个文件。
- 路由支持末尾 `*` 通配（`/api/files/*`），捕获结果在 `ctx.params['*']`。
- **`npm run db:migrate:*` 会把 `migrations/` 全部重跑一遍**（靠报错跳过已执行的），所以**已有数据的库不能整体执行**：
  `0004` 是重建 `projects` 表，重跑会丢 `honor`/`featured` 并重排 id。只执行新增那一个文件：
  `node .\node_modules\wrangler\bin\wrangler.js d1 execute kingcola-db --local --file=migrations/0005_xxx.sql`
- **`scripts/smoke-api.ps1` 中途异常会在本地库留下「冒烟测试工作室」的站点配置**（它先改写、跑完才还原），
  且 runtime 会被切成 edgeone/rollout=25 —— 跑完务必到 `/admin → 系统设置` 确认；异常中断后要手工还原。
