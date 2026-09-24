# ============================================================================
# 招新报名链路自检（需要本地服务已在 8787 运行：npm run local / npm run dev:api）
#
# 覆盖：
#   1) 报名学生会话 → 提交报名表（multipart + 文件头校验 + 落 R2 + 落库）
#   2) 重复提交、伪造文件、字段非法等拒绝路径
#   3) 报名表私有性：匿名与学生本人都拿不到，只有管理员能下载
#   4) 状态机全流程：submitted → 笔试 → 面试 → 预备期 → 邀请函 → 转正写成员表
#   5) 非法流转被拒、邮件触发（当前 SMTP 为空实现，结果码如实返回）
#   6) 后台下载报名表、删除记录并清理 R2
#
# 含中文，必须用 pwsh（PowerShell 7）运行：
#   pwsh -NoProfile -File scripts/smoke-applications.ps1
# ============================================================================

param([string]$Base = 'http://127.0.0.1:8787')

$ErrorActionPreference = 'Stop'
$script:passed = 0
$script:failed = 0

function Check([string]$label, [bool]$ok, [string]$extra = '') {
    if ($ok) {
        $script:passed++
        Write-Host "  [PASS] $label" -ForegroundColor Green
    }
    else {
        $script:failed++
        Write-Host "  [FAIL] $label  $extra" -ForegroundColor Red
    }
}

# 管理员用 cookie jar（-b），学生用现造的 Token（Cookie 头）—— 两者互不影响
function Api([string]$method, [string]$path, $body = $null, [string]$jar = '', [string]$cookie = '') {
    $cargs = @('-s', '-X', $method, "$Base$path", '-H', 'content-type: application/json')
    if ($jar) { $cargs += @('-b', $jar) }
    if ($cookie) { $cargs += @('-H', "Cookie: $cookie") }
    if ($null -ne $body) { $cargs += @('--data-raw', ($body | ConvertTo-Json -Depth 6 -Compress)) }
    $raw = & curl.exe @cargs
    try { return $raw | ConvertFrom-Json } catch { return [pscustomobject]@{ ok = $false; raw = $raw } }
}

function RawStatus([string]$method, [string]$path, [string]$jar = '', [string]$cookie = '') {
    $cargs = @('-s', '-o', 'NUL', '-w', '%{http_code}', '-X', $method, "$Base$path")
    if ($jar) { $cargs += @('-b', $jar) }
    if ($cookie) { $cargs += @('-H', "Cookie: $cookie") }
    return (& curl.exe @cargs)
}

# 报名学生会话令牌：与 worker/lib/crypto.ts 的 signToken 同构（base64url(json).base64url(hmac)）
function New-StudentToken([string]$secret, [string]$studentId, [string]$name) {
    $exp = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600
    $json = @{ sub = $studentId; name = $name; sid = 'smoke-cli'; exp = $exp } | ConvertTo-Json -Compress
    $body = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    $h = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
    $sig = [Convert]::ToBase64String($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    return "$body.$sig"
}

# ---- 准备：密钥、临时文件 ----
$devVars = Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) '.dev.vars') -Encoding UTF8
$studentSecret = ($devVars | Where-Object { $_ -match '^STUDENT_SESSION_SECRET=' }) -replace '^STUDENT_SESSION_SECRET=', ''
$studentId = 'SMOKE' + (Get-Random -Minimum 100000 -Maximum 999999)
$studentCookie = 'kc_student=' + (New-StudentToken $studentSecret $studentId '冒烟同学')

$work = Join-Path $env:TEMP ("kc-apply-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$jar = Join-Path $work 'admin.jar'
$pdfPath = Join-Path $work 'report.pdf'
[IO.File]::WriteAllBytes($pdfPath, [byte[]](0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0x25, 0x45, 0x4F, 0x46))
$fakePdf = Join-Path $work 'fake.pdf'
[IO.File]::WriteAllText($fakePdf, 'this is not a real pdf')

Write-Host "招新报名自检 → $Base`n" -ForegroundColor Cyan

$appId = ''
$memberId = ''
$recruitWasOpen = $null

try {
    # ===== 0. 服务与报名开关 =====
    Write-Host '0) 服务与报名开关'
    $health = Api 'GET' '/api/health'
    Check '健康检查可用' ($health.ok -eq $true)

    $site = (Api 'GET' '/api/public/site-config').data
    $recruitWasOpen = [bool]$site.recruitOpen

    # ===== 1. 管理员登录 =====
    Write-Host "`n1) 管理员登录"
    & curl.exe -s -c $jar -o NUL -X POST "$Base/api/admin/login" -H 'content-type: application/json' --data-raw '{"username":"admin","password":"kingcola-dev-2026"}'
    Check '管理员登录成功' ((RawStatus 'GET' '/api/admin/me' $jar) -eq '200')

    if (-not $recruitWasOpen) {
        Write-Host '   报名通道当前关闭，临时打开（结束时还原）' -ForegroundColor Yellow
        $null = Api 'PUT' '/api/admin/config' @{ site = @{ recruitOpen = $true } } $jar
    }

    # ===== 2. 学生会话与未登录拦截 =====
    Write-Host "`n2) 学生会话"
    Check '未登录访问 /api/applications/me 返回 401' ((RawStatus 'GET' '/api/applications/me') -eq '401')
    $me = Api 'GET' '/api/applications/me' $null '' $studentCookie
    Check '登录后 /api/applications/me 返回 200 且无报名记录' ($me.ok -eq $true -and $null -eq $me.data.application)

    # ===== 3. 提交报名表 =====
    Write-Host "`n3) 提交报名表"
    Check '伪造 PDF（改后缀）被拒 415' ((& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/applications" -H "Cookie: $studentCookie" -F "file=@$fakePdf;type=application/pdf" -F 'email=a@b.com' -F 'phone=13800000000' -F 'qq=123456') -eq '415')
    Check '手机号不合法被拒 400' ((& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/applications" -H "Cookie: $studentCookie" -F "file=@$pdfPath;type=application/pdf" -F 'email=a@b.com' -F 'phone=123' -F 'qq=123456') -eq '400')
    Check '缺少 QQ 号被拒 400' ((& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/applications" -H "Cookie: $studentCookie" -F "file=@$pdfPath;type=application/pdf" -F 'email=a@b.com' -F 'phone=13800000000') -eq '400')

    $submitRaw = & curl.exe -s -X POST "$Base/api/applications" -H "Cookie: $studentCookie" -F "file=@$pdfPath;type=application/pdf" -F 'email=smoke@example.edu.cn' -F 'phone=13800000000' -F 'qq=123456'
    $submit = $submitRaw | ConvertFrom-Json
    Check '正常提交成功并返回 submitted' ($submit.ok -eq $true -and $submit.data.status -eq 'submitted') $submitRaw
    $appId = $submit.data.id
    Check '学号 / 姓名取自会话' ($submit.data.studentId -eq $studentId -and $submit.data.name -eq '冒烟同学')
    Check '响应不包含内部字段（成绩 / 评语 / 备注）' ($submit.data.writtenScore -eq '' -and $submit.data.interviewNote -eq '' -and $submit.data.note -eq '')

    Check '重复提交被拒 409' ((& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/applications" -H "Cookie: $studentCookie" -F "file=@$pdfPath;type=application/pdf" -F 'email=smoke@example.edu.cn' -F 'phone=13800000000' -F 'qq=123456') -eq '409')

    # ===== 4. 报名表私有性 =====
    Write-Host "`n4) 报名表私有性"
    $fileKey = ($submit.data.fileUrl -replace '^/api/files/', '')
    Check '匿名访问报名表 404（不外泄）' ((RawStatus 'GET' "/api/files/$fileKey") -eq '404')
    Check '学生本人也不能直接下载 404' ((RawStatus 'GET' "/api/files/$fileKey" '' $studentCookie) -eq '404')
    Check '管理员可读同一路径 200' ((RawStatus 'GET' "/api/files/$fileKey" $jar) -eq '200')
    $disposition = & curl.exe -s -o NUL -D - -X GET "$Base/api/admin/applications/$appId/file" -b $jar
    Check '管理员专用下载接口带原始文件名' (($disposition -join "`n") -match 'filename\*=UTF-8')

    # ===== 5. 后台列表与筛选 =====
    Write-Host "`n5) 后台列表"
    $list = Api 'GET' "/api/admin/applications?q=$studentId" $null $jar
    Check '按学号搜到 1 条' ($list.ok -eq $true -and $list.data.total -eq 1) ($list | ConvertTo-Json -Depth 4 -Compress)
    Check '返回各状态计数' ($list.data.counts.submitted -ge 1)
    Check '返回邀请链接字段（未签发时为空）' ($list.data.items[0].inviteUrl -eq '')

    # ===== 6. 状态机 =====
    Write-Host "`n6) 状态机"
    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'interview_passed' } $jar
    Check '跨阶段跳转被拒（submitted → interview_passed）' ($r.ok -eq $false -and $r.error.code -eq 'INVALID_TRANSITION') ($r | ConvertTo-Json -Compress)
    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'nope' } $jar
    Check '未知状态被拒' ($r.ok -eq $false -and $r.error.code -eq 'INVALID_STATUS')

    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'written_scheduled'; writtenAt = '2026-10-08T14:00'; writtenNote = '实验楼 B203 机房' } $jar
    Check 'submitted → written_scheduled' ($r.ok -eq $true -and $r.data.application.status -eq 'written_scheduled')
    # 邮件默认关闭：发信失败不影响状态流转，只如实回报原因码
    Check '触发笔试邀请并如实回报邮件结果' ($null -ne $r.data.mail -and $r.data.mail.kind -eq 'written_invite' -and $r.data.mail.sent -eq $false -and $r.data.mail.code -eq 'NOT_CONFIGURED') ($r.data.mail | ConvertTo-Json -Compress)

    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'written_failed'; writtenScore = '42' } $jar
    Check 'written_scheduled → written_failed' ($r.ok -eq $true -and $r.data.application.status -eq 'written_failed')
    Check '触发感谢信（笔试）' ($r.data.mail.kind -eq 'thanks_written')

    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'written_passed' } $jar
    Check '未通过可改判为通过' ($r.ok -eq $true -and $r.data.application.status -eq 'written_passed')
    Check '改判不发邮件（避免误发邀请）' ($null -eq $r.data.mail)

    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'interview_scheduled'; interviewAt = '2026-10-12T19:00'; interviewNote = '实验楼 B203 会议室' } $jar
    Check 'written_passed → interview_scheduled' ($r.ok -eq $true -and $r.data.mail.kind -eq 'interview_invite')

    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'interview_passed' } $jar
    Check 'interview_scheduled → interview_passed' ($r.ok -eq $true)

    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'probation'; probationNote = '参与官网改版' } $jar
    Check 'interview_passed → probation' ($r.ok -eq $true)

    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'invited' } $jar
    Check 'probation → invited 并签发邀请凭证' ($r.ok -eq $true -and $r.data.application.inviteUrl -like '*/invite/*') ($r.data.application.inviteUrl)
    $token = ($r.data.application.inviteUrl -split '/invite/')[-1]

    $r = Api 'PUT' "/api/admin/applications/$appId" @{ status = 'invited'; notice = 'offer' } $jar
    Check '可对已发出的邀请函补发邮件（notice=offer）' ($r.ok -eq $true -and $r.data.mail.kind -eq 'offer')

    # ===== 7. 邀请函确认 → 写入成员表 =====
    Write-Host "`n7) 邀请函确认"
    $invite = Api 'GET' "/api/applications/invite/$token"
    Check '邀请函可匿名打开（凭证即密权）' ($invite.ok -eq $true -and $invite.data.name -eq '冒烟同学')
    Check '未知凭证 404' ((RawStatus 'GET' '/api/applications/invite/not-a-real-token') -eq '404')

    $confirm = Api 'POST' "/api/applications/invite/$token" @{ title = '前端开发'; direction = 'Web 前端'; bio = '冒烟测试账号' }
    Check '确认加入成功并返回成员 id' ($confirm.ok -eq $true -and [bool]$confirm.data.memberId) ($confirm | ConvertTo-Json -Compress)
    $memberId = [string]$confirm.data.memberId

    $again = Api 'POST' "/api/applications/invite/$token" @{ title = '前端开发' }
    Check '同一链接不能重复确认 409' ($again.ok -eq $false)
    Check '学生端进度已变为 member' ((Api 'GET' '/api/applications/me' $null '' $studentCookie).data.application.status -eq 'member')

    # 公开内容接口直接返回数组（不是 {items}）
    $members = Api 'GET' '/api/public/content/members'
    Check '成员表已出现该同学（前台已可见）' (($members.data | Where-Object { $_.id -eq $memberId }).Count -eq 1)
    Check '正式成员为终态，不可再流转' ((Api 'PUT' "/api/admin/applications/$appId" @{ status = 'submitted' } $jar).error.code -eq 'INVALID_TRANSITION')

    # ===== 8. 清理 =====
    Write-Host "`n8) 清理"
    Check '删除成员记录' ((Api 'DELETE' "/api/admin/content/members/$memberId" $null $jar).ok -eq $true)
    Check '删除报名记录' ((Api 'DELETE' "/api/admin/applications/$appId" $null $jar).ok -eq $true)
    Check '记录已删除（列表查不到）' ((Api 'GET' "/api/admin/applications?q=$studentId" $null $jar).data.total -eq 0)
    Check '报名表 R2 文件已一并清理' ((RawStatus 'GET' "/api/files/$fileKey" $jar) -eq '404')
}
finally {
    if ($recruitWasOpen -eq $false) {
        $null = Api 'PUT' '/api/admin/config' @{ site = @{ recruitOpen = $false } } $jar
        Write-Host '  已还原报名通道为关闭' -ForegroundColor Yellow
    }
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($script:failed -eq 0) {
    Write-Host "全部通过（$script:passed 项）" -ForegroundColor Green
    exit 0
}
Write-Host "$script:failed 项失败 / 共 $($script:passed + $script:failed) 项" -ForegroundColor Red
exit 1
