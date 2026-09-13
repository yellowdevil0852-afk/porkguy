# 豬肉戰士 PORKGUY

一個用 three.js 寫的雙人戰棋 RPG，全部塞在**一個 HTML 檔**裡 —— 模型、貼圖、函式庫、
連線程式全都 base64 內嵌，雙擊就能玩，不用架伺服器也不用裝任何東西。

## 直接玩

**<https://yellowdevil0852-afk.github.io/porkguy/>**

同一台電腦輪流出手，或按〔線上對戰〕開房間，把 6 碼房號給朋友，
他開同一個網址輸入房號就連上了 —— 走 WebRTC 點對點，遊戲資料不經過任何伺服器。

想離線玩就下載 [`porkguy.html`](porkguy.html) 雙擊打開，本機對戰完全不需要網路。

## 玩法

- 兩軍各從五個職業（騎士／遊俠／法師／牧師／狂戰士）**挑三個**組隊
- 移動和行動分開，可以先全部走位看清楚局面再決定誰出手
- 打怪升級、撿裝備、學技能：**90 個技能**分五個品質，三個主動槽 + 一個被動槽
- 分解成精球，三顆合成一個高一階的技能或裝備
- 佔住正中央的王座**連續 5 個回合**獲勝，或讓對方三個英雄同時倒下
- 隨時可以開 AI 對手單人玩

詳細規則在遊戲裡的〔說明〕，技能設計表在 [`skills.md`](skills.md)。

## 建置

```bash
node build.js
```

產出 `porkguy.html`（單一檔案約 6.5 MB）和一個把 GitHub Pages 導到它的 `index.html`。

改完程式之後要讓線上的網址跟著更新，**雙擊 `update.bat`** 就好 —— 它會依序做
重新建置 → `git add` → `git commit`（會問你這次改了什麼）→ `git push`，
中間哪一步失敗都會停下來並告訴你原因。

想自己打指令的話（注意 **Windows PowerShell 不支援 `&&`**）：

```powershell
node build.js
git add -A
git commit -m "改了什麼"
git push
```

Git Bash 或 macOS/Linux 才可以串起來寫：

```bash
node build.js && git add -A && git commit -m "改了什麼" && git push
```

推上去之後 GitHub Pages 大概 30 秒到一分鐘會自動重新發佈，重新整理網頁就是新版了。
（對方的瀏覽器可能有快取，叫他 Ctrl+F5 強制重載。）

## 原始碼

`build.js` 會把 `src/` 底下的檔案照順序串成一個 IIFE，再連同函式庫和
base64 模型一起塞進 `src/index.html` 的佔位符：

| 檔案 | 內容 |
|---|---|
| `src/data.js` | **平衡數值**：地形、職業、怪物、裝備、品質、經驗曲線、屬性點 |
| `src/settings.js` | 設定面板與 localStorage（每台裝置各自記自己的）|
| `src/skills.js` | **90 個技能**與 17 種狀態的定義（設計說明在 `skills.md`）|
| `src/world.js` | 地圖生成（種子式、180° 旋轉對稱）、3D 場景、模型與實例化 |
| `src/vfx.js` | 技能特效：程序生成的粒子貼圖 + 各技能的特效配方 |
| `src/status.js` | 狀態系統（增益／DoT／控制）、護盾吸收、被動查詢 |
| `src/rules.js` | 移動範圍、傷害計算、技能執行、回合流程、怪物 AI |
| `src/inv.js` | 掉落、技能精球／裝備精球、三顆合成、批量與自動分解、技能欄解鎖 |
| `src/ui.js` | 面板、背包（裝備／技能兩個分頁、角色篩選、屬性點）、名牌、小地圖、輸入 |
| `src/ai.js` | 電腦對手（貪心式，只在本機對戰生效）|
| `src/net.js` | 線上對戰 |
| `src/main.js` | 啟動與主迴圈 |

地圖大小是變數（`setSize()`），16–64 都可以，地形／道路／營地／寶箱全按比例生成。

想調數值：地形職業裝備改 `src/data.js`，技能改 `src/skills.js`，再重跑 `node build.js`。

## 線上對戰

用 PeerJS 的公用牽線伺服器交換連線資訊，連上之後走 WebRTC **點對點直連**，遊戲資料不經過伺服器。
對方需要**同一個 `porkguy.html`** 加上網路；房主開房間拿 6 碼房號，對方輸入房號就連上，
兩邊各自選三個職業，湊齊了房主才開局。

**自架中繼備援（選用）**：兩邊都在對稱式 NAT 後面時，WebRTC 的 P2P/TURN
交握偶爾會卡住連不起來。`relay-server.js`（Node.js + `ws`）是一個簡單的
WebSocket 中繼伺服器，架在自己的一台公網主機上（例如 Oracle Cloud
Always Free 的 Ampere A1 執行個體），把 `src/net.js` 開頭的
`WS_RELAY_URL` 改成自己主機的位址，連線時兩邊會先試中繼、連不到才退回
PeerJS+TURN，兩套互為備援。`WS_RELAY_URL` 留空（預設）就完全不會用到
這個功能，行為跟原本一樣。

**一定要是 `wss://`（加密），不能是 `ws://`**——遊戲網頁是 HTTPS
（GitHub Pages 強制），瀏覽器的 Mixed Content 規則不准 HTTPS 頁面連
未加密的 `ws://`，不管什麼網路都一樣擋（曾經誤以為是連接埠被行動網路
擋掉，實際上是這條規則，細節見 [skills.md](skills.md) 四十一節）。
`wss://` 需要憑證，`relay-server.js` 檔頭的註解有完整部署步驟，推薦
用免費的 DuckDNS 網域 + `acme.sh` 的 DNS-01 驗證拿 Let's Encrypt 真憑證
（不需要對外開放 80/443，繞開部分雲端主機這兩個埠連不進來的問題）；
沒有網域的話也可以退回自簽憑證，但每個瀏覽器第一次連線都要手動接受
一次安全性警告。

想做到「丟個網址就能玩」，把 `porkguy.html` 上傳到任何靜態空間即可（GitHub Pages / Netlify Drop / itch.io）。
單檔沒有相依，上傳完直接就是一個網址；順便也解決 `file://` 下某些瀏覽器存不了設定的問題。

## 開發時的預覽

```bash
node serve.js
```

開 http://localhost:8123 。`test.html` 是素材管線的煙霧測試（九隻角色、共用動畫、
地形物件全部載一遍），改動模型後可以先跑這頁確認。

瀏覽器主控台可以用 `__dbg` 看內部狀態：`__dbg.G`（局面）、`__dbg.sel`、
`__dbg.info`（draw call 統計）。

## 素材管線

模型全部出自 [KayKit](https://kaylousberg.itch.io)（Kay Lousberg，CC0），
從官方 GitHub 抓下來後經過兩道處理：

```bash
node fetch.js      # 從 KayKit 的 GitHub 抓原始素材到 kk/
node optimize.js   # 角色瘦身 → raw/
node pack.js       # .gltf + .bin 打包成 .glb → raw/
```

`optimize.js` 做的三件事讓角色從 35.6 MB 縮到 2.85 MB（省了 92%）：

1. **動畫抽出共用** —— 九隻角色用的是同一副 41 骨骼骨架，所以動畫只留一份
   （`anims.glb`），角色檔完全不帶動畫，執行時再用 `mixer.clipAction(clip, root)` 綁上去。
   原本每隻帶 76–95 個動畫，其中 IK / 控制骨骼的軌道也一併砍掉。
2. **砍掉用不到的配件** —— KayKit 角色內建多套武器和盾牌，只留該職業會顯示的那幾個
   （`KEEP_MESH` 表）。
3. **重建 buffer** —— 清掉沒人引用的 accessor / bufferView。

`raw/` 是最終素材，`kk/` 是原始下載（已刪，要重抓跑 `node fetch.js`）。

## 幾個實作上的坑

**武器掛載**：GLTFLoader 會把節點名稱裡的 `. : / [ ]` 去掉，所以骨骼 `handslot.r`
進到 three.js 之後叫 `handslotr` —— `attachWeapon()` 兩種都試。

**貼圖**：角色和地城模型的貼圖是內嵌的，六角包打包出來的模型則指向外部
`hexagons_medieval.png`，所以 `main.js` 用 `LoadingManager.setURLModifier` 把檔名對應到
內嵌的 data URI。

**file:// 相容**：`parse()` 會暫時把 `window.createImageBitmap` 藏起來，逼 GLTFLoader
改用 `<img>` 而不是 `fetch()` 讀貼圖 —— 直接雙擊開檔才不會被瀏覽器擋。

**動畫補間用 setTimeout 而不是 requestAnimationFrame**：分頁切到背景時 rAF 會停擺，
用 rAF 驅動的補間永遠不會結束，整個回合會卡死。畫面本身還是在 rAF 迴圈裡畫。

**效能**：地形和樹石用 InstancedMesh，57 個單位同框約 257 draw call / 19.6 萬三角形。
骨骼動畫只更新鏡頭附近的單位；畫面外的單位連移動和攻擊動畫都直接跳過
（`onCam()`），否則魔物階段十幾隻怪一起動會等很久。

## 線上對戰

PeerJS 的公共信令伺服器牽線，之後 WebRTC 點對點。**所有遊戲邏輯的亂數都走
同一個種子化的 `grng`**，兩邊執行同樣的動作序列就會得到同樣的結果，所以只要傳
「做了什麼」，不必傳骰子結果。地圖也是由種子生成的，連線時只傳種子。
重新連線時主機會補送一份完整局面（`serialize()` / `applySync()`）。

`hookConn()`／`netSend()`／`onNetData()` 這層完全不管底層是 PeerJS 還是
WebSocket，兩種傳輸方式共用同一份介面（`.send()`／`.on('open'|'data'|'close', cb)`／
`.open`）——`wsAdapter()`（`net.js`）把裸的 `WebSocket`包成這個介面，所以
新增「自架中繼備援」時完全不用碰遊戲邏輯本身，見上面「線上對戰」那節。



## 素材

3D 模型全部來自 [KayKit](https://kaylousberg.itch.io/)（[GitHub](https://github.com/KayKit-Game-Assets)），
授權 **CC0**，可以自由使用和重新散布：

- KayKit Adventurers Character Pack — 五個英雄
- KayKit Skeletons Character Pack — 魔物
- KayKit Dungeon Remastered Pack — 寶箱、柱子、火把
- KayKit Medieval Hexagon Pack — 樹木、岩石、水草

原始 GLB 經過 `optimize.js` 處理（抽出共用骨架動畫、丟掉沒用到的網格、
壓縮 accessor 與 bufferView），35.6 MB → 2.85 MB。

函式庫：three.js r128、GLTFLoader、SkeletonUtils（MIT）、PeerJS（MIT）。

## 授權

程式碼 MIT。素材依 KayKit 的 CC0。
