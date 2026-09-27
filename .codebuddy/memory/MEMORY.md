# kingcola（拾光工作室官网）· 长期记忆

> 只记跨会话仍成立的事实；日流水写 `YYYY-MM-DD.md`（细节、过程、踩坑全过程都在日文件里）。
> 整理：2026-09-27 第四次压缩（只留决策与坑，机制细节以代码为准）。

## 定位与架构
学生工作室官网 + 内部后台：Vite React（`src/`）+ Cloudflare Workers（`worker/`，`run_worker_first = ["/api/*"]`）。前台只读，写操作收敛到 `/admin/*`。
- **`shared/` 是前后端唯一契约源**：types / resources / identity / qr（冻结）/ runtime / mail / recruit / sso / site / seed / storage。
- **`shared/resources.ts` 一份元数据同时驱动 Worker 的 SQL·校验与后台的表格·表单**：`type`(text/textarea/select/switch/number/date/tags/image)、`required`、`showWhen`/`requiredWhen`、`optionsSource`、`optionLabels`、`preview`、`inList`/`compact`、`hint`、`autoId`、`defaultValue`。新增内容类型只加一条。
- **读写口径**：读 `columnList(def)` 全列（`rowToEntity` 只映射 `def.fields`，**不含 createdAt/updatedAt**）；创建 = `defaultEntity` 补默认值后整行 INSERT 并回读整行；更新只写提交上来的列；校验唯一口径 `validateEntity(def, input, ctx)`；互斥字段用 `requiredWhen` + `showWhen` 同条件。
- **主键两制**：默认文本主键 `randomId`；`projects` 用 `autoId:true` 自增整数（查库前 `normalizeId()`）。
- **前台是真实路由**：`PAGE_PATHS` 在 shared/types.ts；新增板块改四处（PageKey → LABELS/PATHS → App.tsx Routes → Header NAV_ORDER）。
- 接口信封 `{ ok, data }` / `{ ok, error:{code,message} }`，前端 `apiRequest` 解包。**D1 唯一事实源**；KV 只做配置缓存（写 D1 后删 KV）。
- 站点文案来自 `site_config['site']`（JSON 合并、无迁移）；新增字段改三处：shared/types.ts → SettingsPage → section；列表解析在 `shared/site.ts`。
- 管理员存 D1 `admin_users`（PBKDF2）；`RECOVERY_TOKEN` 灾备。运维文档 `docs/HANDOVER.md`。

## 环境与命令
- PATH 无 node/npm：`Import-Module D:\usexxx\use-xxx.psm1; use-node 22.23.2`（Vite 7 要求 22.23.2）；npm 加 `--registry=https://registry.npmmirror.com`（原镜像已失效）。
- 含中文的 `.ps1` 必须 `pwsh`（5.1 编码错乱）。wrangler 4.137.0。本地密钥 `.dev.vars`（gitignore），本地管理员 `admin` / `kingcola-dev-2026`。
- 命令：本地验收 `npm run local`（8787）/ 开发 `dev:api`+`dev`（5175）/ `typecheck`·`build`·`deploy` / `db:migrate:local|:remote`。
- 自检：`scripts/smoke-api.ps1`、`smoke-applications.ps1`、`probe-local.ps1`。

## 多会话并行（重要）
工作区被多会话并行修改（含本记忆文件）：**动文件前先读当前内容**。提交前逐文件 `git diff`，并用 `git show HEAD:<file> | findstr /C:"符号"` 验证 HEAD 是否自洽 —— 若别人新代码引用的符号不在 HEAD 里（曾出现在 applications.ts / endpoints.ts / index.ts），必须把那批文件一起提交，否则留下**编译不过的 HEAD**。中文提交信息写 UTF-8 文件 + `git commit -F`。

## 对象存储适配层
- 契约 `shared/storage.ts`：`StoragePurpose = 'site' | 'applications'`（可各配桶）；配置存 `site_config['storage']`，无迁移。
- `worker/lib/storage/`：`registry.ts` 插件表（内置 `r2` 与 `s3`——自实现 SigV4 预签名，兼容 R2 S3 API/MinIO/COS/OSS，无 SDK）；`index.ts` 的 `getStorage(env, purpose)` 门面。
- 直连：s3 预签名 GET/PUT；r2 不支持 → 退化 KV 一次性 token + `/api/files/direct/:token`（用后即焚）。签发口 `POST /api/admin/storage/direct-token`。
- `secretAccessKey` 落库但**永不下发**（只回 `secretConfigured`；保存时空值 = 保留旧值）；`resolveFileRef()` 能反解 `/api/files/<key>` 与 publicBase 直链；`applications/` 前缀私有（`GET /api/files/*` 一律 404）。

## 招新（以 `shared/recruit.ts` + `worker/lib/recruit-cycle.ts` 为准）
- 入口 `/admin/recruit`（四视图：流程/名单/邮件日志/设置，共用 `useRecruitAdmin.ts`；纯函数与常量放 `recruit-ui.ts`，**只放非组件**，否则踩 react-refresh）。
- **三条用户边界**：①「设置 vs 流程」判据 = **下一届还要不要重填一次**（要 → 本届流程：名称/四个群号/阶段/名单/评语/签到码；不要 → 通用设置：邮件模板/官网招新文案）；后端只有 `PUT /api/admin/recruit`（**不接受 state**）+ `POST /api/admin/recruit/actions`。②「资料随时可改」：名单行内改姓名/学号/邮箱/手机/QQ 与报名表，`IMMUTABLE_KEYS` 只剩 id/createdAt；**笔试现场补录不要求报名表**。③「关闭/清空」= **推倒重来**（`reset_apply`），不是临时停收、不是退回未开启。
- **状态 = `stage` + `result` 两列**：stage ∈ apply/written/interview/defense/onboard；result ∈ ''(待定)/attended/passed/failed/absent/declined/withdrawn；中文标签由 `applicationLabel()` 派生、**不入库**；阶段只相邻推进或退一步。**整届没有时间字段、也没有场次**；所有动作集中在 `RECRUIT_ACTION_META`（from/to/needsSelection/文案），后台按钮文案与可点性同源（不会「界面能点但后端拒绝」）。缺考在「结束笔试/面试/答辩」里一次标完。服务器在 UTC，**绝不能** `new Date('2026-09-25T09:00')`（差 8 小时）。
- ⚠️ **已作废、别再引入**：`recruit-auto.ts`、`/api/admin/recruit/auto`、`[triggers] crons`、`recruitPhase()`/时间窗/`site.recruitOpen`、周期的 `archives`、`shared/time.ts`、`recruit_sessions`。
- 周期配置存 D1 `site_config['recruit']`（刻意不放 runtime：模板正文不该下发给访客）；读时 `mergeCycle` 逐字段取值并校验 state。报名通道只由 `isApplyOpen(state)` 决定。
- **邮件八模板**，变量仅 `{name}{studentId}{cycleName}{writtenGroup}{interviewGroup}{probationGroup}{formalGroup}{inviteLink}{rejectReason}{studio}{contactEmail}{contactAddress}`；**缺考与未过初筛一律不发信**；发信失败不阻断流转；只按目标状态决定发哪封 → 改判不会误发。⚠️ 群号短名（`groups.written`）≠ 模板令牌（`{writtenGroup}`），统一走 `cycleMailVars(cycle)`；**模板变量别手写键名**（曾出过「预览骗人」）。
- **材料审核**（`0010`）：`applications` 加 `material_status`(''待审/approved/rejected)+`material_reason`+`material_reviewed_at`；报名阶段可逐个/批量「通过·驳回」（驳回必写理由并**自动逐人发信**）；**重传材料自动回到待审核**；只在 apply/apply_review 可审；**未过审不能被勾进笔试**（`MATERIAL_NOT_APPROVED`，只作用于报名→笔试）。
- **报名截止后的进度入口**：`gate=closed` 时未登录者看到「报名已截止」+「扫码登录，查看我的进度」；登录后可见审核状态与驳回理由，报名未结束可直接重传（`POST /api/applications?replace=true`，**`replace` 只认 query 参数**）。
- **签到 = 阶段 + 凭证**：`recruit_checkin_tokens` 只绑 `stage`(written/interview/defense)+`expires_at`+`revoked_at`，**签发新码自动作废该阶段旧码**；签到页只有 `/checkin/<token>`。⚠️ `QR_SIGN_SECRET` 是 SSO applyToken 验签密钥，**不是**签到码密钥。
- **`close_cycle`**：未确认的记 absent → 导出 CSV 到 `applications/archives/` → 存档信息进周期 → 删报名表 → 清空报名与发信日志 → 写 `closedAt`；**对象存储没接通就拒绝关闭**。
- **`reset_apply`**：只在 apply/apply_review 可用；删光报名记录+报名表+发信日志（**跳过 `RECRUIT_ARCHIVE_SCOPE`**，别误删往届存档），state 退回 `prepare`；**不导出存档、不因存储不可用拒绝**；返回 `cleaned{applications,files,filesFailed}`。
- **邀请函转正** `POST /api/applications/invite/:token`（凭证即密权，14 天、只能确认一次）→ 写 `members` 并回记 `memberId`；**头像必传**（`/invite/:token/avatar`，同一凭证、免登录），确认时只接受本站 `avatars/` 前缀（拒任意外链）；「负责方向」必填；三个入口共用 `pendingInviteError()`。
- **上传公共实现** `worker/routes/uploads.ts: receiveImage(ctx, resolveScope)`（multipart → 体积 → 魔数 → 落站点存储，**不含鉴权**）；管理员口读表单 `scope`，邀请函**硬编码 `avatars`**。
- **表/文件**：`applications` + `application_mails` + `recruit_checkin_tokens`；**已有数据的库必须单独**执行新迁移 SQL。报名表与存档都在 `applications/` 前缀（私有）；下载 `GET /api/admin/applications/:id/file`，后补/替换 `POST .../:id/file`。
- 自检 `scripts/smoke-applications.ps1`（**109 项**，需 8787）。**别把输出接到 `Select-Object -First N`**（上游 pwsh 会继续跑，两条自检互相推进状态机）。⚠️ 该脚本从「关闭本届」跑到底 → **会归档并清空本地报名数据**。

## 邮件（SMTP）
- 契约 `shared/mail.ts`；配置存 `site_config['runtime'].mail`。
- **密码存 D1**：`SESSION_SECRET` 经 HKDF 派生密钥 AES-GCM 加密成 `enc$<iv>.<密文>`；`SMTP_PASSWORD` 仅兜底（库里优先）。下发一律剥离密码，后台只拿 `mailPasswordSource`；保存三态：**不带 password 键=不改 / 空串=清除 / 有值=更新**；**KV 存的是密文版**。
- `worker/lib/smtp.ts`（cloudflare:sockets，465 TLS / 587 STARTTLS → startTls 后必须重建 reader/writer 再 EHLO）；`worker/lib/mailer.ts`（RFC 2047 + Base64 折行）；`POST /api/admin/mail/test`（400=配置错 / 502=发送失败）。
- 25 端口被封；生产不能连 localhost/私有网段（本地 miniflare 可以）；`import { connect, type Socket } from 'cloudflare:sockets'` 会 TS2305（Socket 是全局类型）。

## SSO
`shared/sso.ts` + `worker/routes/sso.ts` + `worker/lib/student-auth.ts`；两套会话 `kc_admin`(12h)/`kc_student`(30d)；开关与地址存 `runtime.sso`，判定统一 `isSsoReady()`；回调失败 302 首页 `?login=<原因>`。授权服务器在另一仓库（EdgeOne），契约改动三方同步。2026-09-24 起 RuntimeConfig **已删 `join` 通道**（请求恒定同源）；failover/rolloutPercent 只为兼容旧 JSON 保留、无人消费。

## 前台约定
- `slides`：type='text'（kicker/title/subtitle/cta，showWhen）/ 'image'（只有图铺满）；`HERO_HEIGHT` 常量两种类型共用高度。导航：首页/新闻/项目/成员/加入我们。
- **成员「方向 / 角色」字典**（取代原 `MEMBER_ROLES`）：契约 `shared/identity.ts` → 存储 `worker/lib/identity-config.ts`（KV `member_roles` 优先，D1 `site_config['memberRoles']` 是事实源，写 D1 后删 KV）→ 接口 `GET|PUT /api/admin/member-roles`（PUT **整份覆盖**；移除「还有人在用」的方向需 `confirmRemoval:true`，否则 409 `ROLE_IN_USE`；停用不算移除）→ 页面 `/admin/roles`。
  **刻意存中文名、不做稳定 id**：改名单只影响之后新增的记录，历史值原样保留、不回写 → 删改方向零迁移（`members.title` 自 0001 起是 TEXT）；代价是没法一键统一改历史叫法。
  **边界**：非学生方向**永不允许** `selectableBySelf`（validate 强制纠正）；邀请函只下发 `selfSelectableLabels()`，`confirmInvite` 再独立校验 → 学生写不成「指导老师」。
  字段侧 `optionsSource:'memberRoles'`（`options` 只是兜底，白名单由 `validateEntity(def, input, ctx.memberRoles)` 注入）；**更新记录时必须把原值并进白名单**（`admin-content.ts: validationContext()` 与 `ContentPage.tsx: resolvedFields` 必须同规则），否则改名后老记录连电话都改不了。
- 成员卡片：`direction`=负责方向（在组必填）、`destination`=毕业去向（已毕业必填）；卡片取 `destination || direction` 兜底；头像为空用姓名首字；`homepageUrl` 非空时显示「点击进入个人主页」（`homeHref()` 补 `https://`）。
- 上传：`POST /api/admin/uploads`（魔数嗅探）；`UPLOAD_IMAGE_LIMITS`（avatars 2MB / slides 50MB / 默认 2MB）。
- 项目页 `ProjectsSection`：按年份分组、`sm:grid-cols-2`；卡片 `flex flex-col` + 描述 `flex-1`（grid 默认 stretch → 同行等高、底部对齐，**别改成 `items-start`**，否则展开时同行会长短不一）。荣誉仍是**单个字符串** `honor`（数据侧不改，后台提示「；」分隔），前端 `splitHonors` 拆成逐条 + `divide-y` 隔断，**超过 2 条**才出现下三角「展开全部 N 项 / 收起」。卡片底部固定一行链接，文案「**点击跳转到项目仓库**」，`link` 为空则整行不渲染。

## 已知坑
- `vite.config.ts` base 必须 `'/'`（后台多级路由，`'./'` 深层刷新 404）。本机 3000/5173 被 IDE 占用，前端固定 5175 + strictPort；wrangler dev 只听 IPv4。
- **`wrangler dev` 按请求从 `dist/` 读文件**：改完前端跑一次 `npm run build` 刷新即可，不用重启服务。
- wrangler 异常退出残留 workerd 占 8787（`Get-NetTCPConnection -LocalPort 8787` 查 PID 更快）。
- PowerShell 7 `Invoke-RestMethod -Form` 上传缺 name 会炸 formData；用 `curl.exe -F`。
- 路由支持 `*` 通配（捕获在 `ctx.params['*']`）；`/api/files/*` 必须注册在更具体的 `/api/files/direct/:token` 之后。
- `db:migrate:*` 会重跑全部 migrations（靠报错跳过）；有数据的库只单独执行新增文件。
- `smoke-api.ps1` 异常中断会留下「冒烟测试工作室」配置，跑完到后台确认还原。
- **React 列表 key 不能取自可编辑内容**：敲一个字 key 就变 → React 重建该行 → 焦点丢失（表现为「编辑框打不了字」）。用与内容无关的本地 id（`MemberRolesPage.tsx` 的 `EditableRole.rowId` 是范例）。
- 全量 `npx eslint src shared worker` 有 8 个**既有**错误，都在 `src/components/ui/*`（shadcn），与本改动无关。
