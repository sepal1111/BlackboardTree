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

Write-Host '4. 寫入圖示與版本資訊...' -ForegroundColor Cyan
if (-not (Test-Path node_modules\resedit)) {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm install 失敗（需要網路連線）' }
}
New-Item -ItemType Directory -Force out | Out-Null
$running = Get-Process MyScreen -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $PWD 'out\MyScreen.exe') }
if ($running) { throw 'MyScreen.exe 正在執行，無法覆蓋。請先關閉 MyScreen 視窗後再執行一次。' }
node patch-exe.mjs dist\myscreen\myscreen-win_x64.exe out\MyScreen.exe
if ($LASTEXITCODE -ne 0) { throw '寫入圖示失敗' }

Write-Host '5. 製作安裝程式...' -ForegroundColor Cyan
$version = (Get-Content neutralino.config.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$iscc = @(
  (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Write-Host ''
if ($iscc) {
  & $iscc /Q "/DAppVersion=$version" installer\setup.iss
  if ($LASTEXITCODE -ne 0) { throw 'Inno Setup 編譯失敗' }
  Write-Host '完成！' -ForegroundColor Green
  Write-Host "  安裝程式：desktop\out\MyScreen-Setup-$version.exe" -ForegroundColor Green
  Write-Host '  免安裝版：desktop\out\MyScreen.exe' -ForegroundColor Green
} else {
  Write-Host '完成！免安裝版：desktop\out\MyScreen.exe' -ForegroundColor Green
  Write-Host '找不到 Inno Setup 6，所以沒有產生安裝程式。需要安裝程式的話，請安裝 Inno Setup 6（https://jrsoftware.org/isdl.php）後再執行一次。' -ForegroundColor Yellow
}
