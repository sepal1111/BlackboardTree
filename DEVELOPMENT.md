# MyScreen 開發交接文件

給接手開發的人（或換一台電腦繼續開發時）看的說明。使用方式請看 [README.md](README.md)。

最後更新：2026-11-02（commit `48c30ac` 之後）

---

## 1. 專案概要

免費的教室投影白板（類似 classroomscreen.com），給學校老師使用：

- 白板資料存在老師個人資料夾 `V:\MyScreen`（學校的「網路磁碟機」程式會把個人資料夾連到 V:），換電腦、換教室都能接著用
- 主要使用方式是 **Windows 桌面版**（Neutralino），也有網頁版與伺服器版
- 老師可以用手機／平板遙控教室電腦（接大電視）上的白板

### 三種執行方式

| 方式 | 說明 | 儲存 |
|---|---|---|
| 桌面版（主要） | `desktop/` 打包成 `MyScreen.exe` 與安裝程式 | 直接讀寫 `V:\MyScreen` |
| 網頁版 | `static/` 放到任何網頁伺服器 | 瀏覽器 File System Access API 選資料夾 |
| 伺服器版 | `server/app.py`（FastAPI），老師用 SAMBA 帳號登入 | 伺服器代為連線 SAMBA |

三種方式讀寫**同一種資料格式**，可以混用。

---

## 2. 在新電腦建立開發環境

### 需要安裝

| 工具 | 用途 | 備註 |
|---|---|---|
| Git | 取得原始碼 | |
| Python 3.10 以上（目前用 3.12） | 本機測試伺服器（瀏覽器測試用） | |
| Node.js 22 以上（目前用 24） | 桌面版建置、relay 測試 | 第一次建置要網路（下載 Neutralino、`resedit`） |
| Inno Setup 6 | 產生安裝程式 | 選用；沒裝只會產生免安裝版。可裝在 `%LOCALAPPDATA%\Programs\Inno Setup 6`（不需系統管理員），`build.ps1` 會自動找 |
| .NET Framework 4（`csc.exe`） | 編譯內建遙控伺服器 | **Windows 10／11 內建**，不用安裝 |

### 步驟

```bash
git clone https://github.com/sepal1111/MyScreen.git
cd MyScreen
```

```bash
py -3 -m venv .venv
```

```bash
.venv\Scripts\python -m pip install -r requirements.txt
```

（或直接雙擊 `start.bat`，第一次會自動建立 `.venv` 並安裝套件。）

學校的「網路磁碟機」程式是**另一個 repo**，不在這裡（`.gitignore` 排除了 `NetDrive/`）。需要的話：

```bash
git clone https://github.com/sepal1111/NetDrive.git NetDrive
```

---

## 3. 日常開發流程

### 網頁介面：用瀏覽器測（最快）

```bash
.venv\Scripts\python server\app.py
```

開啟 `http://localhost:8080`。沒有 `config.json` 時是**本機測試模式**（`mode: local`）：

- 「只存在這台電腦」：資料在瀏覽器 localStorage
- 「學校帳號登入」：任意帳號都能登入，資料存在 `./data/<帳號>/MyScreen`（測完可以刪掉 `data/`）
- 手機遙控頁：`http://localhost:8080/remote.html`（這個伺服器也內含 relay）

前端是**原生 ES modules，沒有編譯步驟**，改完重新整理即可。

> Claude Code 使用者：`.claude/launch.json` 已設定好名為 `myscreen` 的預覽伺服器。

### 桌面版：建置後執行

```bash
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

產出 `desktop\out\MyScreen.exe`（免安裝版）與 `desktop\out\MyScreen-Setup-<版本>.exe`（安裝程式）。沒有熱重載，改程式後要重新建置。

**注意**：
- 建置前要先**關閉正在執行的 MyScreen**（exe 會被鎖住，`build.ps1` 會提示）
- 請用 **PowerShell** 執行 `build.ps1`；從 Git Bash 呼叫 `csc.exe` 時參數會被路徑轉換弄壞
- 桌面版沒有開發者工具（`enableInspector: false`）。除錯時可暫時在 `desktop/neutralino.config.json` 改成 `true`，畫面左下角也會顯示 JS 錯誤（`index.html` 的 `msFatal`）

### 測試內建遙控伺服器

```bash
node desktop/relay/test-relay.mjs
```

21 項協定測試（取得代碼、指令轉送、斷線重連、中斷全部、8 台上限、父程序結束自動關閉等）。要先建置過（測的是 `desktop/resources/myscreen-relay.exe`）。

### 版本號與發佈

1. 改 `desktop/neutralino.config.json` 的 `version`（安裝程式檔名、exe 版本資訊都會跟著變）
2. 執行 `build.ps1`
3. `desktop/out/` 的安裝程式與 `MyScreen.exe` **有放進 git**（`.gitignore` 只排除執行時產生的 `.tmp`、`myscreen-relay.exe`、log），commit 時會一起更新

---

## 4. 檔案結構

```
static/                     前端（桌面版、網頁版共用）
  index.html                主畫面；<!-- desktop-scripts --> 由 build.ps1 換成 neutralino.js
  remote.html               手機遙控頁
  css/app.css, remote.css
  js/app.js                 主程式：儲存位置、白板清單、小工具框、放大、手機遙控（含內建 relay 控制）
  js/store.js               存檔、離線備份、跨裝置同步；LS（這台電腦的設定，桌面版存檔案）
  js/backends/index.js      FolderBackend／ServerBackend／LocalBackend
  js/backends/fs.js         資料夾存取：FsaAdapter（瀏覽器）、NeuAdapter（Neutralino）
  js/roster.js              班級名單：匯入 Excel/CSV/貼上、欄位對應、照片比對
  js/remote-host.js         教室電腦端的遙控連線（RemoteHost）
  js/remote.js              手機遙控頁的程式（各小工具的手機卡片 RENDER）
  js/ui.js                  h()、modal、toast、選擇圖片等共用 UI
  js/widgets/               小工具：time.js、classroom.js、media.js、util.js、index.js（清單與順序）
  vendor/qrcode.js          QR Code
  vendor/xlsx.mini.min.js   SheetJS 0.20.3（讀 Excel，用到時才載入）
server/
  app.py                    FastAPI 伺服器（smb／local／relay 三種模式）
  storage.py                SMB（smbprotocol）與本機儲存
  relay.py                  手機遙控轉送（NAS／伺服器版用）
desktop/
  neutralino.config.json    桌面版設定（版本、globalVariables、允許的 API）
  build.ps1                 建置腳本（UTF-8 BOM，見「注意事項」）
  patch-exe.mjs             把圖示與版本資訊寫進 exe（resedit）
  relay/MyScreenRelay.cs    內建遙控伺服器（C#，Windows 內建 .NET Framework 編譯）
  relay/test-relay.mjs      relay 測試
  installer/setup.iss       Inno Setup 安裝腳本（UTF-8 BOM）
  installer/ChineseTraditional.isl, icon.ico
  out/                      建置產出（安裝程式、免安裝版，有放進 git）
Dockerfile, docker-compose.yml   NAS 上架設 relay／伺服器版
config.example.json         伺服器版設定範例（複製成 config.json，已被 .gitignore 排除）
```

---

## 5. 資料格式

都在 `V:\MyScreen`（或伺服器版的 `data_dir`）：

```
MyScreen/
  boards/<id>.json     {id, name, rev, created, updatedAt, data: {background, widgets: [...]}}
  settings.json        {data: {classLists: [...], relay?}, updatedAt}
  media/               上傳的圖片、學生照片（照片縮成約 270×360 JPEG）
```

- **小工具**：`{id, type, x, y, w, h, z, state}`，位置與大小是「佔畫面的比例」（0～1）
- **衝突處理**：寫入時帶 `baseRev`，和檔案的 `rev` 不同就拒絕（伺服器回 409），前端載入最新版並提示
- **班級名單**：`classLists: [{id, name, students: [{no, sid, name, photo?}], names}]`
  - `no` 座號（兩位數字串）、`sid` 學號、`photo` 圖片參照
  - `names` 是給舊版程式讀的，存檔時自動由 `students` 產生
- **圖片參照**：`{kind:'file', base:'data'|'root', path}`、`{kind:'data'|'url', url}`（`{kind:'smb', path}` 是舊格式，等同 root）
- **relay**：老師自己設定的遙控伺服器網址（選填）
- **這台電腦上的資料**（不在 V:）：
  - 網頁版：瀏覽器 localStorage
  - 桌面版：`%APPDATA%\MyScreen\prefs.json`（遙控代碼、上次用的班級、V: 斷線時的離線備份等）
  - 學校預設遙控伺服器：程式資料夾的 `myscreen.json`（`{"relay": "..."}`，安裝程式寫入）

---

## 6. 程式架構重點

### 新增小工具

在 `static/js/widgets/` 新增物件，加到 `widgets/index.js` 的 `widgetList`：

```js
export const example = {
  type: 'example', title: '範例', icon: '✨', size: { w: 0.3, h: 0.3 },  // size 是佔畫面比例
  state: () => ({ /* 預設狀態，會存進白板 */ }),
  mount(body, ctx) {
    // ctx.state：狀態（直接修改後呼叫 ctx.save()）
    // ctx.store：Store（getSettings()、imageUrl() 等）
    // ctx.push()：通知手機遙控更新畫面
    return {
      destroy() {},                         // 移除時清理計時器、監聽
      settings: (container) => {},          // 有這個才會出現 ⚙ 設定
      remote: { view: () => ({}), act(action, args) {} },  // 支援手機遙控時
    };
  },
};
```

- 手機遙控的畫面：在 `static/js/remote.js` 的 `RENDER` 加上同名函式；要讓手機能加入這個小工具，加到 `app.js` 的 `remoteState()` 裡 `addable` 清單
- 需要班級名單的小工具：參考 `classroom.js` 的 `people(ctx)`、`namesEditor()`、`watchRoster()`（設定變更時自動重畫、學生改名時更新狀態）
- 大小改變時要重排版面：用 `widgets/util.js` 的 `observeSize()`，不要直接用 ResizeObserver（會出現 ResizeObserver loop 警告）
- 小工具內的文字大小用容器單位（`cqw`、`cqh`、`cqmin`），放大到全螢幕時會自動放大

### 手機遙控

```
手機 remote.html ──WebSocket /ws/remote?code=──► relay ◄──/ws/screen── 教室電腦 RemoteHost
```

- relay 只轉送 JSON，不存資料。訊息：
  - 教室電腦送出：`hello{code,secret}`、`state`、`notice`、`kick`
  - 教室電腦收到：`room{code,secret}`、`remotes`、`cmd`、`replaced`
  - 手機送出：`cmd{target:'app'|'widget', action, args, widgetId}`
  - 手機收到：`hello`、`state`、`screen`、`notice`、`kicked`、`error`
- relay 有兩種實作，協定必須保持一致：
  - `server/relay.py`：NAS／伺服器版
  - `desktop/relay/MyScreenRelay.cs`：桌面版內建（約 64 KB，連接埠 52480 起，啟動時印 `LISTEN <port> <ip,...>`，`--parent <PID>` 讓主程式結束時自動關閉，也提供手機頁的 5 個檔案）
- 桌面版使用哪個 relay（`app.js` 的 `relayBase()`）：老師設定（V: settings.json）→ 學校預設（myscreen.json）→ 建置時的 `RELAY` → **內建 relay**
- 內建 relay：MyScreen 開啟時啟動（`startLocalRelay()`），關閉時結束（`windowClose` → `stopLocalRelay()`）。安裝版在程式資料夾；免安裝版內嵌在 exe 的 resources，執行時用 `Neutralino.resources.extractFile` 解出
- 手機要能連到教室電腦的校內 IP（學校確認手機、平板都在校內網域），且 Windows 防火牆要允許 `myscreen-relay.exe`（安裝程式的「允許手機連線」選項）

---

## 7. 注意事項（踩過的坑）

| 問題 | 說明 |
|---|---|
| Neutralino 每次啟動連接埠都不同 | localStorage 的來源跟著變，**每次啟動都是空的**。所以桌面版的 `LS`（`store.js`）改存 `%APPDATA%\MyScreen\prefs.json`。新增需要跨次保存的資料請用 `LS`，不要直接用 `localStorage` |
| `globalVariables` 不會跳脫反斜線 | `neutralino.config.json` 的路徑請用 `/`（例如 `%LOCALAPPDATA%/Programs/...`），程式裡再轉換；用 `\` 會產生錯誤的 JSON、畫面全白 |
| 檔案編碼 | `build.ps1`、`setup.iss` 要 **UTF-8 with BOM**（PowerShell 5.1、Inno Setup 才讀得懂中文）；`neutralino.config.json` **不能有 BOM**（neu build 會失敗）。用 PowerShell 5.1 的 `Set-Content -Encoding utf8` 會自動加 BOM，要小心 |
| 執行中的 exe 會被鎖住 | 建置、安裝前先關閉 MyScreen；安裝程式會自動關閉（`CloseApplications`） |
| 背景分頁計時器被節流 | 用瀏覽器測手機遙控時，如果分頁在背景，`setTimeout`／`requestAnimationFrame` 會被延遲，狀態看起來「慢一步」，測試時把分頁切到前景 |
| 網頁版的全螢幕與彈出視窗 | 瀏覽器只允許使用者點擊時進入全螢幕、開新視窗；從手機遙控觸發時會失敗（桌面版沒有這個限制），程式已處理成退而求其次 |
| 防火牆詢問 | 每個新位置的 `myscreen-relay.exe` 第一次監聽時 Windows 都會詢問；一般帳號無法允許。開發機上測試時會留下多筆規則，可在「Windows 安全性 → 防火牆 → 允許應用程式」清掉 |
| SheetJS | 只用 `xlsx.mini.min.js`（讀寫 xlsx／csv）；舊版 npm 上的 0.18 有安全性問題，請從 cdn.sheetjs.com 取得新版 |
| 社群網站嵌入 | Facebook／Instagram／Threads 只能嵌入公開貼文，播放器不開放外部控制 |

---

## 8. 目前狀態與待辦

### 已完成並實測

- 儲存位置（V: 資料夾、伺服器、本機）、白板清單、跨裝置同步、衝突處理
- 19 種小工具（含座位表、課堂加分），小工具放大到全螢幕
- 班級名單：Excel／CSV（含 Big5）／貼上匯入、欄位自動判斷與手動對應、學號／姓名／座號比對照片
- 手機遙控：各小工具操作、傳送網址（YouTube／影片檔／FB／IG／Threads／TikTok／Vimeo／一般網頁）
- 內建 relay：開啟 MyScreen 時啟動、關閉時結束、重開後手機自動連回
- 安裝程式：每位使用者安裝（不需系統管理員）、升級、解除安裝、`/RELAY=` 參數

### 尚未驗證（需要在學校環境測）

- [ ] **真實手機**：目前只用瀏覽器模擬手機，請在教室用手機掃 QR Code 實際測一次
- [ ] **安裝程式加入防火牆例外**：需要系統管理員權限，請資訊組以 `/ALLUSERS` 或輸入系統管理員密碼測試
- [ ] **安裝精靈的「手機遙控」頁面**：寫入設定已用 `/RELAY=` 測過，但畫面沒有實際看過
- [ ] **NAS Docker 部署**（`docker-compose.yml`）：開發機沒有 Docker，沒有實際建置過（現在有內建 relay，NAS 變成選用）
- [ ] **伺服器版連學校 SAMBA**：只測過本機模式，沒有連過真正的學校 SAMBA
- [ ] **網頁版的資料夾選擇**（File System Access 的原生對話框）沒有實際操作過

### 可以考慮的後續工作

- **程式碼簽章**：exe／安裝程式沒有簽章，第一次執行 Windows SmartScreen 可能顯示「Windows 已保護您的電腦」，需按「其他資訊 → 仍要執行」。學校大量部署前可考慮簽章，或由資訊組統一部署
- **GitHub Releases**：把安裝程式放到 Releases 方便老師下載
- **自動化測試**：目前只有 relay 的測試；前端都是手動測試
- 開發機 `V:\MyScreen\boards\test-board.json`（「測試白板（另一台電腦建立）」）是開發時建立的測試白板，可以刪除；老師自己的白板是「我的白板」

---

## 9. Git 慣例

- 分支：直接在 `main` 開發
- commit 訊息：英文、祈使句開頭（例如 `Add seating chart widget`），內文用條列說明重點
- 建置產出 `desktop/out/` 的安裝程式與 exe 會一起 commit
