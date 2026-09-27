# kingcola（拾光工作室官网）· 长期记忆

> 只记跨会话仍然成立的事实；日流水写 `YYYY-MM-DD.md`。
> 整理记录：2026-09-27（合并招新章节、删掉已作废的「场次 / 自动流程 / Cron / 时间窗」描述）。

## 项目定位
学生工作室官网 + 内部后台。前台只读，写操作收敛到 `/admin`。前后端同仓：Vite React + Cloudflare Workers（`run_worker_first = ["/api/*"]`）。

## 环境约定（本机）
- PATH 无 node/npm：`Import-Module D:\usexxx\use-xxx.psm1; use-node 22.23.2`（必须 22.23.2，Vite 7 要求）。
- npm registry `npm.mirrors.msh.team` 已失效：package-lock 换成 `https://registry.npmmirror.com/` 后 `npm install --registry=https://registry.npmmirror.com`。
- 含中文的 `.ps1` 必须 `pwsh` 运行（5.1 编码错乱）。wrangler 4.137.0。
- 本地密钥在 `.dev.vars`（gitignore）；本地管理员 `admin` / `kingcola-dev-2026`。

## 命令约定
| 目的 | 命令 |
|---|---|
| 本地验收 | `npm run local` → http://127.0.0.1:8787 |
| 开发 | `npm run dev:api` + `npm run dev` → http://127.0.0.1:5175 |
| 检查/构建/部署 | `npm run typecheck` / `build` / `deploy` |
| D1 建表 | `npm run db:migrate:local` / `:remote` |
| 自检 | `scripts/smoke-api.ps1`（内容/上传/配置）、`scripts/smoke-applications.ps1`（招新全流程）、`scripts/probe-local.ps1` |

## 架构约定
- **`shared/` 是前后端唯一契约源**：types / resources / qr（冻结）/ runtime / mail / recruit / sso / site / seed / storage。
- **`shared/resources.ts` 一份元数据同时驱动 Worker 的 SQL·校验与后台的表格·表单**。字段选项：`type`（text/textarea/select/switch/number/date/tags/image）、`required`、`showWhen`/`requiredWhen`（共用 `isFieldActive`）、`scope`（上传子目录）、`optionLabels`、`preview`、`inList`/`compact`、`hint`、`autoId`、`defaultValue`。新增内容类型只加一条，不改路由与页面。
- **成员/内容表的读写口径**（2026-09-27 审计定稿）：
  - 读：一律 `columnList(def)` = `id` + 全部字段列，`rowToEntity` 解码全部字段 → 字段无遗漏。
  - 创建：`createEntity`/`insertSeedEntity` 先用 `defaultEntity` 补默认值再整行 INSERT → 每列都显式写入。
  - 更新：`updateEntity` 只写提交上来的列，未提交的保留原值（**不会误清空**）。
  - 校验：唯一口径是 `validateEntity`（前后端共用），后台表单提交前也会先本地校验一次。
  - 互斥字段用 `requiredWhen` 与 `showWhen` 同条件：**在组必填「负责方向」、已毕业必填「毕业去向」**。
- **主键两制**：默认文本主键（`m-xxx`，`randomId`）；`projects` 用 `autoId:true` 自增整数，查库前必须 `normalizeId()`。
- **前台是真实路由**：`PAGE_PATHS` 声明在 shared/types.ts，别写死 href；新增板块改四处（PageKey → LABELS/PATHS → App.tsx Routes → Header NAV_ORDER）。后台 `/admin/*`。
- 接口统一信封 `{ ok, data }` / `{ ok, error:{code,message} }`，前端 `apiRequest` 解包。
- **D1 唯一事实源**；KV 只做配置缓存；R2 用于站点图片与报名表（经存储适配层）。
- 站点文案全来自 `site_config['site']`（SiteConfig + DEFAULT_SITE_CONFIG）；新增字段不需迁移（JSON 合并），改三处：shared/types.ts → SettingsPage → section 读取。列表文案解析规则在 shared/site.ts。
- 管理员存 D1 `admin_users`（PBKDF2），不绑个人云账号；`RECOVERY_TOKEN` 灾备。
- 交接/运维文档在 `docs/HANDOVER.md`，改动部署/密钥后要同步。
- ⚠️ 工作区被多会话并行修改（含本记忆文件）：动文件前先读当前内容。

## 对象存储适配层（2026-09-24 重构）
- 契约 `shared/storage.ts`：`StoragePurpose = 'site' | 'applications'`（站点图片 / 报名表，两目标可各配桶）；`StorageTargetConfig`（provider/binding/endpoint/bucket/accessKeyId/secretAccessKey/pathPrefix/publicBase/forcePathStyle/directTtlSeconds）；配置存 D1 `site_config['storage']`（非 runtime），无迁移。
- 适配层 `worker/lib/storage/`：`registry.ts` 插件注册表（`registerStorageAdapter(id, factory)`；内置 `r2`（binding）与 `s3`（自实现 SigV4 预签名，兼容 R2 S3 API/MinIO/COS/OSS，无 SDK 依赖））；`sigv4.ts` 只做 query 预签名（UNSIGNED-PAYLOAD），put/get/delete 都走自签预签名 URL；`index.ts` 的 `getStorage(env, purpose)` 门面。
- **直连**：s3 预签名 GET/PUT（真直连不过后端）；r2 binding 不支持预签名 → 退化为 KV 一次性 token + `/api/files/direct/:token` 中转（token 用后即焚）。签发口 `POST /api/admin/storage/direct-token`。
- secretAccessKey 落库但**永不下发**（接口只返回 `secretConfigured`；保存时空值=保留旧值）—— 与 mail 的「密码只走 env」刻意不同，因两目标可能是不同第三方桶。
- 业务口约定：站点图 URL 可存 `/api/files/<key>` 或 publicBase 直链，`resolveFileRef()` 两种前缀都能反解；`applications/` 前缀是私有文件。
- 冒烟技巧：`kc_admin` Cookie 恒带 `Secure`，本地 HTTP 下必须从 cookie jar 手动取 token 回传 `cookie:` 头；PS 内联 JSON 用 `--data-binary $body` 变量（`{\"..\"}` 转义会发非法体）。

## 招新：用户明确要求的三条边界
- **「设置 vs 流程」判据：下一届还要不要重新填一次？** 要 → 属于本届，留在「流程」（本届名称、四个 QQ 群号、阶段推进、名单、成绩评语、签到二维码）；不要 → 跨届通用，进「设置」（七封邮件模板、官网「招新与加入我们」文案）。
  用户原话：「邮件是通用模板，设置内的选项不应该存在属于报名流程内，请明确设置的边界。」休眠大屏上的「设置」按钮打开的是**通用设置**；本届名称与群号在「启动系统」之后填，且**任何状态都能改**。后端仍只有两个写口：`PUT /api/admin/recruit`（名称/群号/模板，**不接受 state**）与 `POST /api/admin/recruit/actions`（推进状态）。
- **「资料随时可改」**（用户原话：补录时若拿不到全部信息就卡死，且当时没有后补材料的入口）：名单 → 某行「**详情 · 改资料**」→「资料（可修改）」区，姓名/学号/邮箱/手机/QQ 与报名表（后补或替换）**全可改**；学号撞人 → 409 `ALREADY_EXISTS`。`PUT /api/admin/applications/:id` 的 `IMMUTABLE_KEYS` 只剩 id/createdAt；`POST .../:id/file` 后补替换（成功后删旧文件；改姓名/学号会重算下载名「姓名+学号+报名表」）。**笔试现场补录不再要求报名表**，联系方式只校验格式、不强制必填 —— 老版要求必填正是「拿不到就补不了」的根源。「设置」里的变量清单显示每个变量**此刻的值**（本届名称与四个群号只读），休眠期显示「还没配置」。
- **「关闭 / 清空」这类词必须先问清语义**。用户口径：「就是结束整个报名流程，清空报名数据表，清空报名表的功能」→ 即 `reset_apply`：**推倒重来**（不是临时停收、也不是退回未开启）。

## 招新系统（最终形态；以代码为准：`shared/recruit.ts` + `worker/lib/recruit-cycle.ts`）
- **入口**：`/admin/recruit` = `src/admin/recruit/RecruitPage.tsx`，四个视图（流程（时间线 + 阶段面板）/ 名单 / 邮件日志 / 设置），共用 `useRecruitAdmin.ts` 一份状态；界面常量与纯函数放 `recruit-ui.ts`（**只放常量/纯函数、不放组件** —— 混在一起会踩 react-refresh 规则）。旧版页面备份 `backup/recruit-legacy/` **已于 2026-09-27 删除**，要看旧实现翻 git：`git show 08fb2fd:backup/recruit-legacy/src/admin/recruit/<文件>`。
- **状态是「阶段 + 结果」两列**：`stage` ∈ apply/written/interview/defense/onboard，`result` ∈ ''（待定）/attended/passed/failed/absent/declined/withdrawn；中文标签由 `applicationLabel(stage,result)` 派生、**不入库**；阶段只能相邻推进或退回一步（`canMoveStage`）。旧的单列 14 态枚举已废弃。
- **整届没有时间字段、也没有场次**：`RecruitCycleConfig` 只有 `name / state / groups(四个 QQ 群号) / startedAt`。状态机 11 态（dormant→prepare→apply→apply_review→written→…→onboard→dormant），**全部动作集中在 `RECRUIT_ACTION_META` 一张表**（from/to/needsSelection/文案），后端 `worker/lib/recruit-cycle.ts: runRecruitAction()` 执行，接口 `POST /api/admin/recruit/actions`；后台按钮文案与可点性读同一张表（不会「界面能点但后端拒绝」）。
- **契约全在 `shared/recruit.ts`**：阶段/结果/标签/流转/`STAGE_RESULTS`/`checkinEligibility`/周期 `RecruitCycleConfig`/7 条邮件模板 `RecruitTemplates`/动作表 `RECRUIT_ACTION_META`/CSV 列 `RECRUIT_EXPORT_COLUMNS`/`APPLICATION_*_PATTERN` 与 `validateApplicationForm`。
- **周期配置存 D1 `site_config['recruit']`**（刻意不放 runtime：runtime 每个访客都会拉，模板正文不该下发），无迁移。读时注意库里可能留着旧版本写下的键（applyStart / archives / …）：`mergeCycle` 逐字段取值并校验 `state`，**不要把旧 JSON 直接铺开回显**。报名通道只由 `state === 'apply'` 决定（`isApplyOpen(state)`）。
- ⚠️ **以下概念已整体作废，别再引入**：`worker/lib/recruit-auto.ts`、`/api/admin/recruit/auto`、`RecruitAutoTask` 一族、`[triggers] crons` / `runRecruitScheduled`（`worker/index.ts` **没有 `scheduled`**）、`recruitPhase()` / 时间窗 / `site.recruitOpen`、周期的 `archives` 字段、`shared/time.ts`、`recruit_sessions` 表与 `applications.*_session_id` 三列。需决策的事（谁晋级、谁录取）一律由管理员勾选后点动作；缺考在「结束笔试/面试/答辩」动作里一次标完。将来若又要处理时间：服务器在 UTC，**绝不能** `new Date('2026-09-25T09:00')`（会差 8 小时）。
- **邮件**：八条模板，变量只有 `{name}{studentId}{cycleName}{writtenGroup}{interviewGroup}{probationGroup}{formalGroup}{inviteLink}{rejectReason}{studio}{contactEmail}{contactAddress}`；**缺考与未通过初筛一律不发信**；发信失败不阻断流转；只按「目标状态」决定发哪封信 → 改判（failed→passed）不会误发。
- **材料审核（2026-09-27 新增，迁移 `0010_recruit_material_review.sql`）**：`applications` 增
  `material_status`（'' 待审核 / approved 通过 / rejected 驳回）+ `material_reason` + `material_reviewed_at`。
  后台**名单**页报名阶段可逐个「通过 / 驳回」（批量也可以；驳回**必须写理由**并**自动逐人发信**，
  邮件正文带 `{rejectReason}`）；**同学重传材料后审核状态自动回到待审核**；
  只在 `apply` / `apply_review` 能审（其余态 409 `STAGE_NOT_APPLICABLE`）；
  **未通过审核的人不能被勾选进笔试**（`confirm_written` 整体拒绝，`MATERIAL_NOT_APPROVED`），
  这道闸只作用于「报名 → 笔试」这一步。
- **报名结束后的进度入口**：官网「加入我们」在 `gate=closed` 时不再把登录按钮藏起来 ——
  未登录者看到「报名已截止」+「**扫码登录，查看我的进度**」（教务网微信扫码）。
  同学登录后能看材料审核状态与驳回理由；被驳回且报名未结束时，页面直接给「重新上传材料」表单
  （替换走 `POST /api/applications?replace=true`，**`replace` 只认 query 参数**）。
- **签到 = 阶段 + 凭证**（`0009_recruit_no_sessions.sql` 起，「场次」概念不存在）：`recruit_checkin_tokens` 只绑 `stage`（written/interview/defense）+ `expires_at` + `revoked_at`，**签发新码自动作废该阶段旧码**；接口 `GET|POST /api/admin/recruit/checkin-codes`、`POST .../revoke`；签到页**只有** `/checkin/<token>`（`checkinTokenPath`），**没有裸入口**；`checkinEligibility()` 的 `ahead` 分支保留（人在考场不能因后台没点按钮签不了）。⚠️ **`QR_SIGN_SECRET` 是 SSO applyToken 验签密钥，不是签到二维码密钥**，别复用。
- **关闭本届 `close_cycle` = 先归档再清空**：未确认的记 absent → 导出 CSV 到对象存储 `applications/archives/` → 存档信息追加进周期 → 删报名表文件 → 清空 `applications` 与 `application_mails` → 写 `closedAt`；**对象存储没接通就拒绝关闭**。
- **`reset_apply`（后台「强制结束报名并清空数据」）**：只在 `apply` / `apply_review` 可用，删光报名记录 + 这些人的报名表文件（跳过 `RECRUIT_ARCHIVE_SCOPE` 归档 CSV，别误删往届存档）+ 发信日志，`state` 退回 **`prepare`（备招）**，名称与群号保留、可立刻重开报名。**刻意不导出存档、也不因存储不可用而拒绝**（与 `close_cycle` 的区别见 `docs/HANDOVER.md` §6.9）；响应带 `cleaned{applications, files, filesFailed}`，后台 toast 如实报数。
- **邀请函转正**：`POST /api/applications/invite/:token`（凭证即密权，14 天有效、只能确认一次）→ 写 `members` 并把 `memberId` 记回 `applications`。
- **表与文件**：`applications` + `application_mails`（`0007_recruit_stages.sql`）+ `recruit_checkin_tokens`（`0009` 重建为只绑阶段）。**已有数据的库必须单独** `wrangler d1 execute --file=migrations/000N_xxx.sql`，不能整体 `db:migrate`。报名表与存档都在对象存储 `applications/` 前缀（私有，`GET /api/files/*` 一律 404）：下载口 `GET /api/admin/applications/:id/file`，后补/替换口 `POST /api/admin/applications/:id/file`。
- **自检**：`scripts/smoke-applications.ps1`（**101 项**，跑前需服务在 8787）。**别把输出接到 `Select-Object -First N`** —— 上游 pwsh 会继续跑，导致两条自检互相推进状态机。

## 邮件（SMTP）
- 契约 `shared/mail.ts`；配置存 `site_config['runtime'].mail`。
- **密码存 D1**（2026-09-25 起，后台「邮件」页直接填）：`SESSION_SECRET` 经 HKDF 派生密钥做 AES-GCM 加密成 `enc$<iv>.<密文>`（`crypto.ts` 的 `encryptSecret`/`decryptSecret`）；`SMTP_PASSWORD` 仅兜底（库里优先）。**下发接口一律剥离密码**（`publicSmtpConfig()` + `config.ts` 的 `publicRuntimeConfig()`），后台只拿 `mailPasswordSource`（database/env/none）；保存三态：**不带 password 键=不改 / 空串=清除 / 有值=更新**（`admin-content.ts` 必须先摘掉提交上来的 mail 再 spread，否则明文进落库对象）。解密在 `resolveRuntimeConfig` 里做，**KV 缓存写的是密文版**。
- `worker/lib/smtp.ts`（cloudflare:sockets，465 TLS / 587 STARTTLS → startTls 后必须重建 reader/writer 再 EHLO）；`worker/lib/mailer.ts` MIME（RFC 2047 + Base64 折行）；`POST /api/admin/mail/test`（400=配置错 / 502=发送失败）。
- 25 端口被封；生产不能连 localhost/私有网段（本地 miniflare 可以）；`import { connect, type Socket } from 'cloudflare:sockets'` 会 TS2305（Socket 是全局类型）。

## 流量通道 / SSO
- 教务网 SSO：契约 `shared/sso.ts` + `worker/routes/sso.ts` + `worker/lib/student-auth.ts`；两套会话 `kc_admin`（12h）/ `kc_student`（30d）。开关与地址存 `runtime.sso`（后台维护），判定统一 `isSsoReady()`；回调失败 302 首页 `?login=<原因>`。授权服务器在另一仓库（EdgeOne），契约改动三方同步。
- 2026-09-24 起 RuntimeConfig **已删除 `join` 通道**（`ChannelTarget` 不再进 RuntimeConfig，`src/api/client.ts` 的 join 分流/灰度已删，所有请求同源）；failover/rolloutPercent 字段保留兼容旧 JSON 但已无人消费。

## 前台其他约定
- `slides`：type='text'（kicker/title/subtitle/cta，showWhen）/ 'image'（只有图铺满）；`HERO_HEIGHT` 常量两种类型共用高度，控制器 `CarouselControls` 同一位置（用户明确要求过）。
- 顶部导航：首页/新闻/项目/成员/加入我们（无后台入口，页脚有管理链接）。
- 成员卡片：`direction`=负责方向（在组）、`destination`=毕业去向（已毕业），按 `status` 用 showWhen/requiredWhen 切换；卡片取 `destination || direction` 兜底。头像为空时用姓名首字占位（`MemberAvatar`）。
- 上传：`POST /api/admin/uploads`（魔数嗅探）；体积上限在 `shared/resources.ts` 的 `UPLOAD_IMAGE_LIMITS`（avatars 2MB / slides 50MB / 默认 2MB）。

## 已知坑
- `vite.config.ts` base 必须 `'/'`（后台多级路由，`'./'` 深层刷新 404）。
- wrangler 异常退出残留 workerd 占 8787：清理含 wrangler 的 node 进程 + workerd。
- 本机 3000/5173 被 IDE 服务长期占用，前端固定 5175 + strictPort。
- wrangler dev 只听 IPv4 127.0.0.1；用 `127.0.0.1:8787`。
- PowerShell 7 `Invoke-RestMethod -Form` 上传缺 name 会炸 formData；用 `curl.exe -F`。
- 路由支持 `*` 通配，捕获在 `ctx.params['*']`；`/api/files/*` 这类通配路由必须注册在更具体的 `/api/files/direct/:token` 之后。
- `npm run db:migrate:*` 会重跑全部 migrations（靠报错跳过）；已有数据的库只单独执行新增文件。
- `scripts/smoke-api.ps1` 异常中断会留下「冒烟测试工作室」配置，跑完到后台确认/手工还原。
