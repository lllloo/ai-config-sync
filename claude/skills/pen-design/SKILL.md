---
name: pen-design
description: 處理 Pencil (.pen) 設計稿相關的所有切版與核對任務（Vue/React/HTML 皆適用）。**自動判斷模式**：有現成前端程式碼 → 核對模式（找差異修正）；無程式碼或明確說「切版」→ 切版模式（從設計稿生出頁面）。觸發關鍵詞：「切版」「核對切版」「比對設計稿」「依設計稿刻」「check design vs code」「依設計稿檢查」「視覺核對」「從設計稿做」「把設計稿切出來」，或提供 Pencil node ID 時，**一定**要用這個 skill。即使使用者沒有明講「用 skill」，只要涉及 .pen 檔案與前端程式碼就用它。
---

# Pencil 設計稿切版與核對

## TL;DR — 快速決策流程

```
收到需求
   │
   ▼
0. 判斷模式
   ├── 使用者說「切版」或目標 Vue 檔案不存在 → 【切版模式】
   └── 有現成 Vue 檔案 + 說「核對/比對/check」 → 【核對模式】
   │
   ▼
1. 前置盤點（必做，見下方「步驟 0」）
   ├── 盤點既有 components + prop 白名單
   └── 讀 1-2 個相近頁面了解慣例
   │
   ▼
2. get_editor_state + batch_get 根節點（readDepth:4, resolveVariables:true）
   │
   ▼
3. 根節點展開後，直接子區塊 ≥ 3 個？
   ├── 是 → 拆成 3-6 個語意區塊，並行派發 subagent（Explore）
   └── 否 → 主流程單人處理
   │
   ▼
4a.【切版】Subagent 各自讀設計 → 輸出結構 spec + Tailwind snippet（不寫檔）
   主流程收到 spec → 組裝前端頁面 → Chrome MCP 視覺驗證
   │
4b.【核對】Subagent 各自比對 → 輸出差異報告（不修檔）
   主流程彙整去重 → 驗證可疑項 → 修程式碼 → Chrome MCP 視覺驗證
```

**預設行為是「拆」**。即使區塊看起來不大，拆分成本極低（並行），但涵蓋率顯著提升，漏掉細節的風險大幅降低。

## 動手前快速檢核（30 秒版）

在派發第一個 subagent 之前，先對自己問：

- [ ] 盤點過 component 白名單？查過關鍵 prop（特別是 icon 名）的白名單值？
- [ ] 讀過 1-2 個相近頁面，知道該專案的 container pattern 與 scoped class 慣例？
- [ ] 使用者給的 Node ID，`batch_get` 後看過 `name` 確認是對的頁面？
- [ ] `batch_get` 有帶 `resolveVariables: true`？
- [ ] 有 `ref` 的節點，都有計畫另外 `batch_get` reusable 本體？

任一答「否」就不要急著派 subagent——先補齊，否則多半會踩後面「三致命陷阱」的坑。完整版檢查清單在本檔最末。

---

## 致命陷阱（切版與核對都適用）

> 對應 subagent 用的精簡版守則在 `references/golden-rules.md`。本章節是主流程要理解的「為什麼」，守則是 subagent 要照做的「怎麼做」。

### 陷阱 1：單一 agent 吞下太多節點，注意力稀釋

頂層 frame 常有數十個子節點、多層巢狀。讓一個 agent 處理整張卡，細節（顏色、間距、元件語意）會被稀釋而漏掉。

**解法**：沿子 frame 邊界拆 3-6 個小區塊，每區塊一個 Explore subagent 並行。

### 陷阱 2：盲信既有 Vue 程式碼，誤判 ref 語意

既有程式碼把設計系統元件做成 `<input type="checkbox">`，agent 容易照著寫「checkbox 正確」，而沒去查 ref 本體到底是什麼。

真實案例：`btn-xs`（按鈕）、`form-title`（純文字 label）被連續 4 個 agent 誤當成 checkbox — 因為沒人去查 ref 定義。

**解法**：遇到 `ref` 屬性就 `batch_get` reusable component 本體，讀 `name`、`children`、預設 fill/stroke。**Vue 現有實作只是「某人的詮釋」，不一定對。**

### 陷阱 3：Instance descendants 有兩種模式，搞混會完全看錯

**模式 A — 屬性 override**：只改列出的欄位，沒列的沿用本體預設
```json
{ "ref": "giHjx", "descendants": { "nI2Vj": { "fill": "#b5afc3" } } }
```
只有 `nI2Vj` 的 `fill` 被蓋成 `#b5afc3`，其他欄位（size、padding、其他子節點）都維持 `giHjx` 本體的預設值。

真實案例：instance 只 override 期別欄 fill `#b5afc3`，但 2-4 欄在本體預設是 `#f0d0d0`。單看 override 會把正確的 `bg-[#f0d0d0]` 誤改成 `bg-[#b5afc3]`。

**模式 B — 整組 `children` 替換**：本體原本的子節點被丟掉
```json
{ "ref": "d5ZTS", "descendants": { "NvL81": { "children": [{"ref":"h12kK"},{"ref":"dOLzc"}, ...] } } }
```
`NvL81` 本體中原有的 children 全部不算，實際顯示的是 override 裡列出的那些 refs。

**判斷依據**：`descendants.X` 裡出現 `children` 或 `type` 欄位 → 模式 B（整組替換）；只有屬性欄位（content / fill / x / y 等）→ 模式 A（屬性 override）。

**解法**：`batch_get` component 本體，先判斷是哪一種模式，再決定怎麼讀。

```
模式 A：實際顯示值 = instance descendants override ?? component 本體預設值
模式 B：實際子節點 = override.children（本體的 children 完全不算）
```

完整範例與快速判斷流程見 `references/pen-output-patterns.md` pattern 4/5/6。

### 陷阱 4：盲信使用者給的 Node ID

使用者貼過來的 Node ID 常見問題：貼錯頁面、貼到父 frame 的容器、貼到截圖或裝飾節點、或設計稿已經更名但 ID 沒同步。照著錯的 ID 切下去，做完才發現畫的不是目標頁面，整輪白費。

**解法**：`batch_get` 後**先看 `name` 欄位**。如果 `name` 和目標頁面語意不吻合（例如使用者說「住戶資料管理」但拿到的 name 是「期別設定」），就用 `patterns` 搜尋正確節點，或反問使用者。**寧可多花 30 秒確認，不要盲衝。**

真實訊號：`name` 裡出現意料之外的字、根節點下只有一個子節點（可能是容器殼）、或 `get_screenshot` 截出來跟使用者描述完全不同。任一個出現就停下。

### 陷阱 5：自作主張加 hover / a11y / 點擊互動

設計稿沒畫的「行為」常被 agent 腦補進去：

- 在純展示節點（流程圖節點、資訊卡片）加 `:hover` 效果或 `cursor-pointer`，誤導使用者以為可點
- 主動補 `aria-*`、`role=`、`alt=`、`tabindex=` 等 a11y 屬性
- 把單純 div 改寫成 `<button>` / `<a>`，加上 `@click` handler
- 主動加 focus ring、過場動畫、loading skeleton

**解法**：設計稿沒畫的互動／無障礙行為一律不加。要加之前先問使用者「這個節點是否可點／需不需要無障礙標記」。

判斷依據（任一條成立才加）：
- 設計稿明確畫出互動狀態（hover 圖層、active 圖層、focus 框）
- 既有相近頁面在同類元素上有同等行為（沿用慣例）
- 使用者明確要求

無上述依據就「照畫面長相切」，**不要替使用者決定行為**。a11y 增強同理——使用者沒要求就不主動加，避免無謂 diff 與後續清理。

---

## 卡住時：停下來問，不要猜

下列情況都是「信號」，不是「障礙」。遇到這些不要用常識繞過，因為繞過去常常是在錯誤的根基上繼續堆錯：

- `batch_get` 回傳空或節點不存在 → 確認 Node ID，或反問使用者
- `resolveVariables: true` 仍看到變數字串 → 變數沒定義或設計稿有問題，截圖 + 報告
- `ref` 指向的 component 本體也有 `ref`（多層 instance）→ 遞迴 `batch_get` 到底層
- 使用者給的 Node ID 截圖跟口述的頁面對不上 → 反問，不要自己猜哪張才對
- 設計稿跟現有 Vue 結構差距過大（改動超過原檔 50%）→ 先彙整差異報告給使用者決定「大改」或「擱置」，不要自動重寫

**原則**：遇到模糊時，成本最低的行動是**問使用者一句話**，而不是做 30 分鐘然後重做。

---

## 步驟 0：前置盤點（切版/核對都要做）

動手前花 2 分鐘了解「這個專案已經有什麼」。跳過這步的代價很具體：重造輪子、用錯 icon 名稱、跟既有頁面風格打架，後面要重工。

> **先找專案自己的筆記**：許多專案會把「pen-design 落地筆記」放在專案根目錄（常見檔名：`PEN-DESIGN.md`、`docs/pen-design.md`、或寫在 `CLAUDE.md` 的「設計系統」章節）。動手前先找這類檔——它通常已經整理好 component 白名單、版面模式、scoped class 慣例。找不到就按下面 A/B 步驟從頭盤點。

### A. 盤點可用的 reusable components

目的：避免自己刻一個已經存在的元件、避免猜錯 prop 白名單。

做法（Vue/React/其他框架通用）：
1. 列出所有共用元件 — 例如 `Glob app/components/**/*.{vue,tsx}` 或該專案對應路徑
2. 讀專案的 `CLAUDE.md` / `AGENTS.md` / `README.md` 中「設計系統」或等效章節
3. 對於要用到的元件，**讀它的 types 檔或 props 定義**（TypeScript 的 `types.ts` / `.d.ts` / PropTypes / component 本體）

特別留意 **prop 白名單**（prop 值限定在特定字串集合的情況）：某些 icon / variant prop 只接受列舉值，猜錯名稱往往不會觸發編譯錯誤，而是**靜默失效**。

**為什麼重要**：猜一個不在白名單的 icon 名稱（真實案例：`document-arrow-down`），TypeScript 可能沒報錯、編譯通過，但 icon 靜默不顯示。視覺驗證時才發現，要重跑一輪。前置查過就不會踩這個坑。

### B. 讀 1-2 個相近頁面

目的：學習專案已經固定下來的慣例（container pattern、table 結構、local class 命名、button group 組法）。相近頁面就是最權威的 style guide。

做法：
1. 列出所有頁面 — 例如 `Glob app/pages/*.vue` / `src/pages/**/*.tsx` 等
2. 根據目標頁面的結構，挑 1-2 個最相近的作為參考：
   - **表格頁** → 找同類型的表格頁（例如有 sticky header + footer row 合計）
   - **表單頁** → 找類似的表單頁（含 tabs 或分區）
   - **Dashboard / Flow** → 找現有的流程圖頁
3. 讀那 1-2 個頁面，特別觀察：
   - 頂層 container pattern（flex 方向、高度鏈、overflow 處理）
   - 表格結構（table layout、border 模式、滾動條包裹）
   - 區域樣式（scoped style / CSS module / styled-components 的 local class 命名）
   - Button group 組法（平均分欄 vs 左右分群）
   - 顏色寫法習慣（任意值 class vs theme token）

**為什麼重要**：如果 3 個相近頁面都用同一個 table class 組合，新頁面也應該這樣寫。跟既有慣例打架會產生無意義的 diff，未來維護也會很亂。相近頁面還會告訴你一些沒寫進 CLAUDE.md 的隱性慣例（例如「footer row 用第二個 table 而非 tfoot」）。

### 最低產出

前置盤點完，你應該能回答：
- [ ] 目標頁面會用到哪些既有 components？各自的關鍵 prop 白名單是什麼？
- [ ] 參考的 1-2 個相近頁面路徑是什麼？它們的 container pattern 長怎樣？
- [ ] 有沒有既有的區域樣式（scoped class / CSS module）可以直接沿用？

如果回答不出來就不要開始切版/核對——多半會踩前述的坑。

### C. 落檔建議（首次盤點才做）

如果**專案沒有** `DESIGN.md`（或等效的 pen-design 落地筆記檔），盤點完請主動問使用者：

> 「我剛剛盤點了這個專案的 component 白名單、版面模式和 scoped class 慣例，要不要存成 `<專案前端根>/DESIGN.md`？這樣下次用 pen-design skill 就能直接讀，不用重跑盤點。」

獲得同意後才寫檔。寫檔規則：

0. **只記錄廣泛使用的慣例**：寫入 DESIGN.md 的內容必須跨多個頁面通用。頁面專屬的 scoped class（例如只在單一頁面出現的 `.table-grid`、`.parking-td`）、一次性的色值、特定頁面的版面結構，不要寫入——它們放在各自的 .vue 檔就夠了。判斷標準：「如果切一個全新頁面，這條規則有沒有用？」有用才寫。
1. **先檢查檔案是否已存在** — `Glob DESIGN.md` / `Glob frontend/DESIGN.md` / 類似路徑
2. **存在就不要覆蓋**：如果已有 `DESIGN.md` 但內容不是 pen-design 筆記（例如純切版原則），用 `Edit` 在既有內容尾端追加一段「Part 2：Pencil 切版／核對專案筆記」，不要 `Write` 整檔
3. **不存在才 `Write`**：用兩段式結構（Part 1 切版原則可留白由使用者補 / Part 2 直接填盤點結果）
4. **寫完後自動更新 `CLAUDE.md`**（不要只提醒使用者自己加）：
   - `Glob` 找專案的 `CLAUDE.md`（可能在根目錄或 `frontend/` 等子目錄，與 `DESIGN.md` 同層）
   - `Grep` 確認沒有既存的 `DESIGN.md` 引用（搜 `@DESIGN.md` 或 `DESIGN.md` 關鍵字）
   - 沒有才用 `Edit` 在 `CLAUDE.md` 檔尾加一行 Claude Code import 語法：
     ```
     @DESIGN.md
     ```
     使用 `@import` 而非 markdown link 的原因：`@DESIGN.md` 會被 Claude Code 自動展開到每次 session 的 context，Part 1（切版核心原則）對所有前端任務都有用，不必等 skill 觸發才載入。Part 2 也順便常駐，避免 skill 偶爾沒 match 到時 Claude 看不到專案慣例。
   - 找不到 `CLAUDE.md` / 已有引用 → 略過，不強行建立新檔

**不要跳過詢問步驟。** 盲寫檔案會覆蓋使用者在意的內容、或在不想要文件化的場合產生噪音。使用者說「先不用」就跳過，不要重複追問。

---

## 切版模式工作流程

### 步驟 1：前置盤點 + 讀設計

**先做「步驟 0：前置盤點」**（component 清單 + 1-2 個相近頁面參考）。跳過這步會導致後續踩重造輪子、猜錯 icon 名、跟既有慣例打架等坑。

接著讀設計：

```
mcp__pencil__get_editor_state({ include_schema: true })
mcp__pencil__batch_get({ nodeIds: ["<ROOT_ID>"], readDepth: 4, resolveVariables: true })
mcp__pencil__get_screenshot({ nodeId: "<ROOT_ID>" })
```

同時確認：
- 目標前端檔案路徑（不存在則新建）
- 頁面用的 layout（預設 layout？需要 tabs？）
- **Node ID 名稱 vs 目標頁面名稱是否對應**：使用者提供的 Node ID 不一定正確，`batch_get` 後先看 `name` 欄位確認，不符就用 `patterns` 搜尋正確節點

### 步驟 1.5：聲明布局假設（必做）

派 subagent **之前**，主流程用一行字明確說出本次假設的頂層布局結構與依據來源，寫進對使用者的回覆裡。例：

> 「本頁布局：頂層 `grid-cols-4`，依據相近頁面 `app/pages/foo.vue` 的 table 結構沿用。」
> 「本頁布局：兩欄水平 `flex` 切分，依據設計稿節點的 `flexDirection: row` 與兩個並排子 frame。」

判斷依據順序（找到一條成立就用，不要往下找）：

1. 既有相近頁面有同模式 → 沿用該模式
2. 設計稿節點的 `flexDirection` / 子節點排列 → 推斷 grid 欄數或 flex 方向
3. 都沒有 → 從 `get_screenshot` 比例推斷，但聲明中加註「依截圖推斷，可能誤判」

**不需等使用者明確 OK**，這步的目的是讓自己動手前 explicit 化判斷——使用者看到不對會立刻打斷，比寫完 100 行被退稿便宜 10 倍。

但**禁止**：把判斷壓在心裡就直接派 subagent。預設「垂直堆疊」或從 cropped 截圖瞎猜 grid 欄數是這個 skill 反覆出現的失敗模式。

### 步驟 2：切分語意區塊 → 並行派 subagent

找有獨立命名的子 frame（「表格 header」「底部按鈕列」「卡片區塊」）作為邊界。**避免按層數機械切。**

每個 subagent（Explore type）的 prompt 必填：
1. 限定範圍（「只處理 X 區塊」）
2. 設計稿節點 ID
3. 重點萃取項（顏色、尺寸、間距、元件語意、寬度策略）
4. 三條黃金守則（查 ref 本體、override 規則、resolveVariables）
5. **輸出格式：結構化 spec + Tailwind class 建議，不要寫 Vue 檔案**

完整 prompt 範本見 `assets/agent-prompt-template.md` → 「切版模式 subagent prompt」。

### 步驟 3：主流程組裝頁面

收到所有 subagent 的 spec 後：

1. **確認元件清單**：spec 中用到哪些既有元件，哪些需要新建
2. **組裝 template**：按設計稿結構組合各區塊 snippet，套用該專案的**頁面版面模式**（頂層容器、高度鏈、overflow 處理、底部按鈕列結構）— 這部分各專案不同，參考步驟 0-B 盤點結果或專案自己的 pen-design 落地筆記
3. **script 區塊**：只寫必要的 state/logic/import，不要加多餘的
4. **滾動容器**：中間可捲動區域套用該專案統一的 scroll class（若有）

**每寫完一個主要區塊就截圖確認，不要整頁寫完才驗證。**

### 步驟 4：Chrome MCP 視覺驗證

```
mcp__claude-in-chrome__navigate({ url: "<dev-server-url>/<page>" })
mcp__claude-in-chrome__computer({ action: "screenshot" })
mcp__pencil__get_screenshot({ nodeId: "<ROOT_ID>" })
```

截圖並排比對，有偏差直接對照 spec 修正（不要猜、不要憑印象改）。

**通過條件**（以下全部滿足才算切完；任一不滿足就不算完成，繼續修）：

- [ ] 顏色 hex 與 spec 完全一致（差一個字元都不算過）
- [ ] 主要區塊的層級結構與設計稿一致（不能把兩個區塊擠進同一層）
- [ ] 間距/padding 誤差 ±2px 以內（控件對齊類的必須 0px）
- [ ] 每個 `ref` 元件都對到正確的 Vue 元件（不是「長得像」，要能說出 name 對應關係）
- [ ] 所有文字內容與設計稿一致（包含佔位符、單位符號）
- [ ] 沒有 console error / Vue warning
- [ ] 沒有自作主張加的 hover 效果、a11y 屬性、click handler、cursor-pointer（見陷阱 5）

**不通過就不要交付**。寧可多跑一輪視覺驗證，也不要把「差不多」的頁面交出去讓使用者自己去挑錯——那是把成本推給使用者。

---

## 核對模式工作流程

### 步驟 1：前置盤點 + 取得狀態

**先做「步驟 0：前置盤點」**。核對模式尤其需要——因為修差異時會改用 component、抽 class，不先盤點就可能重造一個已經存在的東西，或引用不存在的 prop 值。

接著取狀態 + 深掃根節點：

```
mcp__pencil__get_editor_state({ include_schema: true })
mcp__pencil__batch_get({ nodeIds: ["<ROOT_ID>"], readDepth: 4, resolveVariables: true })
mcp__pencil__get_screenshot({ nodeId: "<ROOT_ID>" })
```

**Node ID 驗證**：使用者提供的 Node ID 不一定對應目標頁面。`batch_get` 後檢查 `name` 欄位，不符就用 `patterns` 搜尋正確節點再繼續。

### 步驟 2：切分 → 並行派 subagent

與切版相同的切分策略，但 subagent 目的不同：**只報差異，不修檔案**。

每個 subagent prompt 必填（見 `assets/agent-prompt-template.md` → 「核對模式 subagent prompt」）：
1. 限定範圍
2. 設計稿節點 ID + Vue 檔案路徑 + **精確行範圍**
3. 重點檢查項（顏色、間距、元件語意、寬度）
4. 三條黃金守則
5. 回報格式（嚴重度分類 + Vue 行號 + 節點 ID）+ 字數限制 500 字以內

### 步驟 3：主流程彙整 + 驗證可疑項

1. **去重** — 多 agent 可能提到同一問題
2. **驗證可疑項** — `Read` 原始碼確認，不要照單全收
3. **補查遺漏的 ref** — 主流程補 `batch_get`
4. **注意衝突訊號** — 不同 agent 對同一節點說不同色，高機率其中一方搞錯 override 規則
5. **排優先序** — 必修（嚴重）/ 次要（中度）/ 可跳過（輕微）

### 步驟 4：修程式碼

- 一次改 3-5 個地方就停下來驗證，避免累積誤差
- 每次修改對應一個已確認差異，**不要順手「改善」**

### 步驟 5：Chrome MCP 視覺驗證

同切版模式步驟 4（含通過條件檢查）。額外注意：核對模式是「修差異」不是「重切」，所以驗證重點是**你改過的那些行**確實修對了，沒連帶改壞其他區塊。修完後應該比修前更接近設計稿，否則就是改錯方向。

---

## 設計系統元件速查

看到 `ref` 時常見語意（每次仍需 `batch_get` 確認）：

| 可能的 `name` | 真實語意 |
|---|---|
| `btn-xs` / `btn-md` / `btn-sm` | **按鈕**（不是 checkbox！） |
| `form-title` | **label 文字**（可能含紅 `*`，不是 checkbox） |
| `form-input` / `Type=Input` | 文字輸入框 |
| `form-select` / `Type=Select` | 下拉選單 |
| `form-checkbox` / `Type=Checkbox` | 真的 checkbox |
| `form-display` | 純顯示欄位（不可編輯） |
| `form-date` / `Type=Date` | 日期欄位 |
| `Subheading` | 區塊標題 |
| `tabs` | 頁籤 |

---

## 自我檢查清單

**動手前（兩種模式共用）**：
- [ ] 盤點過可用 components，查過關鍵 prop 白名單（特別是 icon 名稱）
- [ ] 讀過 1-2 個相近頁面，知道 container pattern / table pattern / scoped class 慣例
- [ ] Node ID 的 `name` 欄位確實對應目標頁面

**切版前**：
- [ ] 確認目標頁面檔案路徑、layout
- [ ] **已聲明本次布局假設**（步驟 1.5：頂層 grid/flex 結構 + 依據來源）
- [ ] 所有 `ref` 節點都 `batch_get` 過 reusable 本體
- [ ] 用 `instance override ?? component 預設` 公式算實際顯示值
- [ ] `batch_get` 帶 `resolveVariables: true`
- [ ] Subagent 輸出 spec，主流程統一寫程式碼
- [ ] 不主動加 hover/click/a11y（陷阱 5）——設計稿沒畫就不加

**核對前**：
- [ ] 所有 `ref` 節點都 `batch_get` 過 reusable 本體
- [ ] Subagent 派發是並行（單一訊息多個 tool_use block）
- [ ] 主流程對 agent 衝突訊號做驗證
- [ ] 修完用 Chrome MCP 並排比對視覺
