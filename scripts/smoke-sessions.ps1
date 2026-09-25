# ============================================================================
# 考试场次与签到二维码自检（需要本地服务已在 8787 运行：npm run local / npm run dev:api）
#
# 覆盖：
#   1) 场次增删改：校验拒绝（结束早于开始）、列表、派生时间同步回周期
#   2) 签到二维码：签发 → 匿名读信息 → 匿名签到 → 记下「签的哪一场」
#   3) 凭证语义：无 token / 乱 token 拿不到信息；重新签发让旧码立即失效；一键作废
#   4) 删除场次：该场二维码一并作废、已签记录的场次归属被清空（签到时间保留）
#
# 脚本会**先备份再复原**招新周期配置（场次会反写周期里的笔试时间），
# 并且会删掉自己造的那条报名记录。含中文，必须用 pwsh 运行：
#   pwsh -NoProfile -File scripts/smoke-sessions.ps1
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
    $json = @{ sub = $studentId; name = $name; sid = 'smoke-sess'; exp = $exp } | ConvertTo-Json -Compress
    $body = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    $h = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
    $sig = [Convert]::ToBase64String($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    return "$body.$sig"
}

# 北京时间字符串
function Cn([int]$addMinutes) {
    $t = (Get-Date).ToUniversalTime().AddMinutes($addMinutes + 480)
    return $t.ToString('yyyy-MM-ddTHH:mm')
}

# ---- 准备 ----
$root = Split-Path -Parent $PSScriptRoot
$devVars = Get-Content (Join-Path $root '.dev.vars') -Encoding UTF8
$studentSecret = ($devVars | Where-Object { $_ -match '^STUDENT_SESSION_SECRET=' }) -replace '^STUDENT_SESSION_SECRET=', ''

$work = Join-Path $env:TEMP ('kc-sess-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$jar = Join-Path $work 'admin.jar'
$pdfPath = Join-Path $work 'report.pdf'
[IO.File]::WriteAllBytes($pdfPath, [byte[]](0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0x25, 0x45, 0x4F, 0x46))

$stamp = Get-Random -Minimum 100000 -Maximum 999999
$studentId = "SES$stamp"
$studentName = '场次冒烟'
$studentCookie = 'kc_student=' + (New-StudentToken $studentSecret $studentId $studentName)

$originalCycle = $null
$appId = ''
$sessionId = ''

Write-Host "考试场次与签到二维码自检 → $Base`n" -ForegroundColor Cyan
Write-Host "测试学号：$studentId`n" -ForegroundColor DarkGray

try {
    # ===== 0. 服务与登录 =====
    Write-Host '0) 服务与登录'
    Check '健康检查可用' ((Api 'GET' '/api/health').ok -eq $true)
    & curl.exe -s -c $jar -o NUL -X POST "$Base/api/admin/login" -H 'content-type: application/json' --data-raw '{"username":"admin","password":"kingcola-dev-2026"}'
    Check '管理员登录成功' ((RawStatus 'GET' '/api/admin/me' $jar) -eq '200')

    $originalCycle = (Api 'GET' '/api/admin/recruit' $null $jar).data.cycle

    # 报名窗口打开、清空「已确认笔试名单」（否则报名通道是关的）
    $null = Api 'PUT' '/api/admin/recruit' @{ cycle = @{
        name = '场次自检招新'
        applyStart = (Cn -60); applyEnd = (Cn 60)
        writtenConfirmedAt = ''; forceClosed = $false; closedAt = ''
    } } $jar

    # ===== 1. 报名（为了测「签到记到场次」需要一个真实的报名记录） =====
    Write-Host "`n1) 准备一条报名记录"
    $raw = & curl.exe -s -X POST "$Base/api/applications" -H "Cookie: $studentCookie" -F "file=@$pdfPath;type=application/pdf" -F "email=$($studentId.ToLower())@example.edu.cn" -F 'phone=13800000000' -F 'qq=123456'
    $created = $raw | ConvertFrom-Json
    $appId = $created.data.id
    Check '报名提交成功且 source=web' ($created.ok -eq $true -and $created.data.stage -eq 'apply' -and $created.data.source -eq 'web') $raw

    # ===== 2. 场次 =====
    Write-Host "`n2) 场次增删改"
    $bad = Api 'POST' '/api/admin/recruit/sessions' @{
        stage = 'written'; name = '时间颠倒'; startsAt = (Cn 120); endsAt = (Cn 60)
    } $jar
    Check '结束早于开始被拒（VALIDATION_FAILED）' ($bad.ok -eq $false -and $bad.error.code -eq 'VALIDATION_FAILED') ($bad | ConvertTo-Json -Compress)

    $badStage = Api 'POST' '/api/admin/recruit/sessions' @{ stage = 'apply'; startsAt = (Cn 60) } $jar
    Check '非签到阶段被拒（INVALID_STAGE）' ($badStage.ok -eq $false -and $badStage.error.code -eq 'INVALID_STAGE')

    $start = Cn 60
    $end = Cn 120
    $made = Api 'POST' '/api/admin/recruit/sessions' @{
        stage = 'written'; name = '自检第一场'; startsAt = $start; endsAt = $end; place = '自检教室'
    } $jar
    $sessionId = $made.data.session.id
    Check '新建笔试场次成功' ($made.ok -eq $true -and $sessionId -like 'sess*') ($made | ConvertTo-Json -Compress)

    $list = (Api 'GET' '/api/admin/recruit/sessions' $null $jar).data
    $mine = $list.sessions | Where-Object { $_.id -eq $sessionId }
    Check '列表里能按场次看到它，且称呼/时间文本正确' (
        $mine.label -eq '自检第一场' -and $mine.stageLabel -eq '笔试' -and $mine.checkinCount -eq 0
    ) ($mine | ConvertTo-Json -Compress)
    Check '场次时间文本按北京时间渲染（同日不重复日期）' (
        $mine.timeText -match '^\d{4} 年 \d{1,2} 月 \d{1,2} 日 \d{2}:\d{2}–\d{2}:\d{2}$'
    ) $mine.timeText

    $cycle = (Api 'GET' '/api/admin/recruit' $null $jar).data.cycle
    Check '首场时间/地点同步回周期（writtenAt / writtenPlace）' (
        $cycle.writtenAt -eq $start -and $cycle.writtenPlace -eq '自检教室'
    ) ($cycle.writtenAt + ' / ' + $cycle.writtenPlace)
    Check '末场结束时间同步回周期（writtenEnd，缺考判定的起点）' ($cycle.writtenEnd -eq $end) $cycle.writtenEnd

    # ===== 3. 签发二维码 =====
    Write-Host "`n3) 签到二维码"
    # 这里刻意留一份原始响应：ConvertFrom-Json 会把 ISO 串转成 DateTime，
    # 再交给 Parse 就会丢掉时区（本地时区非 UTC 时会整体偏移），比较有效期必须用原串
    $rawIssue = & curl.exe -s -X POST "$Base/api/admin/recruit/sessions/$sessionId/checkin-token" -H 'content-type: application/json' -b $jar --data-raw '{"ttlHours":6}'
    $issued = $rawIssue | ConvertFrom-Json
    $token1 = $issued.data.token
    Check '签发成功且返回绝对二维码地址' (
        $issued.ok -eq $true -and $issued.data.url -match ('/checkin/' + $token1 + '$') -and $token1 -match '^[0-9a-f]{32}$'
    ) $issued.data.url

    # 场次结束时间按北京时间解读（与后端 cnTimeToEpoch 同一口径）；过期时间是带 Z 的 UTC ISO
    $expiresIso = [regex]::Match($rawIssue, '"expiresAt":"([^"]+)"').Groups[1].Value
    $endEpoch = ([DateTimeOffset]::new([DateTime]::ParseExact($end, 'yyyy-MM-ddTHH:mm', $null), [TimeSpan]::FromHours(8))).ToUnixTimeSeconds()
    $expEpoch = [DateTimeOffset]::Parse($expiresIso, [Globalization.CultureInfo]::InvariantCulture).ToUnixTimeSeconds()
    Check '有效期不早于场次结束时间（拖堂也能签到）' ($expEpoch -ge $endEpoch) "$expiresIso vs 场次结束 $end"

    $anonymous = Api 'GET' "/api/applications/checkin/$token1"
    Check '匿名可读签到页信息（凭证即密权）' (
        $anonymous.ok -eq $true -and $anonymous.data.stage -eq 'written' -and $anonymous.data.stageLabel -eq '笔试'
    ) ($anonymous | ConvertTo-Json -Compress)
    Check '信息里带场次称呼与时间' (
        $anonymous.data.sessionLabel -eq '自检第一场' -and $anonymous.data.sessionTime -match '\d{2}:\d{2}–\d{2}:\d{2}'
    ) $anonymous.data.sessionTime

    Check '乱 token 拿不到任何信息（404）' ((RawStatus 'GET' '/api/applications/checkin/deadbeef') -eq '404')
    Check '裸路径（无 token）也是 404' ((RawStatus 'GET' '/api/applications/checkin/') -eq '404')

    # ===== 4. 签到 =====
    Write-Host "`n4) 扫码签到"
    $wrong = Api 'POST' "/api/applications/checkin/$token1" @{ name = '冒名顶替'; studentId = $studentId }
    Check '姓名与报名记录不一致被拒（NAME_MISMATCH）' ($wrong.ok -eq $false -and $wrong.error.code -eq 'NAME_MISMATCH')

    $missing = Api 'POST' "/api/applications/checkin/$token1" @{ name = $studentName; studentId = 'NOPE000000' }
    Check '没报名的人签到失败（而且说明凭证本身是有效的）' ($missing.ok -eq $false -and $missing.error.code -eq 'NOT_FOUND') ($missing | ConvertTo-Json -Compress)

    $done = Api 'POST' "/api/applications/checkin/$token1" @{ name = $studentName; studentId = $studentId }
    Check '签到成功，返回场次归属' ($done.ok -eq $true -and $done.data.already -eq $false -and $done.data.sessionId -eq $sessionId) ($done | ConvertTo-Json -Compress)

    $detail = (Api 'GET' "/api/admin/applications/$appId" $null $jar).data.application
    Check '后台详情：阶段推进到笔试、结果=已参加' ($detail.stage -eq 'written' -and $detail.result -eq 'attended') ($detail.stage + '/' + $detail.result)
    Check '后台详情：记下了「签的哪一场」' ($detail.writtenSessionId -eq $sessionId) $detail.writtenSessionId

    $again = Api 'POST' "/api/applications/checkin/$token1" @{ name = $studentName; studentId = $studentId }
    Check '重复扫码提示已签到（already=true）' ($again.ok -eq $true -and $again.data.already -eq $true)

    $list = (Api 'GET' '/api/admin/recruit/sessions' $null $jar).data
    $mine = $list.sessions | Where-Object { $_.id -eq $sessionId }
    Check '场次到场人数统计为 1' ($mine.checkinCount -eq 1) $mine.checkinCount

    # ===== 5. 重新签发让旧码失效 =====
    Write-Host "`n5) 凭证生命周期"
    $reissued = Api 'POST' "/api/admin/recruit/sessions/$sessionId/checkin-token" @{} $jar
    $token2 = $reissued.data.token
    Check '重新签发返回新码' ($token2 -ne $token1 -and $token2 -match '^[0-9a-f]{32}$')
    Check '旧码立即失效（404）' ((RawStatus 'GET' "/api/applications/checkin/$token1") -eq '404')
    Check '新码可用（200）' ((RawStatus 'GET' "/api/applications/checkin/$token2") -eq '200')

    $revoked = Api 'POST' '/api/admin/recruit/checkin-tokens/revoke' @{ sessionId = $sessionId } $jar
    Check '一键作废该场二维码' ($revoked.ok -eq $true -and $revoked.data.revoked -ge 1) ($revoked | ConvertTo-Json -Compress)
    Check '作废后新码也失效（404）' ((RawStatus 'GET' "/api/applications/checkin/$token2") -eq '404')

    # ===== 6. 删除场次 =====
    Write-Host "`n6) 删除场次"
    Check '删除场次成功' ((Api 'DELETE' "/api/admin/recruit/sessions/$sessionId" $null $jar).ok -eq $true)
    $list = (Api 'GET' '/api/admin/recruit/sessions' $null $jar).data
    Check '列表里已无该场次' (($list.sessions | Where-Object { $_.id -eq $sessionId }).Count -eq 0)

    $detail = (Api 'GET' "/api/admin/applications/$appId" $null $jar).data.application
    Check '已签记录的场次归属被清空，但签到时间保留' (
        $detail.writtenSessionId -eq '' -and $detail.writtenCheckinAt -ne ''
    ) ($detail.writtenSessionId + ' / ' + $detail.writtenCheckinAt)
}
finally {
    # ---- 复原：删掉测试报名记录，再还原周期配置 ----
    if ($appId) { $null = Api 'DELETE' "/api/admin/applications/$appId" $null $jar }
    if ($sessionId) { $null = Api 'DELETE' "/api/admin/recruit/sessions/$sessionId" $null $jar }
    if ($originalCycle) {
        $null = Api 'PUT' '/api/admin/recruit' @{ cycle = $originalCycle } $jar
        Write-Host "`n  已复原原有的招新周期配置" -ForegroundColor DarkGray
    }
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($script:failed -eq 0) {
    Write-Host "全部通过（$script:passed 项）" -ForegroundColor Green
    exit 0
}
else {
    Write-Host "失败 $script:failed 项，通过 $script:passed 项" -ForegroundColor Red
    exit 1
}
