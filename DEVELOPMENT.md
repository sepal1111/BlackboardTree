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
| `remote-crypto.test.mjs` | 手機遙控的加密：加密／解密、金鑰不對或內容被改過時拒絕、用手機公鑰交換金鑰、解析 QR Code 網址的 # |
| `remote-host.test.mjs` | 教室電腦端的遙控連線（用假的 WebSocket）：取得代碼、記住代碼、加密的狀態與指令、換代碼換金鑰、允許時交換金鑰、斷線重連；學生投票的開放／回覆／結束、重新連線沿用投票代碼 |
| `poll-bank.test.mjs` | 投票題目匯入（文字、Excel 貼上、Excel／CSV 的列）、題庫去除重複、投票紀錄（指紋、上限）、匯出 CSV（BOM、逗號、引號、公式開頭） |
| `ui-prefs.test.mjs` | 畫面偏好（工具列位置、圖示大小、顯示的工具）的檢查與切換 |
| `link-list.test.mjs` | 網址清單：分類標題、名稱與網址、CSV／Tab、說明行、檔名當分類（排除 Windows 的「 (1)」「 - 複製」）、Big5 編碼、重複的清單、搜尋與分組；`toEmbedUrl()`（Google 簡報／雲端硬碟 /preview、Canva ?embed） |
| `widgets.test.mjs` | 計時器時間格式、手機傳來的網址判斷（YouTube／社群網站／影片檔）、每個小工具的必要欄位、工具列圖示檔都存在、舊白板小工具升級（`upgradeWidget`）、時鐘日期的日期文字與月曆、學生投票計票（`castVote`：一人一票、改票、不能改票） |

- `tests/helpers.mjs` 模擬瀏覽器環境（`localStorage`、`window`、`document`），並提供記憶體裡的資料夾 `MemFs`（介面同 `FsaAdapter`／`NeuAdapter`，`failing = true` 可模擬斷線）
- 只測**不需要畫面**的邏輯；畫面操作（拖曳、對話框、小工具外觀）仍要用瀏覽器手動測
- 新增純邏輯（解析、格式轉換、存檔規則）時請一起加測試；被測的函式要 `export`
- 模組載入時不能碰 DOM（`document.querySelector` 等要放在函式裡），否則 Node 無法 import

### 測試內建遙控伺服器

```bash
node desktop/relay/test-relay.mjs
```

49 項協定測試（取得代碼、提供加密程式檔、新裝置要老師允許／拒絕、沒有金鑰的手機交換金鑰、加密的指令與提示原樣轉送、允許過的裝置重連不用再問、換代碼後要重新允許、等待允許最多 3 台、其他電腦不能連 `/ws/screen`、只連線不送資料 10 秒後斷線、指令轉送、斷線重連、中斷全部、8 台上限、學生投票、父程序結束自動關閉等）。要先建置過（測的是 `desktop/resources/myscreen-relay.exe`）。

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

- **`latest.json` 有數位簽章**（1.9.1 起）：`make-latest.mjs` 用發布者的私鑰（ECDSA P-256）簽「去掉 `signature` 的精簡 JSON」，黑板樹用內建的 `UPDATE_PUBLIC_KEY` 驗證，簽章不對就不更新。就算有人改了 GitHub 上的檔案，沒有私鑰也做不出能讓黑板樹安裝的版本
  - 私鑰：`%USERPROFILE%\.blackboardtree\update-signing-key.pem`（可用環境變數 `BT_SIGNING_KEY` 指定別的位置），**不能放進 git，一定要備份**（例如加密的隨身碟、密碼管理器）。遺失私鑰，已安裝的黑板樹就再也無法自動更新，只能請老師手動下載新版
  - 換電腦發布：把備份的私鑰放回上面的位置即可。沒有私鑰或私鑰和 `UPDATE_PUBLIC_KEY` 不是同一組時，`build.ps1` 的最後一步會失敗
  - 第一次（或私鑰外洩要換一組）：`node desktop/make-latest.mjs --init-key` 產生私鑰（已存在時不會覆蓋），把印出的公鑰貼到 `update.js` 的 `UPDATE_PUBLIC_KEY`。換了公鑰之後，舊版黑板樹只認舊公鑰，必須先讓大家手動更新到含新公鑰的版本
  - 測試假版本資訊時，`checkForUpdate({ publicKey })` 可以傳入測試用的公鑰（見 `tests/update.test.mjs`）
- 下載的檔案和 `latest.json` 在同一個資料夾，會比對大小與 SHA-256，不符就不更新（避免 GitHub 還在更新、檔案不完整）
- 安裝版（程式資料夾有 `unins000.exe`）：安裝程式存到 `%TEMP%`，用 PowerShell 等黑板樹結束後以 `/SILENT` 安裝，裝好後由安裝程式重新開啟（`setup.iss` 的 `IsInAppUpdate`：`/SILENT` 而不是 `/VERYSILENT` 時才開，資訊組大量部署不會開啟）；程式資料夾不能寫入（Program Files）時加 `/ALLUSERS`，會跳出 UAC
- 免安裝版：新的 exe 先存成 `BlackboardTree.exe.new`，黑板樹結束後換掉原本的檔案並重新開啟
- 測試：在 `%APPDATA%\MyScreen\prefs.json`（網頁版是瀏覽器的 localStorage）加上 `"ms:updateUrl": "\"http://127.0.0.1:8099/latest.json\""`，指到自己架的假版本資訊（要有 CORS 標頭），測完記得刪掉

| 版本 | 內容 |
|---|---|
| 2.0.0 | 以班級為主：白板有 `classId`（`store.newBoard(name, classId)`），首頁 `showClasses()` → `showBoards(classId)`；小工具的 `listId` 一律等於白板的班級（`mountWidget`）；各班資料 settings.classData（`roster.js` 的 `classData()`：pollBank、pollResults、textNotes、points），刪除班級 `dropClass()` 連同白板一起刪；題庫匯出 `bankToText()`；課堂加分 classData.points 同班共用（`saveSettings({ quiet })`）；移除 lastTools 與手動輸入名單；遙控白板清單只列同班 |
| 1.10.0 | 座位紀錄（`seat-layouts.js`，settings.seatLayouts；座位表 state.layoutId 使用中的一組自動存回）、新開座位表沿用上次的狀態（小工具定義的 `restoreLast`、settings.lastTools、`lastToolState()`）、關閉小工具時立即記錄最後狀態 |
| 1.9.1 | 資安：遙控要老師允許（`join-request`／`join-answer`）、代碼只在這次開啟有效（`SS`）、遙控內容加密（`remote-crypto.js`，tweetnacl）、relay 需要時才啟動、`/ws/screen` 只接受本機、連線數與逾時限制、iframe `sandbox`、`nativeAllowList` 縮小、`latest.json` 數位簽章；易用性：工具列文字依空間顯示（`fitDockLabels()`）、關閉小工具可復原（`offerUndo()`）、遙控視窗與儲存位置用語白話化 |
| 1.9.0 | 畫布格線與對齊（`ui-prefs.js` 的 grid／gridShow、snapMove、snapResize）；文字小工具格式工具列、文字紀錄（`text-notes.js`，settings.textNotes）、排版（`textLayout()`、直式）、注音字型（vendor/fonts）、破音字（`bpmf.js` 的選擇符與 `autoReadings()`，詞庫在 tools/bpmf） |
| 1.8.0 | 課堂加分每日紀錄（`points-log.js`，state.daily）、排行榜（累計／今天／指定區間）與匯出 CSV，歸零不清紀錄；各班使用過的工具（settings.classTools，`roster.js` 的 `recordClassTool`，設定 → 班級名單一鍵叫回）；考試時間自動縮放（`fit()` 以 em 為單位二分搜尋字體）、科目加大改深綠色 |
| 1.7.0 | 新增「考試時間」小工具（`time.js` 的 `exam`；計算在 `util.js` 的 `examStatus`、`examAttendance`，手機遙控頁共用）：各節科目與起訖時間、自動倒數、結束前提醒、停筆提示、人數統計（應到／實到／缺考座號，可連結班級名單）、手機延長時間與點選缺考；`ui.js` 新增 24 小時制 `timePicker` |
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
  js/link-list.js           網址清單：讀取白板資料夾的「網址清單*.txt」、解析分類／名稱／網址、搜尋（網頁／影片小工具的「📋 從網址清單選擇」）
  js/points-log.js          課堂加分的每日紀錄（state.daily = { 日期: { 姓名: 淨分 } }）、排行榜、匯出 CSV
  vote.html                 學生投票頁（CSS、JS 都寫在檔案內，內建 relay 只要嵌入這一個檔）
  css/app.css, remote.css
  js/app.js                 主程式：儲存位置、白板清單、小工具框、放大、手機遙控（含內建 relay 控制）
  js/store.js               存檔、離線備份、跨裝置同步；LS（這台電腦的設定，桌面版存檔案）
  js/backends/index.js      FolderBackend／LocalBackend
  js/backends/fs.js         資料夾存取：FsaAdapter（瀏覽器）、NeuAdapter（Neutralino）
  js/roster.js              班級名單：匯入 Excel/CSV/貼上、欄位對應、照片比對
  js/remote-host.js         教室電腦端的遙控連線（RemoteHost）
  js/remote.js              手機遙控頁的程式（各小工具的手機卡片 RENDER）
  js/remote-crypto.js       手機遙控的加密（教室電腦與手機共用；vendor/nacl-fast.min.js）
  js/ui.js                  h()、modal、toast、選擇圖片等共用 UI
  js/ui-prefs.js            畫面偏好（工具列位置、圖示大小、顯示的工具、畫布格線 grid／gridShow 與對齊計算 snapMove、snapResize）
  js/update.js              檢查新版本、下載並驗證、產生更新用的 PowerShell 指令
  js/widgets/               小工具：time.js、classroom.js、media.js、util.js、index.js（清單與順序）；考試時間的計算 examStatus() 在 util.js（手機遙控頁共用，內建 relay 也有嵌入）
  vendor/qrcode.js          QR Code
  vendor/xlsx.mini.min.js   SheetJS 0.20.3（讀 Excel，用到時才載入）
  js/bpmf.js                注音字型的破音字（讀音選擇符、自動判斷 autoReadings）
  js/bpmf-data.js           破音字資料（由 tools/bpmf/build.mjs 產生，不要手改）
  vendor/fonts/             注音字型（ButTaiwan bpmfvs，OFL-1.1，取自 @fontsource/bpmf-* 5.3.1 的 woff2 分塊）：注音楷體 bpmf-zihi-kai-std、注音圓體 bpmf-huninn；文字小工具用到時才載入 CSS，瀏覽器依 unicode-range 只下載用到的分塊
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
tools/bpmf/                 破音字詞庫：words.txt（常用詞，可編輯）、phonic_table_Z.txt（字型的讀音順序，Apache 2.0，見 NOTICE.txt）、build.mjs（產生 static/js/bpmf-data.js）
package.json                只有測試指令，沒有相依套件
config.example.json         網頁版伺服器設定範例：host、port、HTTPS 憑證（複製成 config.json，已被 .gitignore 排除）
start.bat, start.sh         啟動網頁版伺服器（第一次會建立 .venv）
```

---

## 5. 資料格式

都在老師選的資料夾（通常是 `V:\MyScreen`）：

```
MyScreen/
  boards/<id>.json     {id, name, classId, rev, created, updatedAt, data: {background, widgets: [...]}}
                       classId：白板屬於哪一班（2.0.0 起以班級為主）。沒有 classId 的舊白板不會顯示（檔案保留，不刪除）
  settings.json        {data: {classLists: [...], classData?, classTools?, seatLayouts?, ui?}, updatedAt}
                       classData：各班分開的資料 { [班級 id]: { pollBank?, pollResults?, textNotes?, points? } }（roster.js 的 classData()）
                         pollBank／pollResults：投票題庫與紀錄（poll-bank.js）；題庫可匯出成文字檔（bankToText），再到別班匯入
                         textNotes：文字小工具的紀錄 [{ id, html, text, at }]，最多 200 則（text-notes.js）
                         points：課堂加分 { scores, daily }，這班的每個白板共用；小工具 state 的 scores／daily 是同一份的參照
                       seatLayouts：座位表的紀錄 { [班級 id]: [{ id, label, rows, cols, seats, flip, at }] }，每班最多 30 組（seat-layouts.js）；座位表的 state.layoutId 是使用中的那一組，換座位自動存回
                       classTools：{ [班級 id]: { [小工具 type]: { state, usedAt } } }，這班的小工具最後的狀態（roster.js 的 recordClassTool，app.js 存檔後 1.5 秒記錄）；小工具定義有 restoreLast（目前是座位表）時，新開會沿用這班的狀態（lastToolState）
                       刪除班級時（roster.js 的 dropClass）這班的白板、classData、classTools、seatLayouts 一起刪除
                       1.10 以前的 pollBank、pollResults、textNotes、lastTools 放在最上層，2.0.0 起不再讀取
  網址清單*.txt        學校發給各班的網址清單（老師自己放進來，黑板樹只讀不寫；links*.txt 也可以），格式見 link-list.js 開頭與 README
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
- 工具列偏好：`setUi()` 立即套用（`applyUi()` 設定 `body[data-dock]`、`body[data-dock-labels]` 與 CSS 變數 `--dock-icon`）並存進 settings.json；位置的版面在 `app.css` 的 `body[data-dock=...]` 規則；工具列文字「自動」由 `fitDockLabels()` 量測：先顯示文字，工具列放不下（需要捲動）才設 `body[data-dock-fit=icons]` 只顯示圖示（1.9.1 以前是寬度小於 1280 或高度小於 800 就隱藏，1366×768 的教室螢幕會看不到文字；觸控螢幕沒有滑鼠停留提示）。視窗大小改變、開啟白板時重新量測（選擇白板畫面時工具列沒有顯示，量不到）。按鈕與工具列的內距跟著 `--dock-icon` 縮放
- 關閉小工具：老師按 ✕、手機遙控關閉、「全部移除」都走 `closeWidget()`／`offerUndo()`，提示列顯示「↶ 復原」10 秒（換了白板就不能復原）。程式內部取代小工具（例如手機送來新影片）直接用 `removeWidget()`，不提供復原
- 需要班級名單的小工具：參考 `classroom.js` 的 `people(ctx)`、`namesEditor()`、`watchRoster()`（設定變更時自動重畫、學生改名時更新狀態）
- 大小改變時要重排版面：用 `widgets/util.js` 的 `observeSize()`，不要直接用 ResizeObserver（會出現 ResizeObserver loop 警告）
- 小工具內的文字大小用容器單位（`cqw`、`cqh`、`cqmin`），放大到全螢幕時會自動放大
- 文字小工具的排版：狀態用螢幕方向記錄（`align` 水平、`valign` 垂直、`vertical` 直式），`media.js` 的 `textLayout()` 換算成 CSS。`.text-ed` 是直向 flex 容器，`justify-content` 管區塊方向、`text-align` 管行內方向；直式（`writing-mode: vertical-rl`，`text-orientation: upright` 讓英數字直立）時兩者對調。注音字型的 `vert` 功能會把英數字換成轉向的字形，而直排標點也靠 `vert`，不能關掉；所以直式時 `fontFamilyOf()` 在最前面加上只涵蓋英數字的 `BT Upright Serif／Sans`（`app.css` 的 `@font-face`，用 `local()` 系統字型）。破音字在 `bpmf.js`：注音 IVS 規格，字後加 U+E01E1… 是第 2…種讀音、U+E01E0 是不標注音；`readingsOf()` 把各選擇符畫到 canvas 和預設讀音比對，就知道字型裡有幾種讀音（不需要讀音資料庫）；`htmlToText()`／遙控畫面會拿掉選擇符。自動判斷在 `autoReadings()`：先套 `bpmf-data.js` 的常用詞（長詞優先），再套規則（得、地、了，以及「一」「不」變調，可在設定關閉）；老師在「音」對話框指定的字會包成 `<span class="py-m">`，自動判斷不會改它，在它後面打字時 `tidyManual()` 會把新字移出來。字型清單在 `TEXT_FONTS`（`font` 狀態；ㄅ 按鈕用 `plainFont`／`bpmfFont` 記住切換前後的字型）。置中用 `safe`，內容超過框時才捲得到開頭

### 手機遙控

```
手機 remote.html ──WebSocket /ws/remote?code=──► relay ◄──/ws/screen── 教室電腦 RemoteHost
```

- relay 只轉送 JSON，不存資料。訊息：
  - 教室電腦送出：`hello{code,secret}`、`state{state:<密文>}`、`notice{box}`、`kick`、`join-answer{id, ok, box?}`
  - 教室電腦收到：`room{code,secret}`、`remotes`、`cmd{box}`、`join-request{id, device, ip, pk}`、`join-gone`、`replaced`
  - 手機送出：`cmd{box}`，`box` 解密後是 `{target:'app'|'widget', action, args, widgetId}`
  - 手機收到：`wait`、`hello{online, state, key?}`、`state`、`screen`、`notice{box}`（relay 自己的提示是 `notice{text}`）、`kicked`、`error`
- **加密**（`static/js/remote-crypto.js`，用 `static/vendor/nacl-fast.min.js`，tweetnacl 1.0.3）：遙控網頁是 HTTP（區網沒有憑證，HTTPS 會出現警示），同一個網路的人可能側錄封包，所以白板內容、指令、提示都在手機和教室電腦之間加密，relay 只轉送看不懂的資料（HTTP 網頁不能用瀏覽器內建的 `crypto.subtle`，所以自帶程式庫）
  - 每組代碼一把隨機金鑰（`RemoteHost.key`，存在 `SS ms:remote`），換代碼就換金鑰。內容用 `seal()`／`open()`（XSalsa20-Poly1305，nonce 24 bytes 放在密文前面，base64url）
  - 掃 QR Code：金鑰在網址的 `#<代碼>.<金鑰>`，瀏覽器不會把 `#` 後面送到網路上
  - 手動輸入代碼：手機產生一次性金鑰對，連線帶 `&pk=<公鑰>`；relay 遇到 `pk` 一律詢問老師（即使裝置允許過），`join-request` 帶 `pk`；老師允許時 `answerJoin()` 用 `wrapKey()`（X25519 + XSalsa20-Poly1305）把金鑰加密成 `box`，relay 放在 `hello.key` 交給手機，手機用 `unwrapKey()` 解出
  - 手機把金鑰記在 localStorage `bt:remoteK`（`{code, key}`，只記最近一組），重新整理、斷線重連時不用再交換
  - 教室電腦只接受用這組金鑰加密的指令；沒加密、金鑰不對的 `cmd` 一律不理會
  - 擋得住側錄，擋不住假冒路由器竄改網頁程式的主動攻擊（要 HTTPS 才擋得住）；這部分靠「老師允許」把關
  - relay 的限制：`pk` 必須是 43 字 base64url、`join-answer.box` 100–200 字、加密提示最多 4000 字；`state` 加密後是 base64，比原本大約 1.33 倍，仍受單一訊息 256 KB 的限制
  - 內建 relay 要嵌入 `js/remote-crypto.js`、`vendor/nacl-fast.min.js`（`build.ps1` 的 `/resource`）；手機頁新增其他 JS 檔時也要加進去
- **新裝置要老師允許**：手機連線帶 `&key=<裝置金鑰>`（`remote.js` 的 `deviceKey()`，存在手機的 localStorage `bt:remoteKey`，16–64 字的 `[A-Za-z0-9_-]`）。這個代碼還沒允許過的金鑰：
  - relay 送手機 `wait`（手機顯示「請老師在電視上按『允許』」，這段期間 `send()` 不送指令），送教室電腦 `join-request{id, device, ip}`（`device` 由 User-Agent 判斷，例如「iPhone」「Android 手機」）
  - 教室電腦跳出「有裝置要求遙控這台電腦」（`app.js` 的 `askJoin()`），回 `join-answer{id, ok}`；relay 處理完送 `join-gone{id}` 讓對話框自己關閉
  - 允許：金鑰加入這個代碼的允許清單，之後重新整理、斷線重連都不用再問；拒絕或 60 秒沒回應：手機收到 `error`，算一次錯誤（「5 分鐘 20 次」限制）
  - 同時等待允許最多 3 台；「中斷全部並換代碼」（`kick`）會清空允許清單並拒絕等待中的裝置；教室電腦斷線也會拒絕等待中的裝置
  - 允許前手機收不到白板內容（學生照片、名單），也不能送指令
- **代碼只在這次開啟有效**：遙控代碼、投票代碼存在 `store.js` 的 `SS`（sessionStorage，桌面版重開就是新的 session），每次開啟黑板樹都換新代碼；開啟時會刪掉舊版存在 localStorage 的 `ms:remote`、`ms:voteCode`
- relay 的保護：`/ws/screen` 只接受本機（127.0.0.1）連線，校內其他電腦無法冒充教室畫面；C# 版連線 10 秒內沒送完 HTTP 標頭就斷線、同時最多 400 個連線
- 學生投票（另一組代碼，只能投票，不能遙控）：
  ```
  學生 vote.html ──WebSocket /ws/vote?code=<投票代碼>──► relay ◄──/ws/screen── 教室電腦 RemoteHost
  ```
  - 教室電腦送出：`vote-open{code?, poll}`（開放或更新題目；`code` 指定沿用上次的投票代碼，存在 `SS ms:voteCode`）、`vote-close`、`vote-ack{to, ok, text, choice}`
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
- 內建 relay：按「📱 遙控」、系統匣「手機遙控」或開放學生投票時才啟動（`ensureRemote()` → `startLocalRelay()`；1.9.1 以前是開啟黑板樹就啟動），關閉時結束（`windowClose` 或系統匣「結束」→ `quitApp()` → `stopLocalRelay()`）。收到 `IPS` 時 `onLocalIpsChanged()` 更新 QR Code 的網址
- 系統匣（`initTray()`／`updateTray()`，Neutralino `os.setTray`）：顯示 relay 狀態、手機連線數，選單可開 QR Code、結束程式。狀態有變化時（`renderRemoteBtn()`、relay 啟動／結束）呼叫 `updateTray()` 重設整個選單。Neutralino 的系統匣沒有滑鼠停留提示文字，狀態只能放在停用的選單項目裡
- 安裝版與免安裝版的 relay 位置：安裝版在程式資料夾；免安裝版內嵌在 exe 的 resources，執行時用 `Neutralino.resources.extractFile` 解出
- 手機要能連到教室電腦的校內 IP（學校確認手機、平板都在校內網域），且 Windows 防火牆要允許 `myscreen-relay.exe`（安裝程式的「允許手機連線」選項）。防火牆規則刻意不限網路類型（`profile=any`）：學校網路常被 Windows 歸類為「公用」，限制成私人網路會讓遙控失效；安全性靠老師允許、每次開啟換代碼、需要時才啟動
- 遙控是 HTTP（區網沒有憑證，無法用 HTTPS），所以內容另外加密（見上面「加密」），而且允許前不送任何白板內容

### 桌面版權限與內嵌網頁

- `desktop/neutralino.config.json` 的 `nativeAllowList` 只列出用到的 Neutralino 函式（不用 `os.*`、`filesystem.*` 萬用字元）。**新增用到的原生函式時要加進清單**，否則桌面版會出現權限錯誤（網頁版測不出來）
- 網址小工具的 iframe 有 `sandbox`（`media.js` 的 `EMBED_SANDBOX`）：可以執行網頁、全螢幕、開新視窗，但不能把整個黑板樹導到別的網址、不能自動下載

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
| 注音字型 | 更新時用 `npm pack @fontsource/bpmf-huninn`（或 bpmf-zihi-kai-std），只複製 `400.css` 用到的 woff2，並把 CSS 裡的 woff 備援拿掉；每個資料夾要保留 LICENSE（OFL） |
| 破音字詞庫 | 改 `tools/bpmf/words.txt`（格式：`詞 字=讀音 …`），再執行 `node tools/bpmf/build.mjs`；讀音寫錯或不是多音字會報錯。測試會檢查 bpmf-data.js 是否和 words.txt 一致 |
| 社群網站嵌入 | Facebook／Instagram／Threads 只能嵌入公開貼文，播放器不開放外部控制 |

---

## 8. 目前狀態與待辦

### 已完成並實測

- 儲存位置（V: 資料夾、伺服器、本機）、白板清單、跨裝置同步、衝突處理
- 16 種小工具（含座位表、課堂加分；1.2.0 移除紅綠燈、骰子，時鐘與日期合併），小工具放大到全螢幕
- 班級名單：Excel／CSV（含 Big5）／貼上匯入、欄位自動判斷與手動對應、學號／姓名／座號比對照片
- 手機遙控：各小工具操作、傳送網址（YouTube／影片檔／FB／IG／Threads／TikTok／Vimeo／一般網頁）
- 內建 relay：關閉黑板樹時結束（1.9.1 起改成需要時才啟動、每次開啟換代碼，手機要重新掃描並由老師允許）
- 安裝程式：每位使用者安裝（不需系統管理員）、升級、解除安裝（1.2.0 起安裝時不設定遙控伺服器，也移除了 `/RELAY=` 參數）
- 前端自動化測試：189 項（`npm test`）；relay 協定測試 49 項
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
