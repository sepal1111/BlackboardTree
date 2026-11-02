; MyScreen 教室白板 安裝程式（Inno Setup 6）
; 由 desktop\build.ps1 呼叫：ISCC.exe /DAppVersion=1.0.0 installer\setup.iss
; 預設安裝到使用者自己的 %LOCALAPPDATA%\Programs\MyScreen，不需要系統管理員權限（和網路磁碟機程式相同）
; 資訊組要為所有使用者安裝（裝到 Program Files）時，以系統管理員執行並加上 /ALLUSERS

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "MyScreen 教室白板"
#define AppExeName "MyScreen.exe"

[Setup]
AppId={{6F3B2C1E-8D4A-4E7B-9C21-5A7E0D3F4B11}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=MyScreen
AppPublisherURL=https://github.com/sepal1111/MyScreen
DefaultDirName={autopf}\MyScreen
DefaultGroupName=MyScreen 教室白板
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
OutputDir=..\out
OutputBaseFilename=MyScreen-Setup-{#AppVersion}
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
; 更新時自動關閉正在執行的 MyScreen
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chinesetraditional"; MessagesFile: "ChineseTraditional.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面建立捷徑"; GroupDescription: "其他選項："
Name: "firewall"; Description: "允許手機連線到這台電腦（加入 Windows 防火牆例外，需要系統管理員權限）"; GroupDescription: "手機遙控："

[Files]
Source: "..\out\MyScreen.exe"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion
; 內建手機遙控伺服器（老師電腦當伺服器時使用）
Source: "..\out\myscreen-relay.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{group}\解除安裝 MyScreen"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "立即開啟 MyScreen"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Neutralino 執行時產生的暫存檔（白板資料存在 V:\MyScreen，不會被刪除）
Type: filesandordirs; Name: "{app}\.tmp"
Type: files; Name: "{app}\neutralinojs.log"
Type: files; Name: "{app}\myscreen.json"

[Code]
// 手機遙控伺服器（學校預設）：寫在程式資料夾的 myscreen.json，MyScreen 啟動時讀取
// 靜默安裝可用 /RELAY=http://192.168.1.10:8080 指定；老師也可以在 MyScreen 裡自己設定（會優先使用）
var RelayPage: TInputQueryWizardPage;

function ConfigPath(): String;
begin
  Result := ExpandConstant('{app}\myscreen.json');
end;

// 從舊的 myscreen.json 讀出 relay（升級時保留原本的設定）
function ReadOldRelay(): String;
var
  S: AnsiString;
  P, Q: Integer;
begin
  Result := '';
  if not LoadStringFromFile(ExpandConstant('{autopf}\MyScreen\myscreen.json'), S) then exit;
  P := Pos('"relay"', S);
  if P = 0 then exit;
  S := Copy(S, P + 7, Length(S));
  P := Pos('"', S);
  if P = 0 then exit;
  S := Copy(S, P + 1, Length(S));
  Q := Pos('"', S);
  if Q = 0 then exit;
  Result := Copy(S, 1, Q - 1);
end;

procedure InitializeWizard();
var
  V: String;
begin
  RelayPage := CreateInputQueryPage(wpSelectTasks,
    '手機遙控',
    '遙控伺服器（選填）',
    '老師可以用手機或平板遙控教室電腦上的 MyScreen。預設由這台電腦擔任遙控伺服器，手機連上校內網路就能使用，不需要另外設定。' + #13#10 + #13#10 +
    '如果學校另外架了遙控伺服器（例如在 NAS 上），請填入網址，例如 http://192.168.1.10:8080；否則請留空。');
  RelayPage.Add('遙控伺服器網址：', False);
  V := ExpandConstant('{param:RELAY|}');
  if V = '' then V := ReadOldRelay();
  RelayPage.Values[0] := V;
end;

// ---- Windows 防火牆：讓手機可以連到這台電腦的內建遙控伺服器
const
  FwRule = 'MyScreen Remote';

function FwParams(Add: Boolean): String;
begin
  if Add then
    Result := 'advfirewall firewall add rule name="' + FwRule + '" dir=in action=allow protocol=TCP enable=yes profile=any program="' + ExpandConstant('{app}\myscreen-relay.exe') + '"'
  else
    Result := 'advfirewall firewall delete rule name="' + FwRule + '"';
end;

procedure AddFirewallRule();
var
  Code: Integer;
begin
  if IsAdmin() then
  begin
    Exec('netsh', FwParams(False), '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec('netsh', FwParams(True), '', SW_HIDE, ewWaitUntilTerminated, Code);
  end
  else if not WizardSilent() then
  begin
    // 一般老師帳號：跳出 Windows 的系統管理員確認（可請資訊組輸入密碼）；取消的話就略過
    if not ShellExec('runas', ExpandConstant('{cmd}'), '/c netsh ' + FwParams(False) + ' & netsh ' + FwParams(True), '', SW_HIDE, ewWaitUntilTerminated, Code) then
      MsgBox('沒有加入防火牆例外，手機可能無法連到這台電腦。' + #13#10 + '之後可以請資訊組以系統管理員身分重新安裝。', mbInformation, MB_OK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
begin
  if (CurUninstallStep = usUninstall) and IsAdmin() then
    Exec('netsh', FwParams(False), '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  V: String;
begin
  if CurStep = ssPostInstall then
  begin
    if WizardIsTaskSelected('firewall') then AddFirewallRule();
    V := Trim(RelayPage.Values[0]);
    StringChangeEx(V, '\', '/', True);
    StringChangeEx(V, '"', '', True);
    if V = '' then
      DeleteFile(ConfigPath())
    else
      SaveStringToFile(ConfigPath(), '{"relay": "' + V + '"}' + #13#10, False);
  end;
end;
