## 1. 中介表示規格

- [ ] 1.1 新增 `agents/skills/map/references/intermediate-tables.md`，定義節點表（`id`／`label`／`種類`／`分層`／`驗證`）、邊表（`from`／`to`／`關係`／`種類`／`驗證`）、群組與省略兩個區塊
- [ ] 1.2 在該檔寫明 `種類` 的允許值（`一般`／`禁止`）與 `驗證` 的允許值（`已驗證`／`文件主張`），並要求 `已驗證` 須附出處（測試檔名或原始碼位置）
- [ ] 1.3 附一個以本 repo 模組邊界為題的完整範例，四張表齊全，供 agent 對照格式

## 2. Provider adapter

- [ ] 2.1 新增 `agents/skills/map/references/providers/diagram-design.md`：說明「載入其 SKILL.md → 依 §3 選型 → 載入對應 `type-*.md` → 餵中介表示」的交付步驟
- [ ] 2.2 在同檔加入 D5 的 CJK 度量覆寫表（標籤 ≤8 字、字級 12px、接點間距 ≥20px、遮罩依實測 bbox、取消 all-caps）
- [ ] 2.3 在同檔加入 D6 的降級規則：`種類=禁止` 用短虛線＋停止符號＋路徑終止於邊界；`驗證=文件主張` 用細虛線＋sublabel＋legend
- [ ] 2.4 在同檔註明 `self_check.py` 抓不到標籤碰撞、`verify-geometry.py` 未隨 skill 打包，交付前檢查不得依賴它們
- [ ] 2.5 新增 `agents/skills/map/references/providers/artifact-diagramming.md`：只取 SVG 手法，明確禁止呼叫 `Artifact` 工具或任何發佈動作
- [ ] 2.6 在兩份 adapter 加入 D7 的主題規則：固定產深色版、單檔，不產 light 版、不做主題切換（`diagram-design` 的 hex 硬編碼因此原樣可用，無需覆寫）

## 3. SKILL.md 重寫

- [ ] 3.1 把「執行流程」改為六步：定義範圍 → 讀宣告 → 驗證實作 → 產中介表示 → 呼叫 provider → 交付前檢查
- [ ] 3.2 移除「圖面規則」整段；其中屬於通用約束的（每條箭頭標關係、禁令須呈現、不留孤立節點、文件主張須標示）併入硬約束清單，其餘刪除
- [ ] 3.3 移除「產出成頁面」的「完整 HTML」「圖形機制」「設計品質」三小節，改寫為硬約束清單（含 D7 固定深色主題）；保留「落點」「連結」兩節不動；「短內容不必開檔」縮限為表格／清單／程式碼，刪除「三五個框的示意圖」選項（D8）
- [ ] 3.3b 改寫「產出成頁面」開頭段：刪除「`artifact-design`／`artifact-diagramming` 可用時載入作為參考，不可用時直接照本節做，不要停下來、安裝它們」句——與 D4 晚停正面矛盾，改為指向 provider 名單與晚停規則
- [ ] 3.4 新增 provider 名單（`diagram-design` 優先 1、`artifact-diagramming` 優先 2，清單外可用但須說明選了誰）
- [ ] 3.5 新增「無 provider 時晚停」規則：第 1–4 步照跑、表格輸出終端、提示裝哪個 provider 後停止；明確寫出不保留內建 fallback
- [ ] 3.6 更新 frontmatter `description`：加入「需要繪圖 provider」的語意，保留既有的負面清單（dev server／localhost 等）
- [ ] 3.7 確認改完後 SKILL.md 未超出合理體量（原 51 行，圖面規則移出後應持平或更短），細節都在 `references/`

## 4. 驗證

- [ ] 4.1 `npm test` 全綠（本 change 不動 `sync.js`，任何 fail 都代表誤觸）
- [ ] 4.2 `openspec validate --strict` 通過
- [ ] 4.3 `npm run diff` 確認 `agents/skills/map/` 的新增檔案被 `xtool-dir` 型正確辨識，且未影響其他同步項
- [ ] 4.4 `npm run safety:check` 通過（新增檔案落在 `agents/` 掃描範圍內）
- [ ] 4.5 `npm run to-local` 套用到本機
- [ ] 4.6 開新 session，對本 repo 實跑 `/map`，確認走 `diagram-design` 路徑、四張表產出正確、禁止邊與驗證狀態都出現在圖上、產出為固定深色單檔（D7）
- [ ] 4.7 檢查產出圖的中文標籤無碰撞（D5 覆寫是否足夠），不足則回頭修 `2.2`

## 5. 文件與記憶

- [ ] 5.1 確認 `README.md` 無需更動（未新增指令、未改同步項目、未新增旗標）；若判斷需要則一併改
- [ ] 5.2 更新 cloud-memory 中的過時記憶：（a）「diagram-design 與 archify 都不整包引入，只抽可移植的純文字規則」——結論已改為「不 vendor 但具名呼叫」，且 star 門檻與離線約束的前提都已變動；（b）「本地示意圖一律手寫 inline SVG、不用 mermaid」——否決理由的前提（離線可開、零 runtime）已放寬為「不上傳網路空間」；（c）「點名 artifact-diagramming 的規則不得原樣搬進 codex/AGENTS.md」——map 現以 provider 名單具名點名它，Codex 端缺席時走 D4 晚停，該條的解法敘述需對齊
