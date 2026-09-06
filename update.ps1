param([string]$Message)

# 一鍵更新：重新建置 -> commit -> 推上 GitHub，GitHub Pages 會自動重新發佈。
# 直接雙擊 update.bat 就會跑這個。

Set-Location $PSScriptRoot
$site = "https://yellowdevil0852-afk.github.io/porkguy/"

Write-Host ""
Write-Host "=== 1/4  重新建置 porkguy.html ===" -ForegroundColor Cyan
node build.js
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "建置失敗，什麼都沒有推上去。上面的錯誤訊息就是原因。" -ForegroundColor Red
  if (-not $Message) { Read-Host "按 Enter 關閉" }
  exit 1
}

if ($Message) { $msg = $Message }
else {
  Write-Host ""
  $msg = Read-Host "這次改了什麼？（直接按 Enter 用預設訊息）"
}
if ([string]::IsNullOrWhiteSpace($msg)) { $msg = "更新遊戲" }

Write-Host ""
Write-Host "=== 2/4  把變更加進來 ===" -ForegroundColor Cyan
git add -A

Write-Host "=== 3/4  建立 commit ===" -ForegroundColor Cyan
git commit -m $msg
if ($LASTEXITCODE -ne 0) {
  Write-Host "沒有任何變更需要提交（可能你還沒改東西）。" -ForegroundColor Yellow
}

Write-Host "=== 4/4  推上 GitHub ===" -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "推送失敗。網路不通，或是 GitHub 登入過期了。" -ForegroundColor Red
  Write-Host "登入過期的話在終端機打：gh auth login" -ForegroundColor Yellow
  if (-not $Message) { Read-Host "按 Enter 關閉" }
  exit 1
}

Write-Host ""
Write-Host "完成！GitHub Pages 大約 30 秒到 1 分鐘會自動重新發佈。" -ForegroundColor Green
Write-Host "之後重新整理這個網址就是新版（對方可能要按 Ctrl+F5 強制重載）：" -ForegroundColor Green
Write-Host "  $site" -ForegroundColor White
if (-not $Message) {
  Write-Host ""
  Read-Host "按 Enter 關閉"
}
