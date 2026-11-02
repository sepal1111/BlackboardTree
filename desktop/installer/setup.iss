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

[Files]
Source: "..\out\MyScreen.exe"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion

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
