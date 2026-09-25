# 工作室官网 · 交接文档

> 本文档的唯一目的：**让下一届成员在没有前任在场的情况下，独立完成部署、维护与故障恢复。**
> 请随每届交接一起移交，并在改动后同步更新。

---

## 1. 我们用了什么

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 7 + Tailwind 3 + shadcn/ui | 构建产物是纯静态文件 |
| 后端 | Cloudflare Workers + Static Assets | 与前端**同仓同部署**，只有 `/api/*` 会进 Worker |
| 数据库 | Cloudflare D1（SQLite） | 唯一事实源：内容、管理员、审计、站点配置 |
| 缓存 | Cloudflare KV（可选） | 运行时配置缓存；缺失时自动降级为直读 D1 |
| 文件 | Cloudflare R2 | 成员头像、首页轮播图、**报名表**（报名表仅管理员可下载） |
| 教务网登录 | 国内腾讯云 EdgeOne（授权服务器） | 因为要访问学校教务网，**必须部署在国内** |

前台只读，所有写操作都在 `/admin` 后台完成。

---

## 2. 仓库结构

```
kingcola/
├─ src/                 前台页面 + 后台页面
│  ├─ api/              前端 API 层（运行时通道解析、失败自动切换）
│  ├─ admin/            /admin 后台（登录、概览、报名管理、内容管理、设置、日志）
│  └─ sections/         官网各页面（含邀请函确认页）
├─ shared/              ★ 前后端共享契约（改这里要同时考虑两端）
│  ├─ types.ts          实体类型
│  ├─ resources.ts      资源字段表：一份配置驱动 Worker CRUD 与后台表单
│  ├─ recruit.ts        招新报名状态机、表单校验、通知触发规则
│  ├─ mail.ts           邮件（SMTP）配置契约
│  ├─ sso.ts            教务网登录接口契约
│  ├─ runtime.ts        运行时配置 / 流量通道契约
│  └─ seed.ts           演示种子数据
├─ worker/              Cloudflare Worker 后端
│  ├─ index.ts          路由注册与入口
│  ├─ lib/              认证、加密、响应、D1 仓储、报名仓储、邮件
│  └─ routes/           公开接口、后台接口、报名、教务网登录、运行时配置
├─ migrations/          D1 建表 SQL
├─ scripts/smoke-api.ps1          内容 / 设置 / 认证 端到端冒烟测试
├─ scripts/smoke-applications.ps1 招新报名链路自检（状态机 + 邮件 + 隐私）
└─ wrangler.toml        Cloudflare 绑定与配置
```

---

## 3. 云资源清单（交接时必须逐项确认）

| 资源 | 名称 | 在哪里看 | 备注 |
|---|---|---|---|
| Cloudflare 账号 | （填写主账号邮箱） | dash.cloudflare.com | **必须移交账号或至少移交权限** |
| Worker | `kingcola` | Workers & Pages | 部署入口 |
| D1 数据库 | `kingcola-db` | Storage & Databases → D1 | **含全部业务数据，务必勿删** |
| KV 命名空间 | `CONFIG_KV` | Storage & Databases → KV | 可随时重建，仅为缓存 |
| R2 存储桶 | `kingcola-files` | R2 | 头像 / 轮播图 / 报名表（报名表仅管理员可下载） |
| 自定义域名 | （填写） | Worker → Settings → Domains | 可选，默认用 `*.workers.dev` |
| 国内授权服务器 | 腾讯云 EdgeOne 项目 | console.cloud.tencent.com | 见第 8 节 |

> 首次拿到 D1 后，把 `database_id` 填进 `wrangler.toml`；KV 的 `id` 同理。

---

## 4. 密钥清单

**所有密钥都不写在代码里**，生产环境用 `npx wrangler secret put <NAME>` 写入；本地开发放在 `.dev.vars`（已 gitignore）。

| 名称 | 用途 | 丢失后果 |
|---|---|---|
| `SESSION_SECRET` | 管理员会话签名 | 换新值即可，代价是管理员被登出 |
| `STUDENT_SESSION_SECRET` | 报名学生会话签名（与管理员各用各的） | 换新值即可，代价是已登录同学需重新登录 |
| `QR_SIGN_SECRET` | 校验授权服务器签发的身份凭证，**必须与其 `APPLY_TOKEN_SECRET` 完全一致** | 回调换身份失败，需两处同时更换 |
| `SSO_CLIENT_SECRET` | 向授权服务器换取身份时的客户端凭据，**必须与其同名变量一致** | 回调换身份失败，需两处同时更换 |
| `RECOVERY_TOKEN` | 初始化管理员 / 重置密码的灾备口令 | **忘记会锁死后台**，见第 7 节 |
| `SMTP_PASSWORD` | SMTP 登录密码 / 授权码（邮件通知用，服务器地址等在后台维护） | 邮件发不出去，去邮箱服务商后台重新生成授权码即可 |

> **交接建议**：把这些值抄写在一张纸上，或放在工作室共用的密码管理器中，
> 与本文档一并交给下一届。**不要把明文写进 git 仓库。**

---

## 5. 首次部署

```bash
# 0. 环境：Node.js 22.12+（Vite 7 的要求，20.19 以下会警告）
npm install

# 1. 创建云资源（只需做一次）
npx wrangler d1 create kingcola-db          # 把 database_id 填进 wrangler.toml
npx wrangler kv namespace create CONFIG_KV  # 把 id 填进 wrangler.toml
npx wrangler r2 bucket create kingcola-files

# 2. 建表
npm run db:migrate:remote

# 3. 写入密钥
npx wrangler secret put SESSION_SECRET          # 管理员会话
npx wrangler secret put STUDENT_SESSION_SECRET  # 报名学生会话
npx wrangler secret put RECOVERY_TOKEN
npx wrangler secret put QR_SIGN_SECRET          # 校验授权服务器签发的身份凭证
npx wrangler secret put SSO_CLIENT_SECRET       # 与授权服务器约定的客户端凭据
npx wrangler secret put SMTP_PASSWORD           # 邮件通知的 SMTP 登录密码（未启用邮件可不填）

# 4. 构建并部署
npm run deploy

# 5. 初始化管理员（把 <TOKEN> 换成刚设置的 RECOVERY_TOKEN）
curl -X POST https://<你的域名>/api/admin/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"<TOKEN>","username":"admin","password":"<至少8位密码>","seedContent":true}'

# 6. 自检
curl https://<你的域名>/api/health
```

完成后访问 `/admin` 登录。**登录后请立即到「系统设置 → 管理员密码」改成自己的密码。**

---

## 6. 日常运维

| 想做什么 | 怎么做 |
|---|---|
| **开一届招新** | `/admin` → 招新 → **周期与签到**：填本届名称、报名起止、笔试/面试/预备期时间与转正截止，保存即可 —— 到报名开始时间自动开放，不用手动初始化 |
| **招新期推进流程** | `/admin` → 招新 → **自动流程**：按卡片顺序「确认笔试名单 → 标记缺考 → 生成面试名单 → 确认录取 → 确认答辩 → 关闭本届」，每个都先看名单再执行 |
| **录笔试/面试/答辩成绩** | `/admin` → 招新 → **成绩录入**：切到对应环节，填分数与评语后保存（名次实时算，晋级规则在周期设置里） |
| **看招新进度** | `/admin` → 招新 → **看板**：各环节在池人数、待办数量、状态细分 |
| **改感谢信 / 邀请函文案** | `/admin` → 招新 → **邮件模板**：7 条模板都可改，右侧实时预览，写错的变量会标出来 |
| **查谁收到过什么邮件** | `/admin` → 招新 → **邮件日志** |
| **补签 / 单独通知某人** | `/admin` → 招新 → **报名管理**：勾选一批人批量补签，或点开单人改状态、记评语、补发邮件、复制邀请链接 |
| 改成员 / 项目 / 新闻 / 轮播 | `/admin` → 左侧对应菜单（改完 30 秒内官网生效） |
| 换首页首屏轮播 | `/admin` → 首页轮播 → 编辑「轮播类型」：**文字版**=大标题+描述+按钮排版；**图片版**=只放一张横图铺满首屏（不叠加文字，单张最大 50MB） |
| 上传成员头像 | `/admin` → 团队成员 → 编辑成员 → 「头像」处选择图片（≤2MB，JPG/PNG/WebP/GIF；留空则用姓名首字占位头像） |
| 填「负责方向」/「毕业去向」 | 编辑成员时按「状态」自动切换输入框：选「在组」只显示负责方向，选「已毕业」只显示毕业去向。前台也按状态各取所需 |
| **改工作室名称 / Logo / 简介 / 联系方式** | `/admin` → 系统设置 → 「品牌与联系方式」「首页简介」页签 |
| **改招新文案 / 招新流程 / 报名页文案 / 开关报名** | `/admin` → 系统设置 → 「招新与加入我们」页签 |
| **改页脚跑马灯 / 版权行** | `/admin` → 系统设置 → 「页脚」页签（版权行可用 `{year}`） |
| 高峰期把报名接口切到国内 | `/admin` → 系统设置 → 流量通道 |
| 查谁改了什么 | `/admin` → 操作日志 |

> **官网没有任何写死的文案**，全部来自 `site_config` 表里的 `site` 字段。新增可编辑信息时，
> 在 `shared/types.ts` 的 `SiteConfig` + `DEFAULT_SITE_CONFIG` 加字段，
> 再到 `src/admin/SettingsPage.tsx` 加输入框、到对应 section 读取即可（不需要数据库迁移）。
| 本地开发（推荐） | `npm run local` → 打开 <http://127.0.0.1:8787>（前端与 API 同源，与线上一致） |
| 本地开发（热更新） | `npm run dev:api`（后端 8787）+ `npm run dev`（前端 **5175**，自动代理 /api） |
| 本地重置数据库 | 删除 `.wrangler/state` 后重新执行 `npm run db:migrate:local` |
| 端到端自检（内容 / 设置 / 认证） | `pwsh -File scripts/smoke-api.ps1` |
| 端到端自检（招新报名状态机 + 邮件 + 报名表隐私） | `pwsh -File scripts/smoke-applications.ps1` |

> ⚠️ `npm run db:migrate:*` 是**按文件名顺序把 migrations/ 全部重跑一遍**（靠报错跳过已执行的），
> 所以**不要在已有数据的库上整体执行**：`0004` 是重建 `projects` 表，重跑会丢 `honor` / `featured` 并重排 id。
> 已有数据的库请只执行新增的那一个文件，例如：
>
> ```bash
> node .\node_modules\wrangler\bin\wrangler.js d1 execute kingcola-db --local --file=migrations/0005_slide_type.sql
> ```
>
> `scripts/smoke-api.ps1` 会临时改写站点配置再还原；**中途异常中断时它来不及还原**，
> 跑完请到 `/admin → 系统设置` 看一眼工作室名称是否还是自己的，别把「冒烟测试工作室」留在库里。

---

## 6.5 文件存储（头像 / 轮播图）

- 上传接口 `POST /api/admin/uploads`（需管理员会话），读取接口 `GET /api/files/*`（公开、长缓存）。
- 数据库里存的是**相对地址**，形如 `/api/files/avatars/xxx.png`；换成 R2 自定义域名时只需改
  `worker/lib/uploads.ts` 里的 `FILE_URL_PREFIX` 与 `fileUrl()`，历史数据用一条 SQL 批量替换即可。
- **安全**：只按文件头魔数判断类型（扩展名与浏览器上报的 MIME 都不可信），匿名无法上传；
  文件名带随机后缀，内容不可变，所以用 `immutable` 长缓存 + ETag 协商。
  类型嗅探只读前 16 字节，整份文件以 Blob 直接交给 R2，所以大图不会在内存里被复制两份。
- **自动清理**：编辑记录换图、或删除记录时，会顺手删掉 R2 里的旧文件，不需要手工维护。
- **大小上限按上传子目录区分**，声明在 `shared/resources.ts` 的 `UPLOAD_IMAGE_LIMITS`（后台表单与 Worker 同源）：
  头像 `avatars` 2MB，首页轮播 `slides` 50MB，其余子目录按 2MB。
  真正的「不限大小」在 Cloudflare 上做不到：单请求体上限约 100MB（超出在到达 Worker 前就被平台拒掉），
  Worker 内存也只有 128MB。要调就改这一个映射表，两端的提示文案会自动跟着变。
- **私有文件**：`applications/` 前缀（报名表）含学号、姓名、联系方式，`GET /api/files/*` 对它一律返回 404，
  只有管理员走 `GET /api/admin/applications/:id/file` 才拿得到，且响应是 `no-store`（不进任何缓存）。
  匿名访问会被当作「文件不存在」，不透露这里有东西。判定前缀写在 `worker/lib/uploads.ts` 的 `PRIVATE_KEY_PREFIXES`。
- 官方不提供缩放能力，请在**上传前**自行处理尺寸：头像裁正方形（建议 ≤512×512）。
- **图片版轮播**走的是同一个通道（`scope=slides`，存到 `slides/` 子目录）。首屏是整屏铺满 + 居中裁切，
  请上传**横图**（16:9 或更宽、≥1920×1080），并把关键内容放在画面中间，避免窄屏时被裁掉。

## 6.6 数据模型约定（改代码前看一下）

- 内容表的字段全部由 `shared/resources.ts` 声明，Worker 据此生成 SQL 与校验，后台据此渲染表格与表单。
- **主键有两种做法**：
  - 默认（members / news / slides）：`id` 是应用生成的文本主键，形如 `m-xxx` / `n-xxx`。
  - **projects：`id` 是 SQLite 自增整数**（资源声明里 `autoId: true`）。新增时**不能指定 id**，由数据库分配；
    路由里的 id 会被 `normalizeId()` 转成数字再查库 —— 否则 `WHERE id = '3'` 匹配不到 INTEGER 3，会出现「找不到记录」。
- **projects 没有「状态」和「排序权重」字段**（按需求删除）。前台展示顺序由接口的
  `featured DESC, year DESC, id ASC` 决定，页面再按年份分组。
- 首页「精选项目」取 `featured = true` 的记录（最多 3 个）；一个都没勾选时自动退回最新的 3 个，避免整块空白。
- projects 的 `honor`（所获荣誉）为空时不显示；项目页会在卡片里用高亮块展示，首页精选卡片也会带一行。
- **slides 有两种形态**：`type` 为 `text`（文字版，大标题排版）或 `image`（图片版，`image_url` 铺满首屏、**只显示图片**）。
  文字版才有的字段（`kicker` / `title` / `subtitle` / `cta_text` / `cta_page`）都用 `showWhen: { key: 'type', equals: ['text'] }` 声明，
  后台表单会自动隐藏、Worker 校验也不要求（标题必填用 `requiredWhen` 表达）；
  这套条件显示/条件必填由 `shared/resources.ts` 的 `isFieldActive()` 统一判断，后台与 Worker 共用一份规则。
  图片版没传图时会自动退回文字版展示，避免首屏开天窗。
- 首屏**两种形态共用同一个固定高度**（`HeroCarousel.tsx` 的 `HERO_HEIGHT`：手机 62svh / 桌面首屏整高，最高 840px），
  内容垂直居中、翻页控制器恒定在内容框右下角（图片版多一层深色胶囊底保证可读）。
  **改高度只改这一个常量** —— 两种类型尺寸不一致时，自动轮播会让整页跟着上下跳。
- 字段条件显示/条件必填统一写成 `showWhen` / `requiredWhen`（如成员的「负责方向」按状态显示），
  新增这类二选一字段时不要再在页面里写 `if`。

## 6.7 前台路由（每个板块一个路径）

| 板块 | 路径 | 组件 |
|---|---|---|
| 首页 | `/` | `src/sections/HomeSection.tsx` |
| 新闻动态 | `/news` | `NewsSection.tsx` |
| 新闻详情 | `/news/:id` | 同上（`useParams` 取 id） |
| 项目介绍 | `/projects` | `ProjectsSection.tsx` |
| 团队成员 | `/members` | `MembersSection.tsx` |
| 加入我们 | `/join` | `JoinSection.tsx`（登录 → 上传报名表 → 有记录即展示进度；非招新期显示未到时间/已结束） |
| 邀请函确认 | `/invite/:token` | `InviteSection.tsx`（从邮件链接进入，凭 token 不要求登录） |
| 扫码签到 | `/checkin/:stage` | `CheckinSection.tsx`（`written` / `interview` / `defense`，填姓名 + 学号） |
| 后台 | `/admin/*` | `src/admin/AdminApp.tsx`（招新模块在 `/admin/recruit/*`，一个侧栏入口 + 内部页签） |
| 其它任意路径 | — | `App.tsx` 里的 `NotFound`（404 文案 + 回首页按钮） |

- **路径只声明一次**：`shared/types.ts` 的 `PAGE_PATHS`（`PageKey` → 路径）与 `PAGE_LABELS`。
  顶部导航、页脚快捷入口、首页按钮、轮播按钮全部引自它；轮播的 `ctaPage` 存的是 `PageKey`，靠这张表翻译成路径。
- **新增一个板块**改四处：`PageKey` 加一项 → `PAGE_LABELS` / `PAGE_PATHS` 各加一项 →
  `App.tsx` 的 `<Routes>` 加一条 → 在 `Header.tsx` 的 `NAV_ORDER` 里决定它排在导航第几位
  （`PAGE_KEYS` 的声明顺序是数据契约顺序，**不决定**导航顺序）。
- 深层路径可以直接访问与分享：`wrangler.toml` 的 `not_found_handling = "single-page-application"`
  会把未知路径回落到 `index.html`，再由前端路由渲染对应板块。
  `vite.config.ts` 的 `base` 必须是 `'/'`——用相对路径时 `/news/xxx` 这类深层路径会把静态资源解析错而 404。
- 板块切换会自动滚回顶部；标签页标题首页只用工作室名称，其它板块是「板块名 · 工作室名称」。
- 自检：`scripts/probe-local.ps1` 会逐个请求上面的路径，确认都返回同一个 SPA 外壳
  （200 + `id="root"` + 绝对资源路径）。

## 6.8 邮件通知（SMTP）

后台「系统设置 → 邮件通知」维护，存在 D1 `site_config['runtime'].mail`（与流量通道同一份 runtime，
改配置**不需要数据库迁移**）。

| 配置项 | 说明 |
|---|---|
| 启用开关 | 关闭时全站不发送任何邮件 |
| SMTP 服务器 / 登录用户名 | 用户名留空表示不认证；多数服务商等于发件邮箱 |
| 连接方式 | **只有 465（SSL/TLS）与 587（STARTTLS）两种**：Workers 出站被封锁 25 端口，且不允许连 localhost / 私有网段（本地开发除外） |
| 发件邮箱 / 显示名 / 回信地址 | 发件邮箱必须落在服务商允许的发信白名单里 |

- **密码不在数据库里**：`npx wrangler secret put SMTP_PASSWORD`（本地写 `.dev.vars`）。
  后台只显示「已配置 / 未配置」，不回显、不下发前端。
- 实现分两层：`worker/lib/smtp.ts`（`cloudflare:sockets` 的 `connect()`，逐条校验 SMTP 响应码，STARTTLS 用 `startTls()` 升级后重建读写器）
  与 `worker/lib/mailer.ts`（MIME 组装：主题按 RFC 2047 编码、正文 Base64、纯文本 + HTML 走 `multipart/alternative`）。
- **STARTTLS 协商失败不会静默降级成明文**，会直接报 `TLS_FAILED`，提示改用 465。
- 自检：后台「邮件通知 → 发送测试邮件」，或 `POST /api/admin/mail/test`（需管理员；`to` 留空用站点联系邮箱）。
  失败错误码：`NOT_CONFIGURED`（配置没填齐，400）；`CONNECT_FAILED` / `TLS_FAILED` / `AUTH_FAILED` / `REJECTED` / `TIMEOUT`（502）。
- 已知边界：发信源 IP 不在 Cloudflare 公布的 IP 段内，个别服务商要求报备；能否进对方收件箱、退信处理都在对方侧，
  本站只能确认「对方服务器已 250 收下」。
- 本地想验证又不想真发信：起一个假服务器 `python -m smtpd -n -c DebuggingServer 127.0.0.1:2525`，
  后台填 `127.0.0.1` + `2525` + 不加密即可（**仅本地开发可行**）。
- **谁在用这套邮件**：招新报名的通知信件（见 §6.9）。邮件发送失败**不会**阻断状态流转，
  后台会在操作后弹出该封信的结果与错误码，修好配置后点「重发」即可。

## 6.9 招新系统（周期 · 状态机 · 自动流程 · 邮件）

### 一、状态是「阶段 + 结果」两个属性

不再用一列枚举描述报名状态，而是两个字段（**唯一事实源 `shared/recruit.ts`**）：

| 列 | 取值 |
|---|---|
| `stage` 阶段 | `apply` 报名 · `written` 笔试 · `interview` 面试 · `defense` 答辩(预备期) · `onboard` 转正 |
| `result` 该阶段结果 | `''` 待定 · `attended` 已参加 · `passed` 通过 · `failed` 未通过 · `absent` 未参加 · `declined` 婉拒 · `withdrawn` 退出 |

- **「是否已安排笔试/面试」不是个人状态**，而是全局周期配置里的时间窗，所以 `written + ''` 就表示「在等笔试」。
- 中文标签由 `applicationLabel(stage, result)` 派生，**不入库**，后台筛选按钮与前台进度页共用同一份，不会两处不一致。
- 阶段只能**相邻推进或退回一步**（`canMoveStage`），避免「跳过面试直接答辩」这类脏数据。
- 成绩、评语、管理员备注属于内部数据，`toStudentView()` 会把它们抹掉再下发学生端。

### 二、周期：一届一条配置，到点自动开、到点自动关

配置存 D1 `site_config['recruit']`（**JSON 合并默认值，新增配置项不需要迁移**），
由后台「招新 → 周期与签到」维护：本届名称、报名起止、笔试时间与结束时间、面试时间、
预备期起止、转正确认截止、缺考宽限期、晋级规则（前 N 名 / 分数线）等。

- 阶段判定由 `recruitPhase()` 算出：`not_configured` → `upcoming` → `applying` → `in_progress` → `closed`。
- **报名通道 = 站点总开关 `site.recruitOpen` × 报名时间窗**，两者都开才收报名表。
- 非招新期后台的「报名管理 / 成绩录入 / 自动流程」三页会显示「本届未开始/已结束」而不是空表格，
  周期与模板页始终可进（否则没法提前配下一届）。
- 所有时间按**北京时间**理解：`shared/time.ts` 的 `cnTimeToEpoch` / `cnTimeToText` 统一换算，
  **不要**直接 `new Date('2026-09-25T09:00')` —— 服务器在 UTC，会整整差 8 小时。

### 三、自动流程：先算名单给你看，确认后再执行

六个任务（`RECRUIT_AUTO_TASKS`，顺序即实际操作顺序）：

| 任务 | 做什么 | 需要勾选 |
|---|---|---|
| `confirm_written` 确认笔试名单 | 报名阶段的人 → 笔试阶段，发**笔试邀请函** | 否 |
| `mark_absent` 标记未参加笔试 | 笔试结束 + 宽限期内未签到 → `absent`，流程结束 | 否 |
| `advance_written` 生成面试名单 | 按成绩规则：晋级 → 面试 + **面试邀请函**；其余 → `failed` + **感谢信** | 否 |
| `advance_interview` 确认面试录取 | 勾选的人 → 预备期 + **面试通过通知**；其余 → `failed` + **感谢信** | **是** |
| `advance_defense` 确认答辩结果 | 勾选的人 → 转正 + **正式邀请函**；其余 → `failed` + **感谢信** | **是** |
| `close_cycle` 关闭本届 | 导出名单存档 → 清空报名数据 → 周期置为已结束 | 否 |

- 每个任务都是 `GET /api/admin/recruit/auto?task=…` **预览**（逐行写明「会变成什么状态、会发哪封信、为什么」），
  确认后 `POST` 同一个地址**执行**。邮件发出去收不回来，这一层确认很值。
- **改判不重发**：只按「目标状态」决定发哪封信，`笔试未通过 → 笔试通过` 这类退回不会误发邀请。
- 没有录成绩的同学在「生成面试名单」里会被跳过（预览里标出来），不会误发感谢信。
- 需要补发单封信时，报名管理 → 详情 → 「补发通知邮件」下拉里选；邮件未接通时状态照常流转，后台提示 `NOT_CONFIGURED`。

### 四、定时兜底（Cron）

`wrangler.toml` 的 `[triggers] crons = ["0 16 * * *"]`（UTC，= 北京时间每天 00:00）触发
`worker/index.ts` 的 `scheduled` → `runRecruitScheduled()`，**只做两件不需要人决策的事**：

1. 缺考宽限期已过的人 → `mark_absent`（配置里 `autoAbsent` 可关）；
2. 全部确认完毕或已过转正截止 → `close_cycle`（配置里 `autoClose` 可关）。

需要判断的（成绩晋级、面试录取、答辩通过）**一律不自动执行**。本地调试：
`npx wrangler dev --test-scheduled` 后访问 `/__scheduled?cron=0+16+*+*+*`。

### 五、关闭本届 = 先归档再清空

1. 未确认邀请的人记为 `absent`；
2. 导出全部报名记录为 CSV（含联系方式、成绩、各阶段结果），存进对象存储的
   `applications/archives/` 前缀（与报名表同属私有前缀，匿名读不到）；
3. 把存档信息追加进周期配置的 `archives`（后台「周期与签到」里可下载历届存档）；
4. 删除报名表文件、清空 `applications` 与 `application_mails`；
5. 周期写入 `closedAt`，招新模块收起，`/join` 回到「已结束」。

> 想在关闭前先看看名单，直接调 `GET /api/admin/recruit/export` 下载 CSV 即可。

### 六、扫码签到（当前是空实现）

- 后台「周期与签到」给出三个签到页地址：`/checkin/written`、`/checkin/interview`、`/checkin/defense`，
  把它们做成二维码贴在考场即可（**二维码渲染留给后续**，现在可以先用任意二维码工具生成）。
- 同学填「姓名 + 学号」，与报名记录一致即签到成功（`validateCheckin` 只做非空校验，
  **不校验任何短时凭证** —— 这是刻意的空实现）。
- 签到会把人推进到该阶段并把结果记为 `attended`；即使后台还没执行「确认笔试名单」，
  到场的人也能签到（`checkinEligibility` 的 `ahead` 分支），不会因为没点按钮就签不上。
- 已经走到后面阶段的会拒绝（提示看自己的进度），流程已结束的也会拒绝。
- 后台也可以在「报名管理」里勾选同学**批量补签**，或对单人勾选/取消签到。
- 要改成真扫码：在 `worker/routes/applications.ts` 的 `checkin()` 里加一层令牌校验即可，
  前端与数据层都不用动。

### 七、邮件模板中心

5 类共 7 条模板，主题与正文都在后台「招新 → 邮件模板」里改，支持 `{name}` `{writtenAt}` `{inviteLink}` 等变量
（清单在页面左侧，写错的变量会当场标出来）。每条模板可单独**停用**：停用后状态照常流转，只是不发这封信。

### 八、接口一览

| 谁 | 方法与路径 | 说明 |
|---|---|---|
| 公开 | `GET /api/public/recruit` | 本届时间窗与状态（报名页据此显隐表单） |
| 学生 | `POST /api/applications` | multipart 上传报名表（PDF/DOCX ≤20MB，按文件头魔数校验），需教务网会话 |
| 学生 | `GET /api/applications/me` | 自己的进度 + 各环节安排 |
| 公开 | `GET /api/applications/checkin-info` · `POST /api/applications/checkin` | 签到页信息与提交 |
| 公开 | `GET/POST /api/applications/invite/:token` | 邀请函（凭证即密权，不要求登录） |
| 管理员 | `GET/PUT /api/admin/recruit` | 周期与邮件模板 |
| 管理员 | `GET /api/admin/recruit/board` | 看板：漏斗 + 待办 + 状态细分 |
| 管理员 | `GET/POST /api/admin/recruit/auto` | 自动流程预览 / 执行 |
| 管理员 | `GET /api/admin/recruit/export` · `/mails` | 名单导出 CSV、发信日志 |
| 管理员 | `GET /api/admin/applications` | 列表（`stage=` / `result=` 多选、`q=` 搜姓名/学号/邮箱/手机/QQ） |
| 管理员 | `PUT /api/admin/applications/:id` | 单人改状态 / 记成绩 / 勾签到 / 补发某封信 |
| 管理员 | `POST /api/admin/applications/bulk` | 批量：补签、标记未参加、退出报名 |
| 管理员 | `POST /api/admin/applications/notify` | 群发一封自定义通知（勾选一批人） |
| 管理员 | `GET /api/admin/applications/:id/file` | 下载报名表（**唯一**能取到 `applications/` 内容的入口） |
| 管理员 | `DELETE /api/admin/applications/:id` | 删除记录并清理存储桶里的报名表 |

### 九、数据与文件

- 表：`applications` + `application_mails`（`migrations/0007_recruit_stages.sql`）。
  **一位同学一条记录**，`student_id` 唯一；发信日志与报名数据同生命周期，关闭时一起清空。
- 身份（学号 / 姓名）**取自教务网会话，不接受前端传入**，所以没人能替别人报名。
- 报名表与存档都落在对象存储的 `applications/` 前缀下（桶与密钥在后台「对象存储」页配置，
  两个业务目标 `site` / `applications` 可以指向不同的桶），
  `GET /api/files/*` 对该前缀一律 404 —— 匿名与学生本人都拿不到，
  只有 `GET /api/admin/applications/:id/file` 带管理员会话能下载（还带原始文件名）。

> 自检：`pwsh -File scripts/smoke-applications.ps1` 会完整走一遍
> 「配周期 → 报名 → 确认笔试名单 → 签到 → 缺考标记 → 成绩晋级 → 面试录取 → 答辩转正 →
> 邀请函确认 → 导出 → 关闭归档」，共 40+ 项断言，并会在结束时**复原原有的周期配置**。

---

## 7. 故障恢复

### 后台密码忘了
用 `RECOVERY_TOKEN` 重置（不会清空数据）：

```bash
curl -X POST https://<你的域名>/api/admin/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"<RECOVERY_TOKEN>","username":"admin","password":"<新密码>"}'
```

### `RECOVERY_TOKEN` 也忘了
无法从外部重置（这是故意的安全设计）。需要：

1. 在 Cloudflare 控制台重新设置该密钥：`npx wrangler secret put RECOVERY_TOKEN`
2. 再执行上面的重置请求

### 想换管理员账号名
直接用 `bootstrap` 接口以新用户名 + 新密码调用一次即可新增账号（旧账号仍在，可在 D1 控制台删除）。

### 数据被误删
D1 支持时间点恢复（Time Travel）：

```bash
npx wrangler d1 time-travel info kingcola-db
npx wrangler d1 time-travel restore kingcola-db --timestamp=<时间戳>
```

> 建议招新期间每周手动导出一份：D1 控制台 → 选中数据库 → Export。

---

## 8. 教务网登录（单点登录）

### 现在的状态
已按 OAuth 2.0 授权码模式接通。**官网不接触教务网**，登录是一次跨站跳转，
回调时由 Worker 用授权码换回身份、验签后种下自己的报名会话：

```
GET  /api/auth/login     → 302 到授权服务器（同时种下 state Cookie）
GET  /api/auth/callback  → 校验 state → 授权码换身份 → 验签 → 种报名会话 → 回首页
GET  /api/auth/me        → 前端查询当前登录态
POST /api/auth/logout    → 退出登录
```

授权服务器部署在国内 EdgeOne，四个端点（`start` / `poll` / `approve` / `token`）
由另一个仓库维护，部署与密钥说明见其 `DEPLOY.md`。契约文件：`shared/sso.ts`
（**改动需前后端 + 授权服务器三方同步**）。

回调失败一律 302 回首页并带 `?login=<原因>`，前端翻译成人话提示；
不把错误码留在地址栏，也不甩 JSON 错误页给用户。

### 两套会话，互不影响

|  | 管理员 | 报名学生 |
|---|---|---|
| Cookie | `kc_admin` | `kc_student` |
| 签名密钥 | `SESSION_SECRET` | `STUDENT_SESSION_SECRET` |
| 有效期 | 12 小时 | 30 天（覆盖整个招新周期） |
| 读取 | `worker/lib/auth.ts` | `worker/lib/student-auth.ts` |
| 登出 | `POST /api/admin/logout` | `POST /api/auth/logout` |
| 失效条件 | 关联密码版本，改密码即踢 | 仅签名与有效期 |

两侧换密钥、登出、会话失效都只影响自己。报名会话不查库，因此授权服务器暂时不可用时，
已登录的同学依然能正常提交报名。

### 接入需要做的三件事
1. **后台「系统设置 → 流量通道 → 教务网登录」**：打开开关 + 填授权服务器地址，保存即生效。
   - 开关与地址都存在 D1 的 `site_config['runtime']`，**不需要改环境变量、不需要重新部署**。
   - 两项缺一即视为「未接通」：官网不展示登录入口，「加入我们」页显示「暂未开放」。
   - 关闭开关只是收起入口，**已登录的同学保持登录态**。
   - 判定规则两端共用 `isSsoReady()`（`shared/runtime.ts`），避免后台与官网不一致。
   - `wrangler.toml` 里的 `SSO_AUTHORIZE_BASE` 只是可选的部署引导值，后台保存后即以后台为准。
2. 两个密钥两端必须一致：`SSO_CLIENT_SECRET`（主站同名）、
   主站 `QR_SIGN_SECRET` 对应授权服务的 `APPLY_TOKEN_SECRET`。这两个属于敏感值，
   仍用 `npx wrangler secret put` 写入，**不在后台填写**。
   不一致的直接表现就是「回调换身份失败」。
3. 把主站回调地址登记进授权服务器的客户端白名单 `SSO_CLIENTS`，
   必须**完整精确匹配**（含协议、域名、路径）；可用 `SSO_REDIRECT_URI` 固定下来，
   避免自定义域名与预览域名不一致。

### 授权服务器访问教务网的链路
学校教务网（`https://kdjw.hnust.edu.cn`）的四步链路，**必须共用同一个 Cookie 会话**：

1. `GET /Logon.do?method=QrCodeCreate&uuid={U}` → 二维码图片 + `Set-Cookie(bzb_njw, SERVERID)`
2. `GET /Logon.do?method=checksfhd&sid={U}&_={ts}` → `no` 未扫 / 其他值表示已扫或已确认
3. `GET /Logon.do?method=logon_kd&type=wx&sid={U}` → **必须禁止自动跟跳**，手动逐跳取 Cookie
4. `GET /jsxsd/grsz/grsz_xggrxx.do` → 正则取 `name="account"`（学号）与 `name="realName"`（姓名）

参考实现见另一个仓库 `schedule-system-v2` 的 `backend/internal/service/qr_login.go`。

### 为什么必须放在国内 EdgeOne
教务网仅国内可达，Cloudflare 海外节点访问会被风控或直接超时。

### 已实测的平台能力
**EdgeOne 边缘函数能读到教务网响应的 `Set-Cookie`**，出网请求与二维码获取均成功。
注意 `fetch` 在 `redirect: 'follow'` 时不会记录中转的 `Set-Cookie`，
因此链路实现里用 `redirect: 'manual'` 手动跟跳。

### 合规提醒
该模块本质上是代理学生登录学校教务系统。上线前请确认已获得指导老师 / 教务部门许可，
并且**只提取学号与姓名**，绝不落库 Cookie 与密码。

---

## 9. 待办与已知限制

| 项 | 状态 |
|---|---|
| 招新系统（周期 / 状态机 / 自动流程 / 邮件 / 签到 / 看板 / 导出） | **已实现**，见 §6.9；自检 `scripts/smoke-applications.ps1` 46 项全绿 |
| 邮件通知（SMTP） | **已实现**并已接入业务：`worker/lib/smtp.ts` + `mailer.ts`，后台「系统设置 → 邮件通知」可配可测（§6.8）；招新的 7 条通知模板都走它（§6.9） |
| 扫码签到 | **空实现**：填姓名 + 学号即签到，不校验短时凭证（§6.9 第六节）。真正的扫码令牌待补 |
| 签到二维码渲染 | 未实现：后台只提供签到页地址，二维码请用任意工具生成贴上（前端没有二维码库） |
| 招新 Cron 定时任务 | **已实现**：每天一次兜底「标记缺考 + 到点关闭」（§6.9 第四节）；部署后可在 Cloudflare 控制台看到触发记录 |
| 多届并存 / 历史届在线查阅 | 未实现：只有**当前届**在线，关闭时导出 CSV 存档（后台可下载），数据表清空 |
| 扫码真实实现（EdgeOne） | 待 POC 验证后部署 |
| 报名限流 / Turnstile 人机校验 | 未实现（报名提交目前只有教务网会话校验，没有频率限制与验证码） |
| 管理员多人协作 | 表结构已支持（`admin_users`），后台暂无「加人」界面 |
| 面试分时段排期 / 面试官分配 | 未实现：面试时间与地点是全局的一个时间窗，不支持「一人一个时间」 |
| D1 自动备份（Cron） | 未实现（招新数据在关闭时会归档，其余数据靠 D1 Time Travel，见 §7） |
| 新闻配图 / 项目封面 | 未实现（字段与上传通道已具备，加一个 `image` 字段即可，见 `shared/resources.ts`） |
| 对象存储孤儿文件定期清理 | 未实现（替换/删除记录时会即时清理，异常中断时可能残留） |
