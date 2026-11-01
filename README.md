# MyScreen 教室白板

免費、自架的教室投影白板。老師用自己的 **SAMBA 帳號** 登入，白板存在個人 SAMBA 資料夾，換電腦、換教室都能接著用。

## 功能

| 類別 | 小工具 |
|---|---|
| 時間 | 計時器（時間到會閃爍、響鈴）、時鐘（數字／指針）、碼錶（可分段）、日期（民國年＋月曆） |
| 班級經營 | 隨機抽籤（不重複）、隨機分組、工作模式、紅綠燈、音量計（麥克風）、骰子、投票 |
| 內容 | 文字、畫板、圖片（可選 SAMBA 內的圖片）、QR Code、嵌入網頁（YouTube、Google 簡報）、視訊鏡頭 |

- 可以建立多個白板（例如每個班一個），也可以複製、重新命名
- 背景可選漸層、純色、格線，或用 SAMBA 裡的圖片
- **班級名單**存一次，所有白板與裝置都能載入
- 計時器、碼錶記錄的是「絕對時間」，換台電腦打開，倒數時間一樣是對的
- 快捷鍵：`H` 隱藏工具列，`F` 全螢幕
- 不登入也能用（「訪客模式」），資料只存在那台電腦的瀏覽器

## 運作方式

```
瀏覽器（教室電腦、筆電、平板）
        │  HTTP(S)
        ▼
MyScreen 伺服器（Python，放在學校任一台電腦或 NAS）
        │  SMB2/3，用老師自己的帳密連線
        ▼
SAMBA：\\伺服器\老師帳號\MyScreen\
          ├─ boards\index.json      白板清單
          ├─ boards\<代碼>.json     每個白板的內容
          ├─ settings.json          班級名單
          └─ media\                 上傳的圖片
```

瀏覽器本身無法直接連線到 SAMBA，所以需要這台小伺服器代為連線。伺服器**不會儲存老師的密碼**，只在登入期間暫存於記憶體中；伺服器重新啟動後，老師需要重新登入。

每次修改約 0.7 秒後自動存檔，其他開著同一白板的裝置每 8 秒檢查一次並自動更新。如果兩台裝置同時修改，後存檔的那台會看到提示，並載入最新版本。

## 安裝

需要 Python 3.10 以上版本。

1. 複製 `config.example.json` 為 `config.json`，修改 `smb` 區段：

   ```json
   "smb": {
     "server": "192.168.1.10",   // SAMBA 主機 IP 或名稱
     "port": 445,
     "share": "{username}",      // 分享資料夾名稱，{username} 會換成登入帳號
     "domain": "",               // 若使用 AD 網域帳號，填入網域名稱
     "encrypt": false
   }
   ```

   常見的 `share` 設定：
   - 每位老師各自有一個分享資料夾（Samba 的 `[homes]`）：`"{username}"`
   - 所有老師共用一個分享資料夾，底下各有個人資料夾：`"share": "teachers"`，並將 `data_dir` 設為 `"{username}/MyScreen"`、`browse_root` 設為 `"{username}"`

2. 執行：
   - Windows：雙擊 `start.bat`（第一次會自動安裝相依套件）
   - Linux / NAS：`sh start.sh`

3. 用瀏覽器開啟 `http://伺服器IP:8080`

### 其他設定（`config.json`）

| 欄位 | 說明 |
|---|---|
| `data_dir` | 白板資料存放在分享資料夾中的哪個子資料夾，預設為 `MyScreen` |
| `browse_root` | 「選擇圖片」時可以瀏覽的根目錄，預設為整個分享資料夾 |
| `session_hours` | 登入有效時間，預設 12 小時 |
| `mode: "local"` | 不使用 SAMBA，資料存在 `local.root`。`local.users` 可設定 `{"帳號":"密碼"}`；留空則只要輸入名稱即可登入（適合單一教室或測試用）。`root` 也可以填 UNC 路徑，例如 `\\\\nas\\teachers\\{username}` |

## ⚠️ 麥克風與鏡頭需要 HTTPS

瀏覽器只允許 `https://` 或 `localhost` 的網頁使用麥克風（音量計）與鏡頭。若從其他電腦以 `http://192.168.x.x:8080` 開啟，這兩個小工具將無法使用。解決方法：

1. 使用 [mkcert](https://github.com/FiloSottile/mkcert) 產生憑證，並在各台電腦上安裝根憑證：
   ```
   mkcert -install
   mkcert 192.168.1.20 myscreen.local
   ```
2. 在 `config.json` 填入：
   ```json
   "ssl_certfile": "192.168.1.20+1.pem",
   "ssl_keyfile": "192.168.1.20+1-key.pem"
   ```

啟用 HTTPS 也能保護老師登入時傳送的 SAMBA 密碼，建議在正式使用時開啟。

## 檔案結構

```
server/app.py        API 與靜態檔案伺服器（FastAPI）
server/storage.py    儲存層：SAMBA（smbprotocol）或本機資料夾
static/              前端（原生 JavaScript，不需要編譯）
  js/app.js          主程式：白板、拖曳、工具列
  js/store.js        存檔與跨裝置同步
  js/widgets/        各個小工具
```

新增小工具：在 `static/js/widgets/` 中新增一個物件 `{ type, title, icon, size, state(), mount(body, ctx) }`，並加入 `widgets/index.js` 的清單。
