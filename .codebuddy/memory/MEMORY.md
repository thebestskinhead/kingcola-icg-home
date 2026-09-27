# kingcola（拾光工作室官网）· 长期记忆

> 只记跨会话仍然成立的事实；日流水写 `YYYY-MM-DD.md`。
> 整理记录：2026-09-27 压缩重写（合并招新章节，删掉已作废概念清单与冗长解释）。

## 项目定位
学生工作室官网 + 内部后台。前台只读，写操作收敛到 `/admin`。前后端同仓：Vite React + Cloudflare Workers（`run_worker_first = ["/api/*"]`）。

## 环境约定（本机）
- PATH 无 node/npm：`Import-Module D:\usexxx\use-xxx.psm1; use-node 22.23.2`（Vite 7 要求 22.23.2）。
- npm registry `npm.mirrors.msh.team` 已失效：package-lock 换 `https://registry.npmmirror.com/` 后 `npm install --registry=https://registry.npmmirror.com`。
- 含中文的 `.ps1` 必须 `pwsh` 运行（5.1 编码错乱）。wrangler 4.137.0。
- 本地密钥在 `.dev.vars`（gitignore）；本地管理员 `admin` / `kingcola-dev-2026`。

## 命令约定
| 目的 | 命令 |
|---|---|
| 本地验收 | `npm run local` → http://127.0.0.1:8787 |
| 开发 | `npm run dev:api` + `npm run dev` → http://127.0.0.1:5175 |
| 检查/构建/部署 | `npm run typecheck` / `build` / `deploy` |
| D1 建表 | `npm run db:migrate:local` / `:remote` |
| 自检 | `scripts/smoke-api.ps1`、`scripts/smoke-applications.ps1`、`scripts/probe-local.ps1` |

## 架构约定
- **`shared/` 是前后端唯一契约源**：types / resources / identity / qr（冻结）/ runtime / mail / recruit / sso / site / seed / storage。
- **`shared/resources.ts` 一份元数据同时驱动 Worker 的 SQL·校验与后台的表格·表单**。字段选项：`type`（text/textarea/select/switch/number/date/tags/image）、`required`、`showWhen`/`requiredWhen`（共用 `isFieldActive`）、`scope`、`optionLabels`、`preview`、`inList`/`compact`、`hint`、`autoId`、`defaultValue`。新增内容类型只加一条。
- **成员/内容表读写口径**：读 `columnList(def)` 全列；创建 `defaultEntity` 补默认值后整行 INSERT；更新只写提交上来的列（不会误清空）；校验唯一口径 `validateEntity`（前后端共用）。
- **主键两制**：默认文本主键（`randomId`）；`projects` 用 `autoId:true` 自增整数，查库前 `normalizeId()`。
- **前台是真实路由**：`PAGE_PATHS` 在 shared/types.ts；新增板块改四处（PageKey → LABELS/PATHS → App.tsx Routes → Header NAV_ORDER）。后台 `/admin/*`。
- 接口统一信封 `{ ok, data }` / `{ ok, error:{code,message} }`，前端 `apiRequest` 解包。
- **D1 唯一事实源**；KV 只做配置缓存；R2 用于站点图片与报名表。
- 站点文案全来自 `site_config['site']`（SiteConfig + DEFAULT_SITE_CONFIG，JSON 合并、无迁移）；新增字段改三处：shared/types.ts → SettingsPage → section；列表解析规则在 `shared/site.ts`。
- 管理员存 D1 `admin_users`（PBKDF2）；`RECOVERY_TOKEN` 灾备。运维文档 `docs/HANDOVER.md`，改部署/密钥后同步。
- ⚠️ 工作区被多会话并行修改（含本记忆文件）：动文件前先读当前内容。

## 对象存储适配层
- 契约 `shared/storage.ts`：`StoragePurpose = 'site' | 'applications'`（两目标可各配桶）；`StorageTargetConfig`（provider/binding/endpoint/bucket/accessKeyId/secretAccessKey/pathPrefix/publicBase/forcePathStyle/directTtlSeconds）；配置存 `site_config['storage']`，无迁移。
- `worker/lib/storage/`：`registry.ts` 插件表（内置 `r2` 与 `s3` —— 自实现 SigV4 预签名，兼容 R2 S3 API/MinIO/COS/OSS，无 SDK 依赖）；`index.ts` 的 `getStorage(env, purpose)` 门面。
- **直连**：s3 预签名 GET/PUT（真直连不过后端）；r2 不支持预签名 → 退化 KV 一次性 token + `/api/files/direct/:token`（用后即焚）。签发口 `POST /api/admin/storage/direct-token`。
- secretAccessKey 落库但**永不下发**（只返回 `secretConfigured`；保存时空值=保留旧值）。站点图 URL 可存 `/api/files/<key>` 或 publicBase 直链，`resolveFileRef()` 两种都能反解；`applications/` 前缀是私有文件。
- 冒烟技巧：`kc_admin` Cookie 恒带 `Secure`，本地 HTTP 需从 cookie jar 手动取 token 回传 `cookie:` 头；PS 内联 JSON 用 `--data-binary $body` 变量。

## 招新：用户明确要求的三条边界
- **「设置 vs 流程」判据：下一届还要不要重新填一次？** 要 → 本届「流程」（名称、四个 QQ 群号、阶段推进、名单、评语、签到码）；不要 → 跨届通用「设置」（邮件模板、官网招新文案）。休眠大屏的「设置」是通用设置；本届名称/群号在启动后填且任何状态都能改。后端只有两个写口：`PUT /api/admin/recruit`（**不接受 state**）与 `POST /api/admin/recruit/actions`。
- **「资料随时可改」**：名单 → 行内「详情 · 改资料」，姓名/学号/邮箱/手机/QQ 与报名表全可改；学号撞人 409 `ALREADY_EXISTS`。`PUT /api/admin/applications/:id` 的 `IMMUTABLE_KEYS` 只剩 id/createdAt；`POST .../:id/file` 后补替换（成功后删旧文件、重算下载名「姓名+学号+报名表」）。**笔试现场补录不要求报名表**，联系方式只校验格式。
- **「关闭 / 清空」必须先问语义**：用户口径 = `reset_apply` 推倒重来（不是临时停收、不是退回未开启）。

## 招新系统（以 `shared/recruit.ts` + `worker/lib/recruit-cycle.ts` 为准）
- 入口 `/admin/recruit`（`src/admin/recruit/RecruitPage.tsx`），四视图（流程 / 名单 / 邮件日志 / 设置）共用 `useRecruitAdmin.ts`；常量与纯函数放 `recruit-ui.ts`（**只放非组件**，混在一起踩 react-refresh 规则）。旧实现翻 git：`git show 08fb2fd:backup/recruit-legacy/...`。
- **状态 = 阶段 + 结果两列**：`stage` ∈ apply/written/interview/defense/onboard，`result` ∈ ''（待定）/attended/passed/failed/absent/declined/withdrawn；中文标签由 `applicationLabel(stage,result)` 派生、**不入库**；阶段只能相邻推进或退回一步（`canMoveStage`）。
- **整届没有时间字段、也没有场次**：`RecruitCycleConfig = { name, state, groups(四个 QQ 群号), startedAt }`；11 态状态机 dormant→prepare→apply→apply_review→written→…→onboard→dormant；**所有动作集中在 `RECRUIT_ACTION_META` 一张表**（from/to/needsSelection/文案），后台按钮文案与可点性读同一张表（不会「界面能点但后端拒绝」）。
- ⚠️ **已作废、别再引入**：`worker/lib/recruit-auto.ts`、`/api/admin/recruit/auto`、`RecruitAutoTask`、`[triggers] crons` / `runRecruitScheduled`（`worker/index.ts` 没有 `scheduled`）、`recruitPhase()` / 时间窗 / `site.recruitOpen`、周期的 `archives` 字段、`shared/time.ts`、`recruit_sessions` 表与 `applications.*_session_id` 三列。需决策的事（谁晋级、谁录取）一律管理员勾选后点动作；缺考在「结束笔试/面试/答辩」动作里一次标完。服务器在 UTC，**绝不能** `new Date('2026-09-25T09:00')`（差 8 小时）。
- **周期配置存 D1 `site_config['recruit']`**（刻意不放 runtime：模板正文不该下发给每个访客），无迁移；读时 `mergeCycle` 逐字段取值并校验 `state`，别把旧 JSON 直接铺开。报名通道只由 `isApplyOpen(state)` 决定。
- **邮件八模板**，变量只有 `{name}{studentId}{cycleName}{writtenGroup}{interviewGroup}{probationGroup}{formalGroup}{inviteLink}{rejectReason}{studio}{contactEmail}{contactAddress}`；**缺考与未通过初筛一律不发信**；发信失败不阻断流转；只按「目标状态」决定发哪封信 → 改判（failed→passed）不会误发。⚠️ 群号短名（`groups.written`）≠ 模板令牌（`{writtenGroup}`），统一走 `cycleMailVars(cycle)`；凡模板变量都别手写键名（曾出过「预览骗人」）。
- **材料审核**（迁移 `0010_recruit_material_review.sql`）：`applications` 增 `material_status`（'' 待审核 / approved / rejected）+ `material_reason` + `material_reviewed_at`。名单页报名阶段可逐个或批量「通过 / 驳回」（驳回**必须写理由**并**自动逐人发信**，正文带 `{rejectReason}`）；**重传材料后自动回到待审核**；只在 apply / apply_review 能审（其余 409 `STAGE_NOT_APPLICABLE`）；**未通过审核的人不能被勾选进笔试**（`MATERIAL_NOT_APPROVED`）——这道闸只作用于「报名 → 笔试」。
- **报名结束后的进度入口**：官网「加入我们」在 `gate=closed` 时不再藏登录按钮 —— 未登录者看到「报名已截止」+「扫码登录，查看我的进度」；登录后可见材料审核状态与驳回理由，被驳回且报名未结束可直接重传（`POST /api/applications?replace=true`，**`replace` 只认 query 参数**）。
- **签到 = 阶段 + 凭证**（`0009` 起「场次」概念不存在）：`recruit_checkin_tokens` 只绑 `stage`（written/interview/defense）+ `expires_at` + `revoked_at`，**签发新码自动作废该阶段旧码**；接口 `GET|POST /api/admin/recruit/checkin-codes`、`POST .../revoke`；签到页**只有** `/checkin/<token>`，没有裸入口；`checkinEligibility()` 的 `ahead` 分支保留。⚠️ **`QR_SIGN_SECRET` 是 SSO applyToken 验签密钥，不是签到码密钥**。
- **`close_cycle` = 先归档再清空**：未确认的记 absent → 导出 CSV 到 `applications/archives/` → 存档信息追加进周期 → 删报名表文件 → 清空 `applications` 与 `application_mails` → 写 `closedAt`；**对象存储没接通就拒绝关闭**。
- **`reset_apply`**（后台「强制结束报名并清空数据」）：只在 apply / apply_review 可用；删光报名记录 + 其报名表 + 发信日志（跳过 `RECRUIT_ARCHIVE_SCOPE` 归档，别误删往届存档），`state` 退回 **`prepare`**，名称与群号保留、可立刻重开；**刻意不导出存档、也不因存储不可用而拒绝**；响应带 `cleaned{applications, files, filesFailed}`。
- **邀请函转正**：`POST /api/applications/invite/:token`（凭证即密权，14 天有效、只能确认一次）→ 写 `members` 并把 `memberId` 记回 `applications`。
  转正页**必传个人头像**：由 `POST /api/applications/invite/:token/avatar` 上传（同一张凭证、不需要登录），
  确认时只接受**本站 `avatars/` 前缀**的地址（拒任意外链，`resolveFileRef` 校验）；
  「负责方向」同样必填。三个邀请函入口共用 `pendingInviteError()`（存在/待确认/未过期）。
- **上传的公共实现**：`worker/routes/uploads.ts` 的 `receiveImage(ctx, resolveScope)` —— 解析 multipart、
  按 scope 校验体积、魔数嗅探、落站点存储，**不含鉴权**；管理员口（`/api/admin/uploads`）与邀请函头像口共用它。
  `resolveScope` 由调用方给：管理员读表单里的 `scope`，邀请函**硬编码 `avatars`**（不信任请求）。
- **表与文件**：`applications` + `application_mails` + `recruit_checkin_tokens`。**已有数据的库必须单独** `wrangler d1 execute --file=migrations/000N_xxx.sql`，不能整体 `db:migrate`。报名表与存档都在对象存储 `applications/` 前缀（私有，`GET /api/files/*` 一律 404）；下载口 `GET /api/admin/applications/:id/file`，后补/替换口 `POST /api/admin/applications/:id/file`。
- 自检 `scripts/smoke-applications.ps1`（**103 项**，需服务在 8787）。**别把输出接到 `Select-Object -First N`** —— 上游 pwsh 会继续跑，导致两条自检互相推进状态机。

## 邮件（SMTP）
- 契约 `shared/mail.ts`；配置存 `site_config['runtime'].mail`。
- **密码存 D1**：`SESSION_SECRET` 经 HKDF 派生密钥做 AES-GCM 加密成 `enc$<iv>.<密文>`；`SMTP_PASSWORD` 仅兜底（库里优先）。**下发接口一律剥离密码**（`publicSmtpConfig()` / `publicRuntimeConfig()`），后台只拿 `mailPasswordSource`（database/env/none）；保存三态：**不带 password 键=不改 / 空串=清除 / 有值=更新**。解密在 `resolveRuntimeConfig` 里做，**KV 缓存写的是密文版**。
- `worker/lib/smtp.ts`（cloudflare:sockets，465 TLS / 587 STARTTLS → startTls 后必须重建 reader/writer 再 EHLO）；`worker/lib/mailer.ts` MIME（RFC 2047 + Base64 折行）；`POST /api/admin/mail/test`（400=配置错 / 502=发送失败）。
- 25 端口被封；生产不能连 localhost/私有网段（本地 miniflare 可以）；`import { connect, type Socket } from 'cloudflare:sockets'` 会 TS2305（Socket 是全局类型）。

## 流量通道 / SSO
- 教务网 SSO：契约 `shared/sso.ts` + `worker/routes/sso.ts` + `worker/lib/student-auth.ts`；两套会话 `kc_admin`（12h）/ `kc_student`（30d）。开关与地址存 `runtime.sso`（后台维护），判定统一 `isSsoReady()`；回调失败 302 首页 `?login=<原因>`。授权服务器在另一仓库（EdgeOne），契约改动三方同步。
- 2026-09-24 起 RuntimeConfig **已删除 `join` 通道**，所有请求同源；failover/rolloutPercent 字段保留兼容旧 JSON 但已无人消费。

## 前台其他约定
- `slides`：type='text'（kicker/title/subtitle/cta，showWhen）/ 'image'（只有图铺满）；`HERO_HEIGHT` 常量两种类型共用高度，控制器 `CarouselControls` 同一位置。
- 顶部导航：首页/新闻/项目/成员/加入我们（无后台入口，页脚有管理链接）。
- **成员「方向 / 角色」字典（2026-09-27 落地，取代原常量 `MEMBER_ROLES`）**：
  契约 `shared/identity.ts`（`MemberRole{label,kind,selectableBySelf,order,retired}` + `DEFAULT_MEMBER_ROLES` + `normalizeMemberRoles`/`validateMemberRoles`/`selfSelectableLabels`/`isSelfSelectable`/`adminRoleLabels`）；
  存储 `worker/lib/identity-config.ts`（**KV key `member_roles` 优先读**，D1 `site_config['memberRoles']` 是事实源，写入 D1 后**删 KV 缓存**；没绑 KV 就直读 D1）；
  接口 `GET|PUT /api/admin/member-roles`（GET 带 `usage` 人数；PUT **整份覆盖**，移除「还有人在用」的方向必须带 `confirmRemoval:true`，否则 409 `ROLE_IN_USE`；停用不算移除）；页面 `/admin/roles`「方向与身份」。
  **刻意存中文名、不做稳定 id**：语义是「**改名单只影响之后新增的记录，历史值原样保留、不回写**」，所以删改方向永远安全、零迁移（`members.title` 自 0001 起就是 TEXT）；代价是做不到「一键统一改历史叫法」，真需要时写一条显式 `UPDATE members SET title=...`。
  **边界**：`kind !== 'student'` 的方向**永不允许** `selectableBySelf`（`validateMemberRoles` 会强制纠正），邀请函只下发 `selfSelectableLabels()`，`confirmInvite` 还会独立再校验 → 学生不可能把自己写成「指导老师」。
  字段侧标记 `shared/resources.ts` 的 `optionsSource: 'memberRoles'`：那里的 `options` 只是兜底，真实白名单由调用方注入 `validateEntity(def, input, ctx.memberRoles)`；**更新一条记录时必须把它原来的取值并进白名单**，否则改名后老记录连电话都改不了（`admin-content.ts: validationContext()`、`ContentPage.tsx: resolvedFields` 各一处，规则必须一致）。
- 成员卡片：`direction`=负责方向（在组必填）、`destination`=毕业去向（已毕业必填），按 `status` 用 showWhen/requiredWhen 切换；卡片取 `destination || direction` 兜底；头像为空时用姓名首字占位（`MemberAvatar`）。
- 上传：`POST /api/admin/uploads`（魔数嗅探）；体积上限在 `UPLOAD_IMAGE_LIMITS`（avatars 2MB / slides 50MB / 默认 2MB）。

## 已知坑
- `vite.config.ts` base 必须 `'/'`（后台多级路由，`'./'` 深层刷新 404）。
- wrangler 异常退出残留 workerd 占 8787：清理含 wrangler 的 node 进程 + workerd。
- 本机 3000/5173 被 IDE 服务长期占用，前端固定 5175 + strictPort；wrangler dev 只听 IPv4 `127.0.0.1`。
- PowerShell 7 `Invoke-RestMethod -Form` 上传缺 name 会炸 formData；用 `curl.exe -F`。
- 路由支持 `*` 通配，捕获在 `ctx.params['*']`；`/api/files/*` 这类通配路由必须注册在更具体的 `/api/files/direct/:token` 之后。
- `npm run db:migrate:*` 会重跑全部 migrations（靠报错跳过）；已有数据的库只单独执行新增文件。
- `scripts/smoke-api.ps1` 异常中断会留下「冒烟测试工作室」配置，跑完到后台确认/手工还原。
- **React 列表的 key 不能取自可编辑内容**（如后台表格里那一行的输入框值）：敲一个字 key 就变 → React 重建该行 → 焦点丢失，表现为「编辑框打不了字」，很容易被误判成受控组件 / 输入法问题。用与内容无关的本地 id（`MemberRolesPage.tsx` 的 `EditableRole.rowId` 是范例）。
- `wrangler dev` 是**按请求从 `dist/` 读文件**的：改完前端跑一次 `npm run build` 就能在 8787 上刷新看到，不用重启服务。
