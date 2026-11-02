# 建置黑板樹桌面版（Neutralino）
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

Write-Host '1b. 編譯內建遙控伺服器（Windows 內建的 .NET Framework）...' -ForegroundColor Cyan
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw '找不到 .NET Framework 4 編譯器（csc.exe）' }
$static = Resolve-Path ..\static
& $csc /nologo /target:exe /optimize+ /utf8output /codepage:65001 /out:resources\myscreen-relay.exe /r:System.Web.Extensions.dll `
  "/resource:$static\remote.html,remote.html" "/resource:$static\vote.html,vote.html" "/resource:$static\css\remote.css,css/remote.css" `
  "/resource:$static\js\remote.js,js/remote.js" "/resource:$static\js\ui.js,js/ui.js" `
  "/resource:$static\js\widgets\util.js,js/widgets/util.js" relay\BlackboardTreeRelay.cs
if ($LASTEXITCODE -ne 0) { throw '遙控伺服器編譯失敗' }

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
$running = Get-Process BlackboardTree -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $PWD 'out\BlackboardTree.exe') }
if ($running) { throw 'BlackboardTree.exe 正在執行，無法覆蓋。請先關閉黑板樹視窗後再執行一次。' }
node patch-exe.mjs dist\blackboardtree\blackboardtree-win_x64.exe out\BlackboardTree.exe
if ($LASTEXITCODE -ne 0) { throw '寫入圖示失敗' }
# 免安裝版只有 BlackboardTree.exe 一個檔案（遙控伺服器內嵌在裡面，執行時自動解出），清掉舊版留下的檔案
$relayRunning = Get-Process myscreen-relay -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $PWD 'out\myscreen-relay.exe') }
if ($relayRunning) { $relayRunning | Stop-Process -Force }
Remove-Item out\myscreen-relay.exe -Force -ErrorAction SilentlyContinue
# 1.6.0 由 MyScreen 改名為黑板樹：清掉舊檔名的免安裝版與安裝程式
Remove-Item out\MyScreen.exe, out\MyScreen-Setup-*.exe -Force -ErrorAction SilentlyContinue

Write-Host '5. 製作安裝程式...' -ForegroundColor Cyan
$version = (Get-Content neutralino.config.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
# 版本號：主版本.次版本.修正版（只能是數字，見 DEVELOPMENT.md「版本號與發佈」）
if ($version -notmatch '^\d{1,5}\.\d{1,5}\.\d{1,5}$') { throw "版本號格式不正確：$version（請用 1.2.3 這種格式）" }
# 舊版本的安裝程式不保留（out\ 有放進 git，留著會讓 repo 越來越大）
Get-ChildItem out\BlackboardTree-Setup-*.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "BlackboardTree-Setup-$version.exe" } | ForEach-Object {
  try {
    Remove-Item $_.FullName -Force -ErrorAction Stop
    Write-Host "  刪除舊版安裝程式：$($_.Name)"
  } catch {
    Write-Host "  無法刪除 $($_.TargetObject)（可能正在執行），請關閉後手動刪除" -ForegroundColor Yellow
  }
}
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
  Write-Host "  安裝程式：desktop\out\BlackboardTree-Setup-$version.exe" -ForegroundColor Green
  Write-Host '  免安裝版：desktop\out\BlackboardTree.exe（單一檔案，已內含手機遙控伺服器）' -ForegroundColor Green
} else {
  Write-Host '完成！免安裝版：desktop\out\BlackboardTree.exe' -ForegroundColor Green
  Write-Host '找不到 Inno Setup 6，所以沒有產生安裝程式。需要安裝程式的話，請安裝 Inno Setup 6（https://jrsoftware.org/isdl.php）後再執行一次。' -ForegroundColor Yellow
}

# 「⚙ 設定 → 關於與更新」會讀 GitHub 上的 out\latest.json 檢查新版本（commit、push 後老師才看得到新版）
node make-latest.mjs $version
if ($LASTEXITCODE -ne 0) { throw '產生 latest.json 失敗' }
