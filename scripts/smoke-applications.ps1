# ============================================================================
# 招新系统自检（需要本地服务已在 8787 运行：npm run local / npm run dev:api）
#
# 覆盖：
#   1) 周期配置：时间窗决定报名通道开闭（未开始 / 报名中 / 已结束）
#   2) 学生提交报名表（multipart + 文件头校验 + 落对象存储 + 落库）
#   3) 报名表私有性：匿名与学生本人都拿不到，只有管理员能下载
#   4) 扫码签到：先建场次 → 签发二维码 → 凭 token 签到，签到后状态变「已参加」并记下签的哪一场
#   5) 自动流程（预览 → 执行）：缺考标记、按成绩生成面试名单、
#      面试录取、答辩通过 → 每一步都验证状态与发信日志
#   6) 邀请函确认 → 写入成员表
#   7) 名单导出、看板统计、关闭本届（导出存档 → 清空数据 → 归档）
#
# 脚本会**先备份再复原**招新周期配置，跑完不会把你的线上设置改掉。
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

function Api([string]$method, [string]$path, $body = $null, [string]$jar = '', [string]$cookie = '') {
    $cargs = @('-s', '-X', $method, "$Base$path", '-H', 'content-type: application/json')
    if ($jar) { $cargs += @('-b', $jar) }
    if ($cookie) { $cargs += @('-H', "Cookie: $cookie") }
    if ($null -ne $body) { $cargs += @('--data-raw', ($body | ConvertTo-Json -Depth 8 -Compress)) }
    $raw = & curl.exe @cargs
    try { return $raw | ConvertFrom-Json } catch { return [pscustomobject]@{ ok = $false; raw = $raw } }
}

function RawStatus([string]$method, [string]$path, [string]$jar = '', [string]$cookie = '') {
    $cargs = @('-s', '-o', 'NUL', '-w', '%{http_code}', '-X', $method, "$Base$path")
    if ($jar) { $cargs += @('-b', $jar) }
    if ($cookie) { $cargs += @('-H', "Cookie: $cookie") }
    return (& curl.exe @cargs)
}

# 报名学生会话令牌：与 worker/lib/crypto.ts 的 signToken 同构
function New-StudentToken([string]$secret, [string]$studentId, [string]$name) {
    $exp = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600
    $json = @{ sub = $studentId; name = $name; sid = 'smoke-cli'; exp = $exp } | ConvertTo-Json -Compress
    $body = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    $h = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
    $sig = [Convert]::ToBase64String($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    return "$body.$sig"
}

# 北京时间字符串（脚本里所有时间窗都按这个口径给）
function Cn([int]$addMinutes) {
    $t = (Get-Date).ToUniversalTime().AddMinutes($addMinutes + 480)
    return $t.ToString('yyyy-MM-ddTHH:mm')
}

# ---- 准备 ----
$root = Split-Path -Parent $PSScriptRoot
$devVars = Get-Content (Join-Path $root '.dev.vars') -Encoding UTF8
$studentSecret = ($devVars | Where-Object { $_ -match '^STUDENT_SESSION_SECRET=' }) -replace '^STUDENT_SESSION_SECRET=', ''

$work = Join-Path $env:TEMP ("kc-recruit-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$jar = Join-Path $work 'admin.jar'
$pdfPath = Join-Path $work 'report.pdf'
[IO.File]::WriteAllBytes($pdfPath, [byte[]](0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0x25, 0x45, 0x4F, 0x46))

$stamp = Get-Random -Minimum 100000 -Maximum 999999
$students = @(
    @{ key = 'a'; id = "SMA$stamp"; name = '冒烟甲'; score = '90'; token = '' },
    @{ key = 'b'; id = "SMB$stamp"; name = '冒烟乙'; score = '40'; token = '' },
    @{ key = 'c'; id = "SMC$stamp"; name = '冒烟丙'; score = ''; token = '' }
)
foreach ($s in $students) {
    $s.token = 'kc_student=' + (New-StudentToken $studentSecret $s.id $s.name)
}

$appIds = @{}
$inviteUrl = ''
$sessId = ''
$originalCycle = $null

Write-Host "招新系统自检 → $Base`n" -ForegroundColor Cyan
Write-Host "测试学号：$($students.id -join ' / ')`n" -ForegroundColor DarkGray

try {
    # ===== 0. 服务与管理员登录 =====
    Write-Host '0) 服务与登录'
    Check '健康检查可用' ((Api 'GET' '/api/health').ok -eq $true)
    & curl.exe -s -c $jar -o NUL -X POST "$Base/api/admin/login" -H 'content-type: application/json' --data-raw '{"username":"admin","password":"kingcola-dev-2026"}'
    Check '管理员登录成功' ((RawStatus 'GET' '/api/admin/me' $jar) -eq '200')

    $originalCycle = (Api 'GET' '/api/admin/recruit' $null $jar).data.cycle

    # ===== 1. 周期：未开始时报名通道关闭 =====
    Write-Host "`n1) 招新周期"
    $null = Api 'PUT' '/api/admin/recruit' @{ cycle = @{
        name = '冒烟测试招新'
        applyStart = (Cn 120); applyEnd = (Cn 180)
        writtenAt = (Cn 240); writtenEnd = (Cn 300)
        absentGraceHours = 0; advanceRule = 'top'; advanceTop = 1
        interviewAt = (Cn 360); defenseStart = (Cn 480); defenseEnd = (Cn 3000); onboardDeadline = (Cn 4000)
        forceClosed = $false; closedAt = ''
    } } $jar
    $status = (Api 'GET' '/api/public/recruit').data
    Check '未到开始时间 → phase=upcoming 且报名关闭' ($status.phase -eq 'upcoming' -and $status.applyOpen -eq $false) $status.phase
    Check '未开始时不接受报名（403）' ((& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/applications" -H "Cookie: $($students[0].token)" -F "file=@$pdfPath;type=application/pdf" -F 'email=a@b.com' -F 'phone=13800000000' -F 'qq=123456') -eq '403')

    # 切到「报名进行中」
    $null = Api 'PUT' '/api/admin/recruit' @{ cycle = @{ applyStart = (Cn -60); applyEnd = (Cn 60); writtenEnd = (Cn -30) } } $jar
    $status = (Api 'GET' '/api/public/recruit').data
    Check '进入报名窗口 → phase=applying 且报名开放' ($status.phase -eq 'applying' -and $status.applyOpen -eq $true) $status.phase

    # ===== 2. 提交报名表 =====
    Write-Host "`n2) 提交报名表"
    $badFile = Join-Path $work 'fake.pdf'
    [IO.File]::WriteAllText($badFile, 'not a real pdf')
    Check '伪造 PDF 被拒 415' ((& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/applications" -H "Cookie: $($students[0].token)" -F "file=@$badFile;type=application/pdf" -F 'email=a@b.com' -F 'phone=13800000000' -F 'qq=123456') -eq '415')

    foreach ($s in $students) {
        $raw = & curl.exe -s -X POST "$Base/api/applications" -H "Cookie: $($s.token)" -F "file=@$pdfPath;type=application/pdf" -F "email=$($s.id.ToLower())@example.edu.cn" -F 'phone=13800000000' -F 'qq=123456'
        $created = $raw | ConvertFrom-Json
        Check "$($s.name) 提交成功且 stage=apply/result 空" ($created.ok -eq $true -and $created.data.stage -eq 'apply' -and $created.data.result -eq '') $raw
        $appIds[$s.key] = $created.data.id
    }
    Check '重复提交被拒 409' ((& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/applications" -H "Cookie: $($students[0].token)" -F "file=@$pdfPath;type=application/pdf" -F 'email=x@b.com' -F 'phone=13800000000' -F 'qq=123456') -eq '409')

    # ===== 3. 报名表私有性 =====
    Write-Host "`n3) 报名表私有性"
    $detailA = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data
    $fileKey = ($detailA.application.fileUrl -replace '^/api/files/', '')
    Check '匿名访问报名表 404' ((RawStatus 'GET' "/api/files/$fileKey") -eq '404')
    Check '学生本人也拿不到 404' ((RawStatus 'GET' "/api/files/$fileKey" '' $students[0].token) -eq '404')
    Check '管理员专用下载口带原始文件名' (((& curl.exe -s -o NUL -D - "$Base/api/admin/applications/$($appIds['a'])/file" -b $jar) -join "`n") -match 'filename\*=UTF-8')

    # ===== 3.5 确认笔试名单（发笔试邀请函） =====
    Write-Host "`n3.5) 确认笔试名单"
    $preview = (Api 'GET' '/api/admin/recruit/auto?task=confirm_written' $null $jar).data
    Check '预览列出三位待确认的同学并会发笔试邀请' (
        $preview.items.Count -eq 3 -and ($preview.items | Where-Object { $_.mail -ne 'written_invite' }).Count -eq 0
    ) ($preview | ConvertTo-Json -Compress)
    $run = Api 'POST' '/api/admin/recruit/auto' @{ task = 'confirm_written' } $jar
    Check '执行后全部进入笔试阶段' ($run.ok -eq $true -and $run.data.moved -eq 3)
    $aNow = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    Check '甲已进入笔试阶段' ($aNow.stage -eq 'written' -and $aNow.result -eq '') "$($aNow.stage)/$($aNow.result)"

    # ===== 4. 扫码签到（凭证 = 场次二维码） =====
    Write-Host "`n4) 扫码签到"
    # 场次时间刻意放在过去：它会反写周期的 writtenEnd，而下一步的「缺考标记」正依赖它已经过点
    $sess = (Api 'POST' '/api/admin/recruit/sessions' @{
        stage = 'written'; name = '自检场次'; startsAt = (Cn -120); endsAt = (Cn -60); place = '自检教室'
    } $jar).data.session
    $sessId = $sess.id
    $code = (Api 'POST' "/api/admin/recruit/sessions/$sessId/checkin-token" @{} $jar).data
    Check '二维码指向 /checkin/<token>' ($code.url -match ('/checkin/' + $code.token + '$')) $code.url
    Check '老的裸签到接口已下线（404）' (
        (& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/applications/checkin" -H 'content-type: application/json' --data-raw '{"stage":"written","name":"x","studentId":"y"}') -eq '404'
    )

    foreach ($key in @('a', 'b')) {
        $s = $students | Where-Object { $_.key -eq $key }
        $result = Api 'POST' "/api/applications/checkin/$($code.token)" @{ name = $s.name; studentId = $s.id }
        Check "$($s.name) 签到成功并转为「已参加」" ($result.ok -eq $true -and $result.data.already -eq $false)
    }
    $again = Api 'POST' "/api/applications/checkin/$($code.token)" @{ name = $students[0].name; studentId = $students[0].id }
    Check '重复签到提示已签到' ($again.ok -eq $true -and $again.data.already -eq $true)
    $wrongName = Api 'POST' "/api/applications/checkin/$($code.token)" @{ name = '张三'; studentId = $students[0].id }
    Check '姓名不符被拒（NAME_MISMATCH）' ($wrongName.ok -eq $false -and $wrongName.error.code -eq 'NAME_MISMATCH')
    $afterCheckin = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    Check '签到后 result=attended' ($afterCheckin.result -eq 'attended') $afterCheckin.result
    Check '签到记下了签的是哪一场' ($afterCheckin.writtenSessionId -eq $sessId) $afterCheckin.writtenSessionId

    # ===== 5. 缺考自动标记 =====
    Write-Host "`n5) 缺考标记（自动流程）"
    $preview = (Api 'GET' '/api/admin/recruit/auto?task=mark_absent' $null $jar).data
    Check '预览只列出未签到的丙' ($preview.items.Count -eq 1 -and $preview.items[0].studentId -eq $students[2].id) ($preview | ConvertTo-Json -Compress)
    $run = Api 'POST' '/api/admin/recruit/auto' @{ task = 'mark_absent' } $jar
    Check '执行后丙被标记未参加' ($run.ok -eq $true -and $run.data.moved -eq 1)
    $cDetail = (Api 'GET' "/api/admin/applications/$($appIds['c'])" $null $jar).data.application
    Check '丙的结果为 absent' ($cDetail.result -eq 'absent') $cDetail.result

    # ===== 6. 录入成绩并生成面试名单 =====
    Write-Host "`n6) 成绩 → 面试名单"
    foreach ($key in @('a', 'b')) {
        $s = $students | Where-Object { $_.key -eq $key }
        $null = Api 'PUT' "/api/admin/applications/$($appIds[$key])" @{ writtenScore = $s.score } $jar
    }
    $preview = (Api 'GET' '/api/admin/recruit/auto?task=advance_written' $null $jar).data
    $passItem = $preview.items | Where-Object { $_.applicationId -eq $appIds['a'] }
    $failItem = $preview.items | Where-Object { $_.applicationId -eq $appIds['b'] }
    Check '按前 1 名：甲进入面试并发面试邀请' ($passItem.targetStage -eq 'interview' -and $passItem.mail -eq 'interview_invite') ($preview | ConvertTo-Json -Compress)
    Check '未晋级的乙发感谢信' ($failItem.targetResult -eq 'failed' -and $failItem.mail -eq 'thanks_written')

    $run = Api 'POST' '/api/admin/recruit/auto' @{ task = 'advance_written' } $jar
    Check '执行成功且报告发信结果' ($run.ok -eq $true -and $run.data.moved -eq 2) ($run.data.mail | ConvertTo-Json -Compress)
    $aNow = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    Check '甲进入面试阶段' ($aNow.stage -eq 'interview' -and $aNow.result -eq '') "$($aNow.stage)/$($aNow.result)"

    # ===== 7. 面试录取 → 预备期 =====
    Write-Host "`n7) 面试录取"
    $preview = (Api 'GET' "/api/admin/recruit/auto?task=advance_interview&selected=$($appIds['a'])" $null $jar).data
    Check '勾选甲 → 进入预备期并发面试通过通知' (
        ($preview.items | Where-Object { $_.applicationId -eq $appIds['a'] }).mail -eq 'interview_passed'
    ) ($preview | ConvertTo-Json -Compress)
    $run = Api 'POST' '/api/admin/recruit/auto' @{ task = 'advance_interview'; selectedIds = @($appIds['a']) } $jar
    Check '面试录取执行成功' ($run.ok -eq $true)
    $aNow = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    Check '甲进入答辩（预备期）阶段' ($aNow.stage -eq 'defense') $aNow.stage

    # ===== 8. 答辩通过 → 转正 + 邀请函 =====
    Write-Host "`n8) 答辩通过转正"
    $run = Api 'POST' '/api/admin/recruit/auto' @{ task = 'advance_defense'; selectedIds = @($appIds['a']) } $jar
    Check '答辩通过执行成功' ($run.ok -eq $true) ($run | ConvertTo-Json -Depth 4 -Compress)
    $aNow = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    Check '甲进入转正阶段并签发邀请函' ($aNow.stage -eq 'onboard' -and $aNow.inviteUrl -like '*/invite/*') $aNow.inviteUrl
    $inviteUrl = $aNow.inviteUrl
    $token = ($inviteUrl -split '/invite/')[-1]

    # ===== 9. 邀请函确认 → 成员表 =====
    Write-Host "`n9) 邀请函确认"
    $invite = (Api 'GET' "/api/applications/invite/$token").data
    Check '邀请函可匿名打开' ($invite.alreadyMember -eq $false -and $invite.name -eq $students[0].name)
    $confirm = Api 'POST' "/api/applications/invite/$token" @{ title = '前端开发'; direction = 'Web 前端'; bio = '冒烟测试账号' }
    Check '确认加入成功并返回成员 id' ($confirm.ok -eq $true -and [bool]$confirm.data.memberId)
    $memberId = [string]$confirm.data.memberId
    Check '同一链接不能重复确认' ((Api 'POST' "/api/applications/invite/$token" @{ title = '前端开发' }).ok -eq $false)
    $aNow = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    Check '甲成为正式成员' ($aNow.stage -eq 'onboard' -and $aNow.result -eq 'passed' -and $aNow.memberId -eq $memberId)

    # ===== 10. 看板 / 导出 / 发信日志 =====
    Write-Host "`n10) 看板、导出与日志"
    $board = (Api 'GET' '/api/admin/recruit/board' $null $jar).data
    Check '看板：3 人报名、1 人转正' ($board.total -eq 3 -and $board.members -eq 1) ($board | ConvertTo-Json -Compress)
    # funnel 只统计「未结束」的记录：已转正属于终态，所以不在池里，但在状态细分里
    Check '看板：状态细分里有 1 位正式成员' ($board.byLabel.'正式成员' -eq 1) ($board.byLabel | ConvertTo-Json -Compress)
    $csv = & curl.exe -s "$Base/api/admin/recruit/export" -b $jar
    Check '导出 CSV 含三位同学与表头' ($csv -match '姓名' -and $csv -match $students[0].name -and $csv -match $students[2].name)
    $mails = (Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs
    Check '发信日志记录了各阶段通知' (
        ($mails | Where-Object { $_.kind -eq 'interview_invite' }).Count -ge 1 -and
        ($mails | Where-Object { $_.kind -eq 'thanks_written' }).Count -ge 1 -and
        ($mails | Where-Object { $_.kind -eq 'offer' }).Count -ge 1
    )

    # ===== 11. 关闭本届 =====
    Write-Host "`n11) 关闭本届"
    $run = Api 'POST' '/api/admin/recruit/auto' @{ task = 'close_cycle'; force = $true } $jar
    Check '关闭成功并生成存档' ($run.ok -eq $true -and $run.data.archive.url -like '/api/files/*') ($run.data | ConvertTo-Json -Depth 3 -Compress)
    $board = (Api 'GET' '/api/admin/recruit/board' $null $jar).data
    Check '关闭后报名数据已清空' ($board.total -eq 0) "$($board.total)"
    Check '关闭后邀请函链接失效' ((Api 'GET' "/api/applications/invite/$token" $null $null).ok -eq $false)
    Check '关闭后学生端进度页显示未报名' ((Api 'GET' '/api/applications/me' $null '' $students[0].token).data.application -eq $null)
    $status = (Api 'GET' '/api/public/recruit').data
    Check '关闭后报名通道关闭（phase=closed）' ($status.phase -eq 'closed' -and $status.applyOpen -eq $false) $status.phase

    # 清理成员表里这位同学
    $null = Api 'DELETE' "/api/admin/content/members/$memberId" $null $jar
}
finally {
    # 先删掉自检造的场次（场次变化会反写周期里的笔试时间），再复原周期配置
    if ($sessId) { $null = Api 'DELETE' "/api/admin/recruit/sessions/$sessId" $null $jar }
    if ($null -ne $originalCycle) {
        $null = Api 'PUT' '/api/admin/recruit' @{ cycle = $originalCycle } $jar
        Write-Host '  已复原原有的招新周期配置' -ForegroundColor Yellow
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
