# kingcola（拾光工作室官网）· 长期记忆

## 项目定位
学生工作室官网 + 内部后台。前台只读，写操作收敛到 `/admin`。前后端同仓：Vite React + Cloudflare Workers（`run_worker_first = ["/api/*"]`）。

## 环境约定（本机）
- PATH 无 node/npm：`Import-Module D:\usexxx\use-xxx.psm1; use-node 22.23.2`（必须 22.23.2，Vite 7 要求）。
- npm registry `npm.mirrors.msh.team` 已失效：package-lock 里替换为 `https://registry.npmmirror.com/` 后 `npm install --registry=https://registry.npmmirror.com`。镜像实测可用（2026-09-25 用它装了 `qrcode.react@4.2.0`，lock 没带回失效主机名）。
- 含中文的 `.ps1` 必须 `pwsh` 运行（5.1 编码错乱）。
- wrangler 4.137.0；本地密钥在 `.dev.vars`（gitignore）；本地管理员 `admin` / `kingcola-dev-2026`。

## 命令约定
| 目的 | 命令 |
|---|---|
| 本地验收 | `npm run local` → http://127.0.0.1:8787 |
| 开发 | `npm run dev:api` + `npm run dev` → http://127.0.0.1:5175 |
| 检查/构建/部署 | `npm run typecheck` / `build` / `deploy` |
| D1 建表 | `npm run db:migrate:local` / `:remote` |
| 自检 | `scripts/smoke-api.ps1`、`scripts/smoke-applications.ps1`、`scripts/probe-local.ps1`（均 pwsh） |

## 架构约定
- **`shared/` 是前后端唯一契约源**：types / resources / qr（冻结）/ runtime / mail / recruit / sso / site / seed。
  `resources.ts` 一份配置驱动 Worker SQL/校验与后台表格/表单；字段配置：`type`（含 image）、`showWhen`/`requiredWhen`（共用 `isFieldActive`）、`scope`（上传子目录）、`optionLabels`、`preview`、`inList`/`compact`、`hint`、`autoId`。
- **主键两制**：默认文本主键（`m-xxx`）；`projects` 用 `autoId:true` 自增整数，查库前必须 `normalizeId()`。
- **前台是真实路由**：`PAGE_PATHS` 声明在 shared/types.ts，别写死 href；新增板块改四处（PageKey → LABELS/PATHS → App.tsx Routes → Header NAV_ORDER）。后台 `/admin/*`。
- **接口统一信封** `{ ok, data }` / `{ ok, error:{code,message} }`，前端 `apiRequest` 解包。
- **D1 唯一事实源**；KV 只做配置缓存；R2 用于站点图片与报名表（经存储适配层，见下）。
- 站点文案全来自 `site_config['site']`（SiteConfig + DEFAULT_SITE_CONFIG）；新增字段不需迁移（JSON 合并），改三处：shared/types.ts → SettingsPage 输入框 → section 读取。列表文案解析规则在 shared/site.ts。
- 管理员存 D1 `admin_users`（PBKDF2），不绑个人云账号；`RECOVERY_TOKEN` 灾备。
- 交接/运维文档在 `docs/HANDOVER.md`，改动部署/密钥后要同步。
- ⚠️ 工作区被多会话并行修改：动文件前先读当前内容。

## 对象存储适配层（2026-09-24 重构）
- 契约 `shared/storage.ts`：`StoragePurpose = 'site' | 'applications'`（站点图片 / 报名表，两目标可各配桶）；`StorageTargetConfig`（provider/binding/endpoint/bucket/accessKeyId/secretAccessKey/pathPrefix/publicBase/forcePathStyle/directTtlSeconds）；配置存 D1 `site_config['storage']`（非 runtime），无迁移。
- 适配层 `worker/lib/storage/`：`registry.ts` 插件注册表（`registerStorageAdapter(id, factory)`，内置 `r2`（binding）与 `s3`（自实现 SigV4 预签名，兼容 R2 S3 API/MinIO/COS/OSS，无需 SDK 依赖））；`sigv4.ts` 只做 query 预签名（UNSIGNED-PAYLOAD），put/get/delete 全部通过自签预签名 URL 自取自删；`index.ts` 的 `getStorage(env, purpose)` 门面。
- **直连**：s3 provider 预签名 GET/PUT（真直连不过后端）；r2 binding 不支持预签名 → 退化为 KV 一次性 token + `/api/files/direct/:token` 中转（token 用后即焚）。签发口 `POST /api/admin/storage/direct-token`。
- secretAccessKey 落库但**永不下发**（接口返回 `secretConfigured`；保存时空值=保留旧值）——与 mail 的「密码只走 env」刻意不同，因两目标可能是不同第三方桶。
- 已本地端到端冒烟全绿（配置读写/上传/读取/一次性令牌 #1=200 #2=403/applications 匿名 404）。冒烟技巧：kc_admin Cookie 恒带 `Secure`，本地 HTTP 下必须从 cookie jar 手动取 token 回传 `cookie:` 头；PS 内联 JSON 用 `--data-binary $body` 变量（`{\"..\"}` 转义会发非法体）。
- 业务口约定：站点图 URL 可存 `/api/files/<key>` 或 publicBase 直链；`resolveFileRef()` 两种前缀都能反解。applications/ 前缀仍是私有文件。

## 招新系统 · 最终形态（2026-09-25 全面接线完成，重要）
- **`/admin/recruit` = `src/admin/recruit/RecruitPage.tsx`，已接真接口**（四个视图：流程 / 名单 / 邮件日志 / 设置，
  共用 `useRecruitAdmin()`；界面常量在 `recruit-ui.ts`）。曾经的 Demo* 假数据页已全部删除。
- **整届没有任何时间字段、也没有场次**：`RecruitCycleConfig` 只有 `name / state / groups(四个 QQ 群号) / startedAt`。
  状态机 11 态（dormant→prepare→apply→apply_review→written→written_review→…→onboard→dormant），
  **全部动作在 `RECRUIT_ACTION_META` 一张表里**（from/to/needsSelection/文案），
  后端 `worker/lib/recruit-cycle.ts: runRecruitAction()` 执行，接口 `POST /api/admin/recruit/actions`；
  后台按钮文案与可点性读同一张表。`PUT /api/admin/recruit` 刻意不接受 `state`。
- 签到二维码在 `worker/lib/recruit-checkin.ts`：**只绑阶段**（笔试/面试/答辩各一张），签发新码自动作废旧码；
  接口 `GET|POST /api/admin/recruit/checkin-codes`、`POST .../revoke`。表 `recruit_checkin_tokens`（0009 重建）。
- 邮件：七条模板，变量只有 `{name}{studentId}{cycleName}{writtenGroup}{interviewGroup}{probationGroup}{formalGroup}{inviteLink}{studio}{contactEmail}{contactAddress}`；
  **缺考与未通过初筛一律不发信**；发信失败不阻断流转。
- 关闭本届：导出 CSV → 清库（含报名表文件、发信日志、签到凭证）→ 回到休眠；**对象存储没接通就拒绝关闭**。
  没有 Cron（`wrangler.toml` 无 `[triggers]`），缺考在「结束考试」动作里一次标完。
- 自检：`scripts/smoke-applications.ps1`（71 项，跑前需服务在 8787；`smoke-sessions.ps1` 已删）。
  **跑自检时不要把输出接到 `Select-Object -First N`** —— 上游 pwsh 会继续跑，导致两条自检互相推进状态机。
- 旧版页面仍留在 `backup/recruit-legacy/src/admin/recruit/`（不参与编译），功能已全部搬完，可随时删。
- **状态用「阶段 + 结果」两列**，不是单列枚举：`stage` ∈ apply/written/interview/defense/onboard，
  `result` ∈ ''（待定）/attended/passed/failed/absent/declined/withdrawn。
  「是否已安排笔试/面试」不再是个人状态，而是**全局周期时间窗**；中文标签由 `applicationLabel(stage,result)` 派生、**不入库**。
  阶段只能相邻推进或退回一步（`canMoveStage`），单列枚举（旧的 14 态）已废弃。
- 契约全在 **`shared/recruit.ts`**（阶段/结果/标签/流转/`STAGE_RESULTS`/`checkinEligibility`/周期 `RecruitCycleConfig`/
  7 条邮件模板 `RecruitTemplates`/自动任务 `RecruitAutoTask`/CSV 列 `RECRUIT_EXPORT_COLUMNS`）；
  **`shared/time.ts` 是北京时间工具**（`cnTimeToEpoch`/`cnTimeToText`/`cnTimeToShort`）——
  服务器在 UTC，**绝不能** `new Date('2026-09-25T09:00')`，会差 8 小时。
- **周期配置存 D1 `site_config['recruit']`**（刻意不放 runtime：runtime 是每个访客都会拉的公开配置，
  模板正文不该下发给所有人），无迁移。
  ⚠️ **2026-09-25 起「时间窗 / recruitPhase / site.recruitOpen」这套已整体作废** ——
  报名通道只由 `state === 'apply'` 决定（`isApplyOpen(state)`），整届状态与动作见上面「最终形态」一节。
  读 `site_config['recruit']` 时注意库里可能留着旧版本写下的键（applyStart / archives / …）：
  `mergeCycle` 现在逐字段取值并校验 `state`，不要把旧 JSON 直接铺开回显。
- **自动流程六个任务**（`/api/admin/recruit/auto` GET 预览 → POST 执行，`worker/lib/recruit-auto.ts`）：
  `confirm_written`（报名→笔试 + 笔试邀请）→ `mark_absent`（宽限期内未签到→absent）→
  `advance_written`（按前 N 名/分数线 → interview + 面试邀请 / failed + 感谢信）→
  `advance_interview`（勾选录取→defense + 面试通过通知 / 其余 failed + 感谢信）→
  `advance_defense`（勾选通过→onboard + 邀请函 / 其余 failed + 感谢信）→ `close_cycle`。
  后两个需要人工勾选名单，**未勾选的会被判为未通过并立刻发感谢信**，所以必须先预览。
  只按「目标状态」决定发哪封信 → 改判（failed→passed）不会误发。
- **Cron 兜底**（`wrangler.toml` `[triggers] crons = ["0 16 * * *"]` = 北京 0 点）→ `runRecruitScheduled()`：
  只做「缺考标记」与「到点关闭」，需要决策的一律不自动做。
- **关闭本届 = 先归档再清空**：未确认的记 absent → 导出 CSV 到对象存储 `applications/archives/` →
  存档信息追加进周期的 `archives` → 删报名表文件 → 清空 `applications` 与 `application_mails` → 写 `closedAt`。
- **签到 = 场次 + 凭证**（`migrations/0008_recruit_sessions.sql`）：`recruit_sessions` 一场一条
  （stage/name/starts_at/ends_at/place/note/sort_order）——**开放参加制**：邀请函列出全部场次、同学现场任选一场，
  不预排座位，也天然容纳临时来考的人；`recruit_checkin_tokens`（token 绑 `session_id` + `expires_at` + `revoked_at`，
  同一场次可重复签发、旧码一键作废）。签到页**只有** `/checkin/<token>`（`checkinTokenPath`），**没有裸入口**。
  `checkinEligibility()` 的 `ahead` 分支保留（人在考场不能因后台没点按钮签不了）。
  `applications` 增 `written_session_id`/`interview_session_id`/`defense_session_id`（签的哪一场，按场次统计到场）
  与 `source`（`web` 官网提交 / `manual` 管理员补录未报名考生）。
  ⚠️ **`QR_SIGN_SECRET` 是 SSO applyToken 验签密钥，不是签到二维码密钥**，别复用。
- 表 `applications` + `application_mails`（`0007_recruit_stages.sql`）+ `recruit_sessions`/`recruit_checkin_tokens`
  （`0008_recruit_sessions.sql`；0007 重建了 applications 并映射旧枚举）。已有库都要
  `d1 execute --file=` 单独跑，不能整体 `db:migrate`。报名表与存档都在对象存储 `applications/` 前缀（私有，
  `GET /api/files/*` 一律 404，唯一下载口 `GET /api/admin/applications/:id/file`）。
- 后台是**一个侧栏入口 `/admin/recruit` + 内部页签**（`src/admin/recruit/`）：
  看板 / 周期与签到 / 报名管理 / 成绩录入 / 自动流程 / 邮件模板 / 邮件日志；
  共用 `useRecruitSettings.ts`（**必须单独一个文件**，否则 react-refresh 规则会报错）与 `RecruitTabs.tsx`。
- 自检 `scripts/smoke-applications.ps1`（46 项全绿，会**备份并复原**你原有的周期配置）。

## 邮件（SMTP）
- 契约 `shared/mail.ts`；配置存 `site_config['runtime'].mail`。
- **密码存 D1**（2026-09-25 起，后台「邮件」页直接填）：`SESSION_SECRET` 经 HKDF 派生密钥做 AES-GCM 加密成 `enc$<iv>.<密文>`（`crypto.ts` 的 `encryptSecret`/`decryptSecret`）；`SMTP_PASSWORD` 仅兜底（库里优先）。**下发接口一律剥离密码**（`publicSmtpConfig()` + `config.ts` 的 `publicRuntimeConfig()`），后台只拿 `mailPasswordSource`（database/env/none）；保存三态：**不带 password 键=不改 / 空串=清除 / 有值=更新**（`admin-content.ts` 必须先摘掉提交上来的 mail 再 spread，否则明文进落库对象）。解密在 `resolveRuntimeConfig` 里做，**KV 缓存写的是密文版**。
- `worker/lib/smtp.ts`（cloudflare:sockets，465 TLS / 587 STARTTLS → startTls 后必须重建 reader/writer 再 EHLO）；`worker/lib/mailer.ts` MIME（RFC 2047 + Base64 折行）；`POST /api/admin/mail/test`（400=配置错 / 502=发送失败）。
- 25 端口被封；生产不能连 localhost/私有网段（本地 miniflare 可以）；`import { connect, type Socket } from 'cloudflare:sockets'` 会 TS2305（Socket 是全局类型）。

## 流量通道 / SSO
- 教务网 SSO：契约 `shared/sso.ts` + `worker/routes/sso.ts` + `worker/lib/student-auth.ts`；两套会话：`kc_admin`（12h）/ `kc_student`（30d）。开关与地址存 `runtime.sso`（后台维护），判定统一 `isSsoReady()`；回调失败 302 首页 `?login=<原因>`。授权服务器在另一仓库（EdgeOne），契约改动三方同步。
- 2026-09-24 起 RuntimeConfig **已删除 `join` 通道**（报名提交通道的「下一阶段预留」选项随对象存储管理页一起移除）：`ChannelTarget` 不再进 RuntimeConfig，`src/api/client.ts` 的 join 通道分流/灰度逻辑已删，所有请求同源。failover/rolloutPercent 字段保留兼容旧 JSON 但已无人消费。

## 前台其他约定
- `slides`：type='text'（kicker/title/subtitle/cta，showWhen）/ 'image'（只有图铺满）；`HERO_HEIGHT` 常量两种类型共用高度，控制器 `CarouselControls` 同一位置（用户明确要求过）。
- 顶部导航：首页/新闻/项目/成员/加入我们（无后台入口，页脚有管理链接）。
- 成员：`direction`=负责方向（在组）、`destination`=毕业去向（已毕业），showWhen 按 status 切换。
- 上传：`POST /api/admin/uploads`（魔数嗅探）；体积上限 `shared/resources.ts` UPLOAD_IMAGE_LIMITS（avatars 2MB / slides 50MB / 默认 2MB）。

## 已知坑
- `vite.config.ts` base 必须 `'/'`（后台多级路由，'./' 深层刷新 404）。
- wrangler 异常退出残留 workerd 占 8787：清理含 wrangler 的 node 进程 + workerd。
- 本机 3000/5173 被 IDE 服务长期占用，前端固定 5175 + strictPort。
- wrangler dev 只听 IPv4 127.0.0.1；用 `127.0.0.1:8787`。
- PowerShell 7 `Invoke-RestMethod -Form` 上传缺 name 会炸 formData；用 `curl.exe -F`。
- 路由支持 `*` 通配，捕获在 `ctx.params['*']`；`/api/files/*` 这类通配路由必须注册在更具体的 `/api/files/direct/:token` 之后。
- `npm run db:migrate:*` 会重跑全部 migrations（靠报错跳过）；已有数据的库只单独执行新增文件。
- `scripts/smoke-api.ps1` 异常中断会留下「冒烟测试工作室」配置，跑完到后台确认/手工还原。
