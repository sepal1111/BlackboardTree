# 建置 MyScreen 桌面版（Neutralino）
# 用法：powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '1. 複製網頁檔案...' -ForegroundColor Cyan
if (Test-Path resources) { Remove-Item resources -Recurse -Force }
Copy-Item ..\static resources -Recurse
Copy-Item icon.png resources\icon.png
$indexPath = Join-Path $PWD 'resources\index.html'
$index = [IO.File]::ReadAllText($indexPath)
$index = $index.Replace('<!-- desktop-scripts -->', '<script src="neutralino.js"></script>')
[IO.File]::WriteAllText($indexPath, $index, (New-Object Text.UTF8Encoding $false))

Write-Host '2. 準備 Neutralino 執行檔...' -ForegroundColor Cyan
if (-not (Test-Path bin\neutralino.js)) {
  npx -y @neutralinojs/neu update
  if ($LASTEXITCODE -ne 0) { throw 'neu update 失敗（需要網路連線）' }
  Copy-Item resources\neutralino.js bin\neutralino.js
} else {
  Copy-Item bin\neutralino.js resources\neutralino.js
}

Write-Host '3. 打包成單一執行檔...' -ForegroundColor Cyan
npx -y @neutralinojs/neu build --embed-resources
if ($LASTEXITCODE -ne 0) { throw 'neu build 失敗' }

New-Item -ItemType Directory -Force out | Out-Null
try {
  Copy-Item dist\myscreen\myscreen-win_x64.exe out\MyScreen.exe -Force -ErrorAction Stop
} catch {
  throw 'MyScreen.exe 正在執行，無法覆蓋。請先關閉 MyScreen 視窗後再執行一次。'
}
Write-Host ''
Write-Host '完成！執行檔：desktop\out\MyScreen.exe' -ForegroundColor Green
