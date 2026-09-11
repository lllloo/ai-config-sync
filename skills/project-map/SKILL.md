---
name: project-map
description: 僅在明確呼叫時啟動——使用者輸入 `/project-map`，或明講「用 project-map」「跑 project-map skill」才執行。需求聽起來像架構圖或專案地圖也一樣：只要沒點名本 skill，一律不自動啟動、照一般方式回答即可。啟動後分析軟體專案並建立或增量更新可互動的專案地圖，呈現模組、依賴、執行流程與程式碼證據。適用於專案導覽、架構理解、功能追蹤及維護長期可延伸的視覺文件；不適用於單純目錄列表或尚未落地的架構提案。
---

# Project Map

建立一份能隨專案持續成長的視覺地圖。此 skill 必須獨立運作，不呼叫或假設存在其他 skill、外部套件、CDN 或網路服務。

## 組成

`scripts/render-project-map.js`（產生器）、`references/schema.md`（資料格式）、`vendor/elkjs/`（佈局引擎，僅產生階段使用）。這三者屬 skill 本體，不是產物。

## 產物

落在專案根目錄：

```text
docs/project-map/
├── index.html          # 可互動的專案總覽（生成，不手動修改）
├── project-map.json    # 節點、關係與資料流（可編輯）
├── modules/            # 每個 group 一頁（生成，不手動修改）
│   └── <group-id>.html
└── evidence/
    └── sources.json    # 每個 node／edge 的程式碼依據（可編輯）
```

兩份 JSON 是唯一可編輯的來源，HTML 一律由腳本重新生成；`modules/` 下的頁面完全由 renderer 管理，group 改名或刪除後，對應的舊頁會在下次產圖時自動移除。落點預設在 `docs/`、預期進版控；若使用者指定其他位置，以使用者要求為準。第一次建立檔案前，告知預定落點。

## 模式

- `create`：首次掃描並建立總覽。
- `update`：依目前程式碼更新既有節點、關係與證據；保留仍有效的人工註記。
- `focus <主題>`：深入指定模組或功能，新增節點、關係與流程，不另建互不相干的地圖。
- `trace <入口或行為>`：追蹤一條實際執行路徑，加入 `flows`。
- `diff`：比較既有地圖與目前程式碼，先報告可能過期之處；經確認後才改資料。

## 工作流程

1. 找出專案根目錄及適用的 `AGENTS.md`、README、manifest、路由、啟動點與組態檔。
2. 若 `docs/project-map/project-map.json` 已存在，先連同 `evidence/sources.json` 一起讀取再掃描，避免重建時遺失內容。
3. 先以摘要級搜尋定位模組與關係，再讀必要檔案。每個事實都要能回指實際檔案；無證據的推測不得畫成確定關係。
4. 依 [資料格式](references/schema.md) 更新兩份 JSON：結構寫進 `project-map.json`，證據寫進 `evidence/sources.json`。識別碼一旦發布即保持穩定；相同語意不得建立重複節點。
5. 使用內附腳本產圖：`node <skill-root>/scripts/render-project-map.js docs/project-map`。
6. 先跑 `--check` 驗證兩份 JSON，再確認 `index.html` 與各模組頁已產生且不含外部資源。
7. 回覆新增、更新、標為過期及仍待查證的項目，並提供 `index.html` 的可點連結。

## 掃描與更新原則

- 優先畫出執行時邊界與資料流，不把完整檔案樹當架構圖。
- 總覽控制在 8–15 個節點：節點超過 15 個時圖的可讀性明顯下滑，該把細節移進模組分頁，而不是塞進同一張圖。
- **`groups` 即模組分頁的單位**，以功能領域切分（`authentication`、`billing`、`api`），不用「前端／後端」這類過寬分層。單一模組頁節點過多時，拆成更小的 group，不要塞進同一頁。
- 節點與關係的擺放由 ELK 決定，不要為了排版去改資料（調整 id 順序、加空節點）。版面不理想時該調的是 group 切分或節點數。
- **關係標籤要具體到可查證的東西**：函式名（`buildSyncItems`）、型別分派條件（`type=xtool-dir`）、協定或資料型別（`HTTP`、`讀 .skill-lock.json`）。`呼叫`、`使用`、`依賴`這類泛稱佔了版面卻沒有資訊，讀圖的人得逐條點開才知道發生什麼事。
- **不畫「不存在」的關係**：沒有線本身就代表「不會這樣跑」，別為禁令、零觸碰或刻意不做的反向流程另畫一條標著「禁止」的邊。這類約束寫進 group 的 `description` 或 node 的 `notes`（見 [資料格式](references/schema.md) 的「只畫存在的關係」）。
- **不留孤立節點**：沒有任何進出邊的節點在圖上只是浮著，讀者無從判斷它怎麼被用到。這類內容改寫進 group 的 `description`、node 的 `notes` 或直接以終端表格呈現，不放進 `nodes`。
- 證據使用專案相對路徑及可選行號。程式碼移動時更新 `sources.json`，不以 README 取代實作證據。
- **刪除 node 或 edge 時一併清掉 `sources.json` 中對應的 key**，否則 `--check` 會以孤兒條目報錯。
- 無法確認是否仍存在的內容先設為 `status: "stale"`，不要直接刪除；確認不存在後才移除。
- 人工撰寫的 `notes`、`questions` 與已記錄的決策不得因重掃而消失，除非使用者要求。
- 更新 JSON 時使用原子、可審查的檔案編輯；不要在 renderer 中反向修改資料。

## 獨立性與安全

- Renderer 只需 Node.js（>= 18）與內附的 vendor，不做任何網路存取。每一頁輸出為自含 HTML：
  點節點會淡出無關部分只留直接鄰居，並支援滾輪縮放與拖曳平移。
- **佈局在產生階段就算完**：`vendor/elkjs`（ELK 分層演算法）算好節點座標、正交折線與邊標籤位置後
  寫進 HTML，因此產出頁面不含任何佈局程式碼或外部函式庫，單檔離線可開。
- vendor 的授權為 EPL-2.0 OR GPL-3.0-or-later，全文與更新方式見 `vendor/elkjs/README.md`。
- 不載入外部 JavaScript、字型、圖片或樣式。
- 不啟動伺服器、不上傳、不發布，除非使用者另外明確要求。
- 不執行專案程式碼來推測架構；必要的測試或執行需符合使用者授權與專案規則。
