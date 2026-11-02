; 黑板樹 Blackboard Tree 安裝程式（Inno Setup 6）
; 由 desktop\build.ps1 呼叫：ISCC.exe /DAppVersion=1.0.0 installer\setup.iss
; 預設安裝到使用者自己的 %LOCALAPPDATA%\Programs\BlackboardTree（1.5 以前裝在 MyScreen 資料夾的，升級時沿用原本的位置），不需要系統管理員權限（和網路磁碟機程式相同）
; 資訊組要為所有使用者安裝（裝到 Program Files）時，以系統管理員執行並加上 /ALLUSERS

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "黑板樹 Blackboard Tree"
#define AppExeName "BlackboardTree.exe"

[Setup]
AppId={{6F3B2C1E-8D4A-4E7B-9C21-5A7E0D3F4B11}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=黑板樹
AppPublisherURL=https://github.com/sepal1111/BlackboardTree
DefaultDirName={autopf}\BlackboardTree
DefaultGroupName=黑板樹 Blackboard Tree
; 1.6.0 改名：開始功能表改用新名稱的資料夾（舊的在 [InstallDelete] 刪除）
UsePreviousGroup=no
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
OutputDir=..\out
OutputBaseFilename=BlackboardTree-Setup-{#AppVersion}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} 安裝程式
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; 更新時自動關閉正在執行的黑板樹
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chinesetraditional"; MessagesFile: "ChineseTraditional.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面建立捷徑"; GroupDescription: "其他選項："
Name: "firewall"; Description: "允許手機連線到這台電腦（加入 Windows 防火牆例外，需要系統管理員權限）"; GroupDescription: "手機遙控："

[Files]
Source: "..\out\BlackboardTree.exe"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion
; 內建手機遙控伺服器（老師電腦當伺服器時使用）
Source: "..\resources\myscreen-relay.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{group}\解除安裝黑板樹"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "立即開啟黑板樹"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
; 程式內「下載並更新」用 /SILENT 安裝：裝好後由安裝程式重新開啟（資訊組用 /VERYSILENT 大量部署時不會開啟）
Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Flags: nowait runasoriginaluser; Check: IsInAppUpdate

[InstallDelete]
; 1.5 以前叫 MyScreen：刪除舊檔名的程式與捷徑
Type: files; Name: "{app}\MyScreen.exe"
Type: filesandordirs; Name: "{autoprograms}\MyScreen 教室白板"
Type: files; Name: "{autodesktop}\MyScreen 教室白板.lnk"

[UninstallDelete]
; Neutralino 執行時產生的暫存檔（白板資料存在 V:\MyScreen，不會被刪除）
Type: filesandordirs; Name: "{app}\.tmp"
Type: files; Name: "{app}\neutralinojs.log"
; 1.4 以前資訊組可能放的學校預設遙控伺服器設定（已不再使用），解除安裝時一併清掉
Type: files; Name: "{app}\myscreen.json"

[Code]
// 手機遙控伺服器由這台電腦擔任（內建 myscreen-relay.exe），安裝時不需要任何設定

// ---- Windows 防火牆：讓手機可以連到這台電腦的內建遙控伺服器
const
  FwRule = 'Blackboard Tree Remote';
  OldFwRule = 'MyScreen Remote'; // 1.5 以前的名稱

function FwParams(Add: Boolean): String;
begin
  if Add then
    Result := 'advfirewall firewall add rule name="' + FwRule + '" dir=in action=allow protocol=TCP enable=yes profile=any program="' + ExpandConstant('{app}\myscreen-relay.exe') + '"'
  else
    Result := 'advfirewall firewall delete rule name="' + FwRule + '"';
end;

function OldFwDelete(): String;
begin
  Result := 'advfirewall firewall delete rule name="' + OldFwRule + '"';
end;

// 程式內更新（/SILENT，不是 /VERYSILENT）
function IsInAppUpdate(): Boolean;
var
  Tail: String;
begin
  Tail := Uppercase(GetCmdTail());
  Result := WizardSilent() and (Pos('/VERYSILENT', Tail) = 0);
end;

procedure AddFirewallRule();
var
  Code: Integer;
begin
  if IsAdmin() then
  begin
    Exec('netsh', OldFwDelete(), '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec('netsh', FwParams(False), '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec('netsh', FwParams(True), '', SW_HIDE, ewWaitUntilTerminated, Code);
  end
  else if not WizardSilent() then
  begin
    // 一般老師帳號：跳出 Windows 的系統管理員確認（可請資訊組輸入密碼）；取消的話就略過
    if not ShellExec('runas', ExpandConstant('{cmd}'), '/c netsh ' + OldFwDelete() + ' & netsh ' + FwParams(False) + ' & netsh ' + FwParams(True), '', SW_HIDE, ewWaitUntilTerminated, Code) then
      MsgBox('沒有加入防火牆例外，手機可能無法連到這台電腦。' + #13#10 + '之後可以請資訊組以系統管理員身分重新安裝。', mbInformation, MB_OK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
begin
  if (CurUninstallStep = usUninstall) and IsAdmin() then
  begin
    Exec('netsh', FwParams(False), '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec('netsh', OldFwDelete(), '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('firewall') then AddFirewallRule();
end;
