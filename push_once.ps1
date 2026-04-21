#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# One-click setup for git author info.
git config --global user.name "Herry0427"
git config --global user.email "liu.heng.9627@gmail.com"

# Safer flow: pull first, then push.
Write-Host "Step 1/2: pull remote changes..." -ForegroundColor Cyan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\sync-to-github.ps1" pull
if ($LASTEXITCODE -ne 0) {
  throw "pull failed. Resolve conflicts and run again."
}

Write-Host "Step 2/2: push local changes..." -ForegroundColor Cyan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\sync-to-github.ps1" push
if ($LASTEXITCODE -ne 0) {
  throw "push failed. Check terminal output."
}
#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# One-click setup for git author info.
git config --global user.name "Herry0427"
git config --global user.email "liu.heng.9627@gmail.com"

# Safer flow: pull first, then push.
Write-Host "Step 1/2: pull remote changes..." -ForegroundColor Cyan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\sync-to-github.ps1" pull
if ($LASTEXITCODE -ne 0) {
  Write-Error "pull 失败，请先处理冲突后再运行。"
}

Write-Host "Step 2/2: push local changes..." -ForegroundColor Cyan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\sync-to-github.ps1" push
if ($LASTEXITCODE -ne 0) {
  Write-Error "push 失败，请查看终端输出。"
}
