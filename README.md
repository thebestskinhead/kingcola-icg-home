# 拾光工作室官网

学生工作室的对外门户 + 内部内容管理后台。

- **前台**：每个板块一个独立路径 —— 首页 `/` · 新闻动态 `/news`（详情 `/news/:id`）· 项目介绍 `/projects` ·
  团队成员 `/members` · 加入我们 `/join` · 邀请函确认 `/invite/:token` · 扫码签到 `/checkin/:token`
  （只读，数据来自后端接口；可直接输地址、刷新、分享链接）
- **后台**：`/admin`，单管理员登录。招新是一个完整模块（`/admin/recruit/*`：看板 · 准备 ·
  报名 · 笔试 · 面试 · 答辩 · 转正 · 名单 · 邮件模板 · 邮件日志 —— **按阶段组织**，
  每个阶段页上半是本阶段能做的操作、下半是该阶段名单），另有成员、项目、新闻、轮播、
  站点设置、对象存储与流量通道

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · TypeScript · Vite 7 · Tailwind CSS 3 · shadcn/ui |
| 后端 | Cloudflare Workers + Static Assets |
| 数据 | Cloudflare D1（唯一事实源）· KV（配置缓存）· R2（文件，预留） |
| 教务网登录 | 国内腾讯云 EdgeOne（授权服务器；主站只消费授权码，不接触教务网） |

前端与后端**同仓同部署**。`wrangler.toml` 里配置了 `run_worker_first = ["/api/*"]`，
静态资源由 Cloudflare 边缘直接返回，**不消耗 Worker 调用配额**，只有 API 请求才进 Worker。

## 目录结构

```
src/            前台页面 + /admin 后台
shared/         ★ 前后端共享契约（类型、资源字段表、登录契约、运行时配置）
worker/         Worker 后端（路由、认证、加密、D1 仓储）
migrations/     D1 建表 SQL
scripts/        端到端冒烟测试
docs/           交接文档
```

## 环境要求

- Node.js **22.12+**（Vite 7 要求；20.15 会告警）
- 首次部署需要 Cloudflare 账号

## 本地开发与测试

```bash
npm install
npm run db:migrate:local      # 首次执行：在本地 .wrangler/state 建表（按顺序执行 migrations/*.sql）
```

本地密钥放在 `.dev.vars`（已 gitignore），格式见文件内注释。

### 方式一：一条命令，和线上完全一致（**推荐用来做功能验收**）

```bash
npm run local                 # = npm run build && wrangler dev
```

浏览器打开 <http://127.0.0.1:8787>。
前端静态资源与 API **同源**，和线上 Workers + Static Assets 的形态一模一样，
适合完整测试 CMS、后台、报名流程。缺点是改了代码需要重新执行 `npm run local`。

### 方式二：两个终端，带热更新（适合改代码）

```bash
# 终端 A：本地后端（8787）
npm run dev:api

# 终端 B：前端（5175，/api 自动代理到 8787）
npm run dev
```

浏览器打开 <http://127.0.0.1:5175>。

> **端口说明**：本机 3000 与 5173 已被其它服务长期占用，因此前端固定用 **5175**，
> 并设置了 `strictPort: true` —— 端口被占时会直接报错，而不是悄悄换到别的端口让你访问到别的服务。

### 首次使用需要初始化管理员

本地 D1 是空的，需要先创建管理员账号（只会成功一次），并可选写入演示内容：

```bash
curl -X POST http://127.0.0.1:8787/api/admin/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"dev-recovery-token-please-change","username":"admin","password":"kingcola-dev-2026","seedContent":true}'
```

- `token` 取 `.dev.vars` 里的 `RECOVERY_TOKEN`（默认值见上方命令）
- 也可以登录后在「概览 → 写入演示数据」补内容
- 忘记密码时用同一条命令、不带 `seedContent` 即可重置

### 本地自检脚本

```bash
pwsh -NoProfile -File scripts/smoke-api.ps1    # 接口：认证 / 四类内容 CRUD / 站点设置 / 流量切换 / 教务网登录 / 审计
pwsh -NoProfile -File scripts/probe-local.ps1  # 页面：前台与后台深层路由、静态资源引用
```

> 含中文的 `.ps1` 必须用 `pwsh`（PowerShell 7）运行；Windows PowerShell 5.1 会因编码问题报语法错误。
> 两个脚本都会自行启动 `wrangler dev`、测完再关闭；它们**只会清理自己启动的进程**，
> 不会影响你用 `npm run local` 开着的服务。运行前请确认 8787 端口空闲。

## 部署

```bash
npx wrangler d1 create kingcola-db           # 把 database_id 填进 wrangler.toml
npx wrangler kv namespace create CONFIG_KV   # 把 id 填进 wrangler.toml
npm run db:migrate:remote

npx wrangler secret put SESSION_SECRET            # 管理员会话
npx wrangler secret put STUDENT_SESSION_SECRET    # 报名学生会话（与上面各自独立）
npx wrangler secret put RECOVERY_TOKEN
npx wrangler secret put QR_SIGN_SECRET            # 校验授权服务器签发的身份凭证
npx wrangler secret put SSO_CLIENT_SECRET         # 与授权服务器约定的客户端密钥

npm run deploy
```

完整步骤与交接事项见 [`docs/HANDOVER.md`](docs/HANDOVER.md)。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 前端开发服务器（3000） |
| `npm run dev:api` | Worker 本地运行（8787） |
| `npm run build` | 类型检查 + 构建前端 |
| `npm run deploy` | 构建并部署到 Cloudflare |
| `npm run typecheck` | 只做类型检查（前端 + Worker） |
| `npm run db:migrate:local` / `:remote` | 按顺序执行 `migrations/*.sql`（重复执行已应用的文件会报错，可忽略） |
| `pwsh -File scripts/smoke-api.ps1` | 内容 / 设置 / 认证 端到端自检 |
| `pwsh -File scripts/smoke-applications.ps1` | 招新报名链路自检（状态机、替换与补录、通知邮件、报名表隐私） |
| `pwsh -File scripts/smoke-sessions.ps1` | 考试场次与签到二维码自检（凭证签发 / 作废 / 删场次） |

## 设计要点

- **一份元数据驱动两端**：`shared/resources.ts` 描述每个内容类型的字段，
  Worker 据此生成 SQL 与校验，后台据此渲染表格与表单。新增内容类型只需改这一处。
  字段还支持 `showWhen`（按另一字段取值条件显示，如成员「在组只填负责方向、已毕业只填毕业去向」）
  与 `scope`（上传目录）等声明式配置。
- **官网没有任何写死的文案**：工作室名称、Logo、简介、联系方式、页脚、招新文案全部来自 D1
  的 `site_config`，后台「系统设置」分页签维护；前后台共用 `shared/types.ts` 的 `SiteConfig`
  与 `shared/site.ts` 的解析规则（列表类文案的格式约定都收在这里）。新增字段**不需要数据库迁移**。
- **招新是一个覆盖整届的模块**：状态用「阶段 + 该阶段结果」两列描述（报名/笔试/面试/答辩/转正 ×
  待定/已参加/通过/未通过/未参加/婉拒/退出），规则集中在 `shared/recruit.ts`，后台会拒绝跳阶段。
  一届的时间窗填在后台，到点自动开放报名、全部确认或到期自动关闭并**先归档 CSV 再清空数据**。
  笔试 / 面试 / 答辩支持**多个场次**（开放参加制，邀请函列出全部场次任选一场），
  签到二维码是带凭证的签到链接（绑场次、带失效时间、可作废），前端 `qrcode.react` 渲染。
  同一学号重复提交会**替换材料并删除旧文件**（文件统一重命名为「姓名+学号+报名表」），
  确认笔试名单后材料锁死；未报名但来考的人由管理员在报名阶段页补录。
  「自动流程」页把每个批量动作都做成**先看名单、确认后执行**：确认笔试名单 → 标记缺考 →
  按成绩生成面试名单 → 确认录取 → 确认答辩 → 关闭本届，全程按模板发出 7 条通知邮件。
  报名表与存档落在对象存储的 `applications/` 前缀下，**只有管理员会话能下载**（含学号姓名，匿名一律 404）。
  考场贴签到二维码，同学填「姓名 + 学号」即签到；答辩通过后凭邮件里的一次性链接
  `/invite/:token` 确认，后端当场写入成员表。
- **响应统一信封**：所有接口返回 `{ ok: true, data }` 或 `{ ok: false, error }`。
- **运行时流量切换**：`/api/config/runtime` 下发通道配置，报名相关接口按它选择
  Cloudflare 本站或国内 EdgeOne，主通道失败可自动切换备用通道，无需重新部署。
- **教务网登录走授权码模式**：官网不接触教务网，跳转到国内授权服务器完成认证与授权，
  回调时用授权码换回身份、验签后再种下自己的会话。管理员与报名同学两套会话各自独立，
  换密钥或登出互不影响。
- **管理员账号存 D1**：不绑定个人云账号，换届时下一届可自行改密码，
  配合 `RECOVERY_TOKEN` 做灾备找回。
