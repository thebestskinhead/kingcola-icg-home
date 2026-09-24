# ============================================================================
# 按文件名顺序执行 migrations/ 下的所有 .sql
#
# 用法：
#   pwsh -NoProfile -File scripts/migrate.ps1 -Target local
#   pwsh -NoProfile -File scripts/migrate.ps1 -Target remote
#
# 说明：不用 `wrangler d1 migrations apply`，因为项目早期是用 d1 execute 手工执行的，
# 没有 d1_migrations 记录，切换过去会重复执行 ALTER TABLE 而报错。
# 这里逐个文件执行并逐条报告结果；已执行过的文件重复执行会报错但不影响其它文件。
# ============================================================================

param([ValidateSet('local', 'remote')][string]$Target = 'local')

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$files = Get-ChildItem (Join-Path $root 'migrations') -Filter '*.sql' | Sort-Object Name
if ($files.Count -eq 0) {
    Write-Host 'migrations/ 下没有 SQL 文件' -ForegroundColor Yellow
    exit 0
}

Write-Host "目标：kingcola-db ($Target)，共 $($files.Count) 个迁移文件`n" -ForegroundColor Cyan

$failed = 0
foreach ($file in $files) {
    Write-Host "-> $($file.Name)" -ForegroundColor White -NoNewline
    $output = & node '.\node_modules\wrangler\bin\wrangler.js' d1 execute kingcola-db "--$Target" "--file=$($file.FullName)" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host '  OK' -ForegroundColor Green
    }
    else {
        $failed++
        Write-Host '  失败' -ForegroundColor Yellow
        $output | Select-Object -Last 4 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    }
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host '全部迁移执行成功' -ForegroundColor Green
}
else {
    Write-Host "$failed 个文件失败 —— 若提示 already exists / duplicate column，说明它已经执行过，可忽略。" -ForegroundColor Yellow
}
