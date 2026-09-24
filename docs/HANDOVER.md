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
| 文件 | Cloudflare R2 | **成员头像已启用**；报名表存放待后续接入 |
| 教务网登录 | 国内腾讯云 EdgeOne（授权服务器） | 因为要访问学校教务网，**必须部署在国内** |

前台只读，所有写操作都在 `/admin` 后台完成。

---

## 2. 仓库结构

```
kingcola/
├─ src/                 前台页面 + 后台页面
│  ├─ api/              前端 API 层（运行时通道解析、失败自动切换）
│  ├─ admin/            /admin 后台（登录、概览、内容管理、设置、日志）
│  └─ sections/         官网各页面
├─ shared/              ★ 前后端共享契约（改这里要同时考虑两端）
│  ├─ types.ts          实体类型
│  ├─ resources.ts      资源字段表：一份配置驱动 Worker CRUD 与后台表单
│  ├─ sso.ts            教务网登录接口契约
│  ├─ runtime.ts        运行时配置 / 流量通道契约
│  └─ seed.ts           演示种子数据
├─ worker/              Cloudflare Worker 后端
│  ├─ index.ts          路由注册与入口
│  ├─ lib/              认证、加密、响应、D1 仓储
│  └─ routes/           公开接口、后台接口、教务网登录、运行时配置
├─ migrations/          D1 建表 SQL
├─ scripts/smoke-api.ps1  端到端冒烟测试
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
| R2 存储桶 | `kingcola-files` | R2 | 报名表文件（尚未启用） |
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
| 端到端自检 | `pwsh -File scripts/smoke-api.ps1` |

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
| 加入我们 | `/join` | `JoinSection.tsx` |
| 后台 | `/admin/*` | `src/admin/AdminApp.tsx` |
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
| 报名提交落库（`POST /api/applications` + 文件存 R2） | **未实现**，「加入我们」页面提交按钮目前只提示未接入 |
| 扫码真实实现（EdgeOne） | 待 POC 验证后部署 |
| 扫码缓存/限流、Turnstile 人机校验 | 未实现 |
| 管理员多人协作 | 表结构已支持（`admin_users`），后台暂无「加人」界面 |
| 报名数据导出 CSV | 未实现 |
| D1 自动备份（Cron） | 未实现 |
| 新闻配图 / 项目封面 | 未实现（字段与上传通道已具备，加一个 `image` 字段即可，见 `shared/resources.ts`） |
| R2 孤儿文件定期清理 | 未实现（替换/删除记录时会即时清理，异常中断时可能残留） |
