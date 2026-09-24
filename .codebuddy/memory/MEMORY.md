# kingcola（拾光工作室官网）· 长期记忆

## 项目定位
学生工作室官网 + 内部后台。前台只读，写操作收敛到 `/admin`。前后端同仓：Vite React + Cloudflare Workers（`run_worker_first = ["/api/*"]`）。

## 环境约定（本机）
- PATH 无 node/npm：`Import-Module D:\usexxx\use-xxx.psm1; use-node 22.23.2`（必须 22.23.2，Vite 7 要求）。
- npm registry `npm.mirrors.msh.team` 已失效：package-lock 里替换为 `https://registry.npmmirror.com/` 后 `npm install --registry=https://registry.npmmirror.com`。
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

## 招新报名（applications）
- 14 态状态机，契约在 `shared/recruit.ts`（`APPLICATION_STATUS_META` / TRANSITIONS / `noticeForStatus` / `validateApplicationForm` / 20MB / `APPLICATION_DOC_SCOPE='applications'`）；`member` 是唯一终态终态不可流转；改判不发邮件。
- 学生 `POST /api/applications`（multipart，auth:'student'）存 R2；`GET /api/files/*` 拦私有前缀，管理员唯一下载口 `GET /api/admin/applications/:id/file`（RFC 5987 中文文件名）。邀请函 `invited` 时签发 24 位 token + 14 天 TTL，`/invite/:token`（InviteSection）确认后 `createEntity(members)`。
- 状态流转只有 PUT 一个写口（改状态+写过程字段+发信原子）；返回 `{ application, mail }`。
- 后台 `src/admin/ApplicationsPage.tsx`；迁移 `migrations/0006_applications.sql`（已有库要 `d1 execute --file=` 单独跑）；自检 `scripts/smoke-applications.ps1`。

## 邮件（SMTP）
- 契约 `shared/mail.ts`；配置存 `site_config['runtime'].mail`；密码只走 env `SMTP_PASSWORD`（不落库）。
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
