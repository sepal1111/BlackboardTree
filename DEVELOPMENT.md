# 黑板樹開發交接文件

給接手開發的人（或換一台電腦繼續開發時）看的說明。使用方式請看 [README.md](README.md)。

最後更新：2026-11-02（commit `48c30ac` 之後）

---

## 1. 專案概要

免費的教室投影白板（類似 classroomscreen.com），給學校老師使用：

- 白板資料存在老師個人資料夾 `V:\MyScreen`（學校的「網路磁碟機」程式會把個人資料夾連到 V:），換電腦、換教室都能接著用
- 主要使用方式是 **Windows 桌面版**（Neutralino），也有網頁版
- 老師可以用手機／平板遙控教室電腦（接大電視）上的白板

### 兩種執行方式

| 方式 | 說明 | 儲存 |
|---|---|---|
| 桌面版（主要） | `desktop/` 打包成 `BlackboardTree.exe` 與安裝程式 | 直接讀寫 `V:\MyScreen`，或老師選的其他資料夾 |
| 網頁版 | `server/app.py`（FastAPI，提供網頁與 relay）或只放 `static/` | 瀏覽器 File System Access API 選資料夾 |

兩種方式讀寫**同一種資料格式**，可以混用。白板一律由老師選擇儲存位置（資料夾，或只存在這台電腦）；**伺服器不存白板**。

> **名稱**：1.6.0 由 MyScreen 改名為「黑板樹 Blackboard Tree」。為了讓舊版順利升級，下列內部名稱**刻意保留** MyScreen，不要改：
>
> | 保留的名稱 | 原因 |
> |---|---|
> | 資料夾 `V:\MyScreen`（`DATA_DIR`） | 改了老師會找不到原本的白板 |
> | `%APPDATA%\MyScreen\prefs.json`、localStorage／IndexedDB 的 `ms:`、`myscreen` | 遙控代碼、離線備份存在這裡 |
> | `myscreen-relay.exe` | 防火牆例外綁定這個程式路徑，改名後已升級的電腦手機會連不上 |
> | 安裝程式的 `AppId`、`applicationId: tw.edu.myscreen` | AppId 改了會變成另一套程式，無法覆蓋升級 |
>
> GitHub repo 在 1.6.1 由 `sepal1111/MyScreen` 改名為 `sepal1111/BlackboardTree`。1.5.0、1.6.0 檢查更新用的是舊網址，靠 GitHub 自動轉址到新 repo，所以**不要再建立名為 MyScreen 的 repo**（會讓轉址失效，舊版就收不到更新）。
>
> 安裝程式在升級時刪除舊的 `MyScreen.exe`、「MyScreen 教室白板」捷徑與開始功能表資料夾（`[InstallDelete]`），防火牆規則改名為 `Blackboard Tree Remote`（加入或解除安裝時一併刪除舊的 `MyScreen Remote`）。

> 1.4.0 移除了「學校帳號登入」（伺服器用 SAMBA 帳號代存白板）、NAS 遙控伺服器設定（老師設定、`myscreen.json` 學校預設、建置時的 `RELAY`、Docker 部署），以及「開啟網路磁碟機程式」按鈕。需要參考舊程式時看 `v1.3.0` 標籤。

---

## 2. 在新電腦建立開發環境

### 需要安裝

| 工具 | 用途 | 備註 |
|---|---|---|
| Git | 取得原始碼 | |
| Python 3.10 以上（目前用 3.12） | 本機測試伺服器（瀏覽器測試用） | |
| Node.js 22 以上（目前用 24） | 桌面版建置、前端與 relay 測試 | 第一次建置要網路（下載 Neutralino、`resedit`） |
| Inno Setup 6 | 產生安裝程式 | 選用；沒裝只會產生免安裝版。可裝在 `%LOCALAPPDATA%\Programs\Inno Setup 6`（不需系統管理員），`build.ps1` 會自動找 |
| .NET Framework 4（`csc.exe`） | 編譯內建遙控伺服器 | **Windows 10／11 內建**，不用安裝 |

### 步驟

```bash
git clone https://github.com/sepal1111/BlackboardTree.git
cd BlackboardTree
```

```bash
py -3 -m venv .venv
```

```bash
.venv\Scripts\python -m pip install -r requirements.txt
```

（或直接雙擊 `start.bat`，第一次會自動建立 `.venv` 並安裝套件。）

---

## 3. 日常開發流程

### 網頁介面：用瀏覽器測（最快）

```bash
.venv\Scripts\python server\app.py
```

開啟 `http://localhost:8080`：

- 「網路磁碟機或資料夾」：選任何資料夾測試（`localhost` 才能使用資料夾存取）
- 「只存在這台電腦」：資料在瀏覽器 localStorage
- 手機遙控頁：`http://localhost:8080/remote.html`（這個伺服器也內含 relay）
- 學生投票頁：在投票小工具按「📱 學生投票」後，用顯示的網址開啟（`/vote.html#<投票代碼>`）。改了 `server/relay.py` 要重新啟動伺服器

前端是**原生 ES modules，沒有編譯步驟**，改完重新整理即可。

> Claude Code 使用者：`.claude/launch.json` 已設定好名為 `blackboard-tree` 的預覽伺服器。

### 桌面版：建置後執行

```bash
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

產出 `desktop\out\BlackboardTree.exe`（免安裝版）與 `desktop\out\BlackboardTree-Setup-<版本>.exe`（安裝程式）。沒有熱重載，改程式後要重新建置。

**注意**：
- 建置前要先**關閉正在執行的黑板樹**（exe 會被鎖住，`build.ps1` 會提示）
- 請用 **PowerShell** 執行 `build.ps1`；從 Git Bash 呼叫 `csc.exe` 時參數會被路徑轉換弄壞
- 桌面版沒有開發者工具（`enableInspector: false`）。除錯時可暫時在 `desktop/neutralino.config.json` 改成 `true`，畫面左下角也會顯示 JS 錯誤（`index.html` 的 `msFatal`）

### 前端自動化測試

```bash
npm test
```

用 Node 內建的測試工具（`node --test`），**不需要安裝任何套件**，也不用開瀏覽器，約 1 秒跑完。測試在 `tests/`，直接 import `static/js` 的模組：

| 檔案 | 測什麼 |
|---|---|
| `roster.test.mjs` | 名單匯入的欄位自動判斷、貼上文字解析、照片檔名比對（學號／姓名／座號）、學生改名時小工具狀態跟著改 |
| `store.test.mjs` | `V:\MyScreen` 檔案格式、rev 與衝突（409）、兩台電腦同時修改、網路磁碟機斷線時的離線備份與補存、其他電腦的修改（poll）、舊格式名單 |
| `remote-host.test.mjs` | 教室電腦端的遙控連線（用假的 WebSocket）：取得代碼、記住代碼、指令、斷線重連；學生投票的開放／回覆／結束、重新連線沿用投票代碼 |
| `poll-bank.test.mjs` | 投票題目匯入（文字、Excel 貼上、Excel／CSV 的列）、題庫去除重複、投票紀錄（指紋、上限）、匯出 CSV（BOM、逗號、引號、公式開頭） |
| `ui-prefs.test.mjs` | 畫面偏好（工具列位置、圖示大小、顯示的工具）的檢查與切換 |
| `widgets.test.mjs` | 計時器時間格式、手機傳來的網址判斷（YouTube／社群網站／影片檔）、每個小工具的必要欄位、工具列圖示檔都存在、舊白板小工具升級（`upgradeWidget`）、時鐘日期的日期文字與月曆、學生投票計票（`castVote`：一人一票、改票、不能改票） |

- `tests/helpers.mjs` 模擬瀏覽器環境（`localStorage`、`window`、`document`），並提供記憶體裡的資料夾 `MemFs`（介面同 `FsaAdapter`／`NeuAdapter`，`failing = true` 可模擬斷線）
- 只測**不需要畫面**的邏輯；畫面操作（拖曳、對話框、小工具外觀）仍要用瀏覽器手動測
- 新增純邏輯（解析、格式轉換、存檔規則）時請一起加測試；被測的函式要 `export`
- 模組載入時不能碰 DOM（`document.querySelector` 等要放在函式裡），否則 Node 無法 import

### 測試內建遙控伺服器

```bash
node desktop/relay/test-relay.mjs
```

33 項協定測試（取得代碼、指令轉送、斷線重連、中斷全部、8 台上限、學生投票、父程序結束自動關閉等）。要先建置過（測的是 `desktop/resources/myscreen-relay.exe`）。

### 版本號與發佈

版本號用三段數字 **主版本.次版本.修正版**（例如 `1.1.0`）：

| 哪一段 | 什麼時候加 1 | 例子 |
|---|---|---|
| 主版本 | `V:\MyScreen` 資料格式改了，舊版程式讀不懂新版存的白板 | `1.4.2` → `2.0.0` |
| 次版本 | 新功能，舊資料照樣能用 | `1.0.0` → `1.1.0`（系統匣、IP 自動更新） |
| 修正版 | 只修錯誤 | `1.1.0` → `1.1.1` |

- 老師會在不同教室的電腦間移動，主版本相同就代表白板在各台電腦都能互通
- 只能是三段數字（不要加 `-beta` 等字尾）：`patch-exe.mjs` 只讀前三段寫進 exe，Windows 每段最大 65535。`build.ps1` 會檢查格式

步驟：

1. 改 `desktop/neutralino.config.json` 的 `version`（安裝程式檔名、exe 版本資訊都會跟著變）
2. **先**更新 `RELEASE.md`：標題與檔名的版本號、「從舊版升級」會注意到的變化、「## 版本紀錄」最上面加一段 `### 1.5.0`（給老師、資訊組看，用一般老師看得懂的說法）；`DEVELOPMENT.md` 的版本表也加一列。**要在建置前寫好**：`build.ps1` 會把版本紀錄寫進 `latest.json`，「關於與更新」顯示的更新內容就是這一段
3. 執行 `build.ps1`（會自動刪除 `out\` 裡舊版本的安裝程式，最後產生 `out\latest.json`：版本號、各版本的更新內容、兩個 exe 的大小與 SHA-256）
4. `desktop/out/` 的安裝程式、`BlackboardTree.exe` 與 `latest.json` **有放進 git**（`.gitignore` 只排除執行時產生的 `.tmp`、`myscreen-relay.exe`、log），commit 時會一起更新。**push 到 GitHub 的 main 之後，各校的黑板樹就會檢查到新版本**（讀 `raw.githubusercontent.com/sepal1111/BlackboardTree/main/desktop/out/latest.json`，GitHub 快取最多 5 分鐘），所以還沒測好的版本不要 push 到 main
5. commit 後打標籤：`git tag -a v1.1.0 -m "黑板樹 1.1.0"`，以後才查得到每個版本對應的程式碼；推送用 `git push --follow-tags`
6. 在 GitHub 的 Releases 頁面建立新版本：選剛推上去的標籤，說明貼上 `RELEASE.md` 該版本的「版本紀錄」與下載說明，並把 `desktop/out/` 的兩個 exe 上傳到 Assets

檢查更新的運作方式（`static/js/update.js`）：

- 下載的檔案和 `latest.json` 在同一個資料夾，會比對大小與 SHA-256，不符就不更新（避免 GitHub 還在更新、檔案不完整）
- 安裝版（程式資料夾有 `unins000.exe`）：安裝程式存到 `%TEMP%`，用 PowerShell 等黑板樹結束後以 `/SILENT` 安裝，裝好後由安裝程式重新開啟（`setup.iss` 的 `IsInAppUpdate`：`/SILENT` 而不是 `/VERYSILENT` 時才開，資訊組大量部署不會開啟）；程式資料夾不能寫入（Program Files）時加 `/ALLUSERS`，會跳出 UAC
- 免安裝版：新的 exe 先存成 `BlackboardTree.exe.new`，黑板樹結束後換掉原本的檔案並重新開啟
- 測試：在 `%APPDATA%\MyScreen\prefs.json`（網頁版是瀏覽器的 localStorage）加上 `"ms:updateUrl": "\"http://127.0.0.1:8099/latest.json\""`，指到自己架的假版本資訊（要有 CORS 標頭），測完記得刪掉

| 版本 | 內容 |
|---|---|
| 1.6.3 | 新 Logo（`static/logo.svg`）：`make-icons.mjs` 產生 exe／安裝程式／視窗／系統匣圖示，開始畫面、關於與更新、分頁圖示也用它 |
| 1.6.2 | 第一版正式釋出：`RELEASE.md` 改寫成完整的發布說明（功能介紹、系統需求、安裝、大量部署、常見問題），最後保留「## 版本紀錄」給 `make-latest.mjs` 讀取 |
| 1.6.1 | GitHub repo 改名為 `sepal1111/BlackboardTree`，檢查更新改用新網址（舊版靠 GitHub 轉址） |
| 1.6.0 | 改名為「黑板樹 Blackboard Tree」：視窗、捷徑、安裝程式（`BlackboardTree-Setup-*.exe`）、exe（`BlackboardTree.exe`）、手機頁面；資料夾等內部名稱保留 MyScreen（見第 1 節）；升級時刪除舊檔名與捷徑；程式內更新改由安裝程式重新開啟（`IsInAppUpdate`） |
| 1.5.0 | ⚙ 設定新增「ℹ 關於與更新」：檢查 GitHub 上的新版本、顯示更新內容、一鍵下載並更新（安裝版靜默安裝、免安裝版直接替換），開啟時自動檢查（一天一次）；`build.ps1` 產生 `out/latest.json` |
| 1.4.0 | 工具列文字（自動／顯示／隱藏，自動：視窗小於 1280×800 時只顯示圖示）、新增「迷你」工具大小，按鈕間距跟著工具大小縮放；移除「學校帳號登入」（SAMBA）、NAS 遙控伺服器設定與 Docker 部署、「開啟網路磁碟機程式」按鈕 |
| 1.3.0 | 投票題庫（存題目、重複使用、從文字／Excel／CSV 匯入）、投票紀錄（結束投票、歸零、換題目時自動記錄，可匯出 CSV）、⚙ 設定新增「📊 投票」分頁 |
| 1.2.0 | ⚙ 總設定（白板、班級名單、工具列位置／圖示大小／顯示的工具）、座位表照片保持 1:1.35（空間不夠時保留上方、最多裁到 1:1）、安裝精靈移除遙控伺服器設定頁與 `/RELAY=` 參數；移除紅綠燈、骰子，時鐘與日期合併成「時鐘日期」（舊白板開啟時由 `upgradeWidget` 自動轉換）；工具列改用自訂 SVG 圖示；學生用手機掃 QR Code 投票（relay 新增 `/ws/vote`） |
| 1.1.0 | 系統匣圖示（遙控伺服器狀態、QR Code、結束）、網路變動時自動更新 IP、前端自動化測試 |
| 1.0.0 | 第一個安裝程式版本 |

---

## 4. 檔案結構

```
static/                     前端（桌面版、網頁版共用）
  index.html                主畫面；<!-- desktop-scripts --> 由 build.ps1 換成 neutralino.js
  logo.svg                  黑板樹 Logo（唯一來源：畫面上的 Logo，以及建置時產生的所有圖示）
  remote.html               手機遙控頁
  js/poll-bank.js           投票題庫、匯入題目、投票紀錄與匯出
  vote.html                 學生投票頁（CSS、JS 都寫在檔案內，內建 relay 只要嵌入這一個檔）
  css/app.css, remote.css
  js/app.js                 主程式：儲存位置、白板清單、小工具框、放大、手機遙控（含內建 relay 控制）
  js/store.js               存檔、離線備份、跨裝置同步；LS（這台電腦的設定，桌面版存檔案）
  js/backends/index.js      FolderBackend／LocalBackend
  js/backends/fs.js         資料夾存取：FsaAdapter（瀏覽器）、NeuAdapter（Neutralino）
  js/roster.js              班級名單：匯入 Excel/CSV/貼上、欄位對應、照片比對
  js/remote-host.js         教室電腦端的遙控連線（RemoteHost）
  js/remote.js              手機遙控頁的程式（各小工具的手機卡片 RENDER）
  js/ui.js                  h()、modal、toast、選擇圖片等共用 UI
  js/ui-prefs.js            畫面偏好（工具列位置、圖示大小、顯示的工具）
  js/update.js              檢查新版本、下載並驗證、產生更新用的 PowerShell 指令
  js/widgets/               小工具：time.js、classroom.js、media.js、util.js、index.js（清單與順序）
  vendor/qrcode.js          QR Code
  vendor/xlsx.mini.min.js   SheetJS 0.20.3（讀 Excel，用到時才載入）
server/
  app.py                    網頁版伺服器（FastAPI）：靜態網頁、relay、/api/config（校內 IP）
  relay.py                  手機遙控、學生投票轉送（網頁版用；桌面版用 C# 版）
desktop/
  neutralino.config.json    桌面版設定（版本、globalVariables、允許的 API）
  build.ps1                 建置腳本（UTF-8 BOM，見「注意事項」）
  patch-exe.mjs             把圖示與版本資訊寫進 exe（resedit）
  make-latest.mjs           產生 out/latest.json（新版本資訊，「關於與更新」讀這個檔）
  make-icons.mjs            由 static/logo.svg 產生 icon.png（視窗、工作列、系統匣）與 installer/icon.ico（exe、安裝程式）；換 Logo 只要換 logo.svg 再建置
  relay/BlackboardTreeRelay.cs 內建遙控伺服器（C#，Windows 內建 .NET Framework 編譯）
  relay/test-relay.mjs      relay 測試
  installer/setup.iss       Inno Setup 安裝腳本（UTF-8 BOM）
  installer/ChineseTraditional.isl, icon.ico
  out/                      建置產出（安裝程式、免安裝版、latest.json，有放進 git）
tests/                      前端自動化測試（npm test）
package.json                只有測試指令，沒有相依套件
config.example.json         網頁版伺服器設定範例：host、port、HTTPS 憑證（複製成 config.json，已被 .gitignore 排除）
start.bat, start.sh         啟動網頁版伺服器（第一次會建立 .venv）
```

---

## 5. 資料格式

都在老師選的資料夾（通常是 `V:\MyScreen`）：

```
MyScreen/
  boards/<id>.json     {id, name, rev, created, updatedAt, data: {background, widgets: [...]}}
  settings.json        {data: {classLists: [...], ui?, pollBank?, pollResults?}, updatedAt}
  media/               上傳的圖片、學生照片（照片縮成約 270×360 JPEG）
```

- **小工具**：`{id, type, x, y, w, h, z, state}`，位置與大小是「佔畫面的比例」（0～1）
- **衝突處理**：寫入時帶 `baseRev`，和檔案的 `rev` 不同就拒絕（409），前端載入最新版並提示
- **班級名單**：`classLists: [{id, name, students: [{no, sid, name, photo?}], names}]`
  - `no` 座號（兩位數字串）、`sid` 學號、`photo` 圖片參照
  - `names` 是給舊版程式讀的，存檔時自動由 `students` 產生
- **圖片參照**：`{kind:'file', base:'data'|'root', path}`、`{kind:'data'|'url', url}`（`{kind:'smb', path}` 是舊格式，等同 root）
- **relay**：1.3 以前老師自己設定的遙控伺服器網址；1.4.0 起不再使用（舊資料留著也沒關係）
- **ui**：畫面偏好 `{dock: 'bottom'|'top'|'left'|'right', icon: 'xs'|'s'|'m'|'l'|'xl', labels: 'auto'|'show'|'hide', hidden: [小工具 type]}`（選填）。讀取時一律經過 `ui-prefs.js` 的 `normalizeUi()`：不認得的值改回預設、不存在的小工具去掉、全部隱藏時改回全部顯示
- **這台電腦上的資料**（不在 V:）：
  - 網頁版：瀏覽器 localStorage
  - 桌面版：`%APPDATA%\MyScreen\prefs.json`（遙控代碼、上次用的班級、V: 斷線時的離線備份等）

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

- 手機遙控的畫面：在 `static/js/remote.js` 的 `RENDER` 加上同名函式；要讓手機能加入這個小工具，加到 `app.js` 的 `remoteState()` 裡 `addable` 清單（老師在設定中隱藏的工具會自動排除）
- 工具列圖示：放一個 `static/icons/tools/<type>.svg`（正方形，例如 512×512）。`icon` 的 emoji 仍要填：手機遙控的下拉選單、小工具標題列，以及圖檔載入失敗時都會用到。設計原稿在根目錄 `icons/`（中文檔名）
- 新的小工具會自動出現在「⚙ 設定 → 工具列 → 要顯示的工具」，不用另外處理
- 移除小工具或改狀態格式時，在 `widgets/index.js` 的 `upgradeWidget()` 處理舊白板的資料（回傳 `null` 代表移除）。開啟白板時（`openBoard`）會先跑過一次，例如 1.2.0 把 `calendar` 轉成 `clock`、刪掉 `dice`／`traffic`

### 總設定（⚙ 設定）

- `app.js` 的 `settingsDialog(tab)`：分頁 `board`（白板）、`roster`（班級名單）、`dock`（工具列）、`poll`（投票）、`about`（關於與更新）。要加新分頁：在 `SETTING_TABS` 加一項，並在 `render()` 的對照表加上畫面函式
- 白板操作（`switchBoard`、`newBoardAction`、`renameBoardAction`、`copyBoardAction`、`deleteBoardAction`）由上方白板選單與設定畫面共用
- 工具列偏好：`setUi()` 立即套用（`applyUi()` 設定 `body[data-dock]`、`body[data-dock-labels]` 與 CSS 變數 `--dock-icon`）並存進 settings.json；位置的版面在 `app.css` 的 `body[data-dock=...]` 規則；工具列文字「自動」用 media query（寬度小於 1280 或高度小於 800 時隱藏），按鈕與工具列的內距跟著 `--dock-icon` 縮放
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
- 學生投票（另一組代碼，只能投票，不能遙控）：
  ```
  學生 vote.html ──WebSocket /ws/vote?code=<投票代碼>──► relay ◄──/ws/screen── 教室電腦 RemoteHost
  ```
  - 教室電腦送出：`vote-open{code?, poll}`（開放或更新題目；`code` 指定沿用上次的投票代碼，存在 `LS ms:voteCode`）、`vote-close`、`vote-ack{to, ok, text, choice}`
  - 教室電腦收到：`vote-room{code, voters}`（`code` 為空代表已結束）、`voters{count}`、`vote{from, name, choice}`
  - 學生送出：`vote{name, choice}`（其他訊息一律忽略）；學生收到：`poll{poll, online}`、`ack`、`screen`、`closed`、`error`
  - relay 把名字截到 20 字、`choice` 轉成整數，每個投票最多 200 人；錯誤代碼與遙控共用「5 分鐘 20 次」的限制
  - 前端：`RemoteHost.openPoll()／closePoll()`，`app.js` 的 `voteApi(w)` 提供給小工具（`ctx.vote.open/update/close/info/watch`），學生的票由 `onStudentVote()` 交給開放中那個投票小工具的 `inst.vote(name, choice)`，計票在 `classroom.js` 的 `castVote()`
  - QR Code 的網址（`RemoteHost.publicBase`）：桌面版用內建 relay 回報的 IP；網頁版若用 localhost 開啟，改用 `/api/config` 的 `lanIps`（`server/app.py` 的 `lan_ips()`；伺服器只聽 127.0.0.1 時不提供），手機遙控與學生投票共用
  - 題庫與投票紀錄（`static/js/poll-bank.js`）：存在 settings.json 的 `pollBank`、`pollResults`（新的在前，最多 500 筆）。`renderPollLibrary()` 同時用在投票小工具的「📚 題庫」與「⚙ 設定 → 📊 投票」。投票小工具的 `recordResult()` 在結束投票、歸零、換題目前自動記錄；`s.recordedSig`（`resultSig()`）避免同一個結果重複記錄
  - 匯出檔案用 `ui.js` 的 `saveTextFile()`：桌面版跳出「另存新檔」（Neutralino `os.showSaveDialog` + `filesystem.writeFile`），網頁版直接下載
  - 同一時間只有一個投票小工具開放；刪除小工具、換白板、回到白板清單時自動結束投票
- relay 有兩種實作，協定必須保持一致：
  - `server/relay.py`：網頁版（`server/app.py`）
  - `desktop/relay/BlackboardTreeRelay.cs`：桌面版內建（約 64 KB，連接埠 52480 起，啟動時印 `LISTEN <port> <ip,...>`，之後每 5 秒檢查網路，IP 變了就印 `IPS <ip,...>`；`--parent <PID>` 讓主程式結束時自動關閉，也提供手機頁與學生投票頁共 6 個檔案）
- 使用哪個 relay（`app.js` 的 `relayBase()`）：桌面版一律用**內建 relay**；網頁版用提供網頁的 `server/app.py`（只放 `static/` 時沒有遙控）
- 內建 relay：黑板樹開啟時啟動（`startLocalRelay()`），關閉時結束（`windowClose` 或系統匣「結束」→ `quitApp()` → `stopLocalRelay()`）。收到 `IPS` 時 `onLocalIpsChanged()` 更新 QR Code 的網址
- 系統匣（`initTray()`／`updateTray()`，Neutralino `os.setTray`）：顯示 relay 狀態、手機連線數，選單可開 QR Code、結束程式。狀態有變化時（`renderRemoteBtn()`、relay 啟動／結束）呼叫 `updateTray()` 重設整個選單。Neutralino 的系統匣沒有滑鼠停留提示文字，狀態只能放在停用的選單項目裡
- 安裝版與免安裝版的 relay 位置：安裝版在程式資料夾；免安裝版內嵌在 exe 的 resources，執行時用 `Neutralino.resources.extractFile` 解出
- 手機要能連到教室電腦的校內 IP（學校確認手機、平板都在校內網域），且 Windows 防火牆要允許 `myscreen-relay.exe`（安裝程式的「允許手機連線」選項）

---

## 7. 注意事項（踩過的坑）

| 問題 | 說明 |
|---|---|
| Neutralino 每次啟動連接埠都不同 | localStorage 的來源跟著變，**每次啟動都是空的**。所以桌面版的 `LS`（`store.js`）改存 `%APPDATA%\MyScreen\prefs.json`。新增需要跨次保存的資料請用 `LS`，不要直接用 `localStorage` |
| `globalVariables` 不會跳脫反斜線 | `neutralino.config.json` 的路徑請用 `/`，程式裡再轉換；用 `\` 會產生錯誤的 JSON、畫面全白 |
| 檔案編碼 | `build.ps1`、`setup.iss` 要 **UTF-8 with BOM**（PowerShell 5.1、Inno Setup 才讀得懂中文）；`neutralino.config.json` **不能有 BOM**（neu build 會失敗）。用 PowerShell 5.1 的 `Set-Content -Encoding utf8` 會自動加 BOM，要小心 |
| 執行中的 exe 會被鎖住 | 建置、安裝前先關閉黑板樹；安裝程式會自動關閉（`CloseApplications`） |
| 背景分頁計時器被節流 | 用瀏覽器測手機遙控時，如果分頁在背景，`setTimeout`／`requestAnimationFrame` 會被延遲，狀態看起來「慢一步」，測試時把分頁切到前景 |
| 網頁版的全螢幕與彈出視窗 | 瀏覽器只允許使用者點擊時進入全螢幕、開新視窗；從手機遙控觸發時會失敗（桌面版沒有這個限制），程式已處理成退而求其次 |
| 防火牆詢問 | 每個新位置的 `myscreen-relay.exe` 第一次監聽時 Windows 都會詢問；一般帳號無法允許。開發機上測試時會留下多筆規則，可在「Windows 安全性 → 防火牆 → 允許應用程式」清掉 |
| SheetJS | 只用 `xlsx.mini.min.js`（讀寫 xlsx／csv）；舊版 npm 上的 0.18 有安全性問題，請從 cdn.sheetjs.com 取得新版 |
| 社群網站嵌入 | Facebook／Instagram／Threads 只能嵌入公開貼文，播放器不開放外部控制 |

---

## 8. 目前狀態與待辦

### 已完成並實測

- 儲存位置（V: 資料夾、伺服器、本機）、白板清單、跨裝置同步、衝突處理
- 16 種小工具（含座位表、課堂加分；1.2.0 移除紅綠燈、骰子，時鐘與日期合併），小工具放大到全螢幕
- 班級名單：Excel／CSV（含 Big5）／貼上匯入、欄位自動判斷與手動對應、學號／姓名／座號比對照片
- 手機遙控：各小工具操作、傳送網址（YouTube／影片檔／FB／IG／Threads／TikTok／Vimeo／一般網頁）
- 內建 relay：開啟黑板樹時啟動、關閉時結束、重開後手機自動連回
- 安裝程式：每位使用者安裝（不需系統管理員）、升級、解除安裝（1.2.0 起安裝時不設定遙控伺服器，也移除了 `/RELAY=` 參數）
- 前端自動化測試：94 項（`npm test`）；relay 協定測試 33 項
- 投票題庫、匯入、投票紀錄與匯出：已用瀏覽器操作過（網頁版下載 CSV）
- 學生投票：已用瀏覽器模擬老師與兩位學生實際操作（投票、改票、改題目、結束投票），C# 與 Python 兩個 relay 都測過
- ⚙ 總設定：白板、班級名單、工具列（位置、圖示大小、顯示的工具），已用瀏覽器實際操作過

### 尚未驗證（需要在學校環境測）

- [ ] **系統匣選單**：已確認圖示有註冊到 Windows、關閉視窗時 relay 一起結束；選單內容與點選動作（顯示 QR Code、結束）還沒有實際點過
- [ ] **網路變動時更新 IP**（`IPS`）：開發機沒有實際切換過網路
- [ ] **真實手機**：目前只用瀏覽器模擬手機，請在教室用手機掃 QR Code 實際測一次（手機遙控與學生投票）
- [ ] **桌面版匯出投票紀錄**（「另存新檔」對話框）：只測過網頁版的下載
- [ ] **全班同時投票**：只測過 2 位學生，還沒測過 30 人同時連線
- [ ] **安裝程式加入防火牆例外**：需要系統管理員權限，請資訊組以 `/ALLUSERS` 或輸入系統管理員密碼測試
- [ ] **網頁版的資料夾選擇**（File System Access 的原生對話框）沒有實際操作過

### 可以考慮的後續工作

- **程式碼簽章**：exe／安裝程式沒有簽章，第一次執行 Windows SmartScreen 可能顯示「Windows 已保護您的電腦」，需按「其他資訊 → 仍要執行」。學校大量部署前可考慮簽章，或由資訊組統一部署
- **GitHub Releases**：把安裝程式放到 Releases 方便老師下載
- **自動化測試**：已有前端邏輯（`npm test`）與 relay 的測試；還沒有的：畫面操作（可考慮 Playwright）、`server/` 的 Python 伺服器與 `server/relay.py`（`test-relay.mjs` 目前只測桌面版內建的 C# relay，可以改成也能指定網址測 Python 版，確保兩邊協定一致）
- 開發機 `V:\MyScreen\boards\test-board.json`（「測試白板（另一台電腦建立）」）是開發時建立的測試白板，可以刪除；老師自己的白板是「我的白板」

---

## 9. Git 慣例

- 分支：直接在 `main` 開發
- commit 訊息：英文、祈使句開頭（例如 `Add seating chart widget`），內文用條列說明重點
- 建置產出 `desktop/out/` 的安裝程式與 exe 會一起 commit
