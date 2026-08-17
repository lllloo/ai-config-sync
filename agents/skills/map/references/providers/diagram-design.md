# Provider adapter：diagram-design

`map` 第 5 步的唯一 provider。這是 prompt-level 呼叫：即使檔案最終由同一個 agent 寫出，該 agent 此時是 `diagram-design` 的執行者，不是另一個可自由設計 HTML 的 caller。本檔只定義交接 profile 與 `map` 語意覆寫；所有圖面決策仍以 provider 規範為準。

## 責任邊界

- `map` 擁有讀者問題、查證結果與四張中介表，只提供內容事實。
- adapter 擁有固定 render profile，以及「禁止／文件主張」的映射規則。
- `diagram-design` 獨占圖型選型、模板、畫布、座標、方格尺寸、節點層級、排版、連線、字型、配色、頁面組成、HTML/SVG 與視覺 QA。

caller 不得在交接前把四表翻成座標或 SVG，也不得在 provider 產出後自行設計、改寫或修補圖面。若 QA 失敗，重新載入 `diagram-design` 與所選 type reference，按其規則修正。

## 固定 render profile

除非使用者明確指定不同目的地或細節層級，套用以下 profile；顯式要求可覆寫 `size`、`detail`、`audience`，但不得覆寫 `map` 的單檔、固定深色與不上傳硬約束。

| Dial | 預設值 | 理由 |
|---|---|---|
| format | `html` | `map` 的交付格式 |
| size | `slide-16x9`（viewBox `0 0 1280 720`、presentation 字級） | 固定畫布比例避免各 harness 自選；與 `doc-wide` 同尺寸但走 presentation ramp，字級與節點間距較大 |
| detail | `balanced`（仍守非 import 的 ≤9 節點預算） | 保留主線所需技術內容，不套用 import 的擴張額度 |
| audience | `engineer` | 保留 verified edge label 與技術名稱 |
| template | `template-dark.html` | 固定同一頁面骨架，不自行發明 shell |
| skin | provider 預設 dark | 此固定 profile 視同已明確選用預設 skin，不另啟動品牌 onboarding |
| motion | `none` | 架構頁預設為靜態文件 |

主流程方向與其餘佈局決策由 `diagram-design` 依所選 type reference 自行決定；繪圖前宣告即可，caller 不指定。

## 交付步驟

1. 以 harness 可用的方式載入 `diagram-design`（Claude Code 可直接呼叫該 skill；其他工具讀取其安裝目錄下的檔案）。只認名字、不限定安裝路徑，但**載入成功以實際讀到檔案為判準**：本步須讀到其 `SKILL.md`，後續第 3 步的 type reference 與第 5 步的 template 亦同（皆指 `diagram-design` 安裝目錄內的 `references/type-*.md` 與 `assets/template-dark.html`，非 `map` 的 references）——任一讀不到即視為載入失敗，走 `map` 的晚停規則，不憑記憶、本檔摘要或風格印象湊合作畫。找不到安裝位置時先問使用者要路徑，再決定繼續或晚停。
2. 依其 **§3（Selection: semantic pattern, then visual type）** 選型：模組邊界圖多為 Architecture 型，狀態機用 State 型，循序圖用 Sequence 型。
3. 在繪圖前宣告 visual type、固定 render profile、主流程方向與因複雜度預算將省略的內容；再載入選型對應的 `references/type-*.md`（如 `type-architecture.md`）。
4. 把中介表示四張表（見 `../intermediate-tables.md`）原樣交給 provider；不得先翻譯成座標、方格角色或自製 page shell。
5. 以 `template-dark.html` 為頁面基底，依 provider 規則產生 HTML/SVG 並完成 taste gate。
6. 在 provider 階段以瀏覽器目視驗證文字、碰撞、裁切、連線與 responsive 縮放；通過後才交回 `map` 第 6 步做語意驗收。

## 約束與驗證狀態的降級規則

中介表示的 `種類`／`驗證` 兩欄不得在翻譯中丟失，第 6 步驗收：

- **`種類=禁止`**：短虛線＋停止符號（如 `⊥`）＋路徑終止於邊界。用普通 Architecture 型即可，不必用 `Secure paved road` 語意模式（其自帶 ≤2 forbidden paths 預算；普通型只受總箭頭預算 12 限制）。禁止邊用 ink 色＋符號呈現，不佔 coral（coral 留給 focal 節點）。
- **`驗證=文件主張`**：細虛線節點框／邊＋sublabel＋legend 三件套，不需要上游原生支援。

## 主題（固定深色）

固定產**深色版、單檔**：不產 light 版、不做 `prefers-color-scheme`／`data-theme` 主題切換。上游把 hex 硬編碼進 SVG，固定深色使其配色機制原樣可用，無需任何顏色覆寫。

## Provider 階段的交付前檢查

- `self_check.py` 只驗 accessible SVG contract、單檔安全與 motion，**抓不到標籤碰撞**。
- `verify-geometry.py` 未隨 skill 打包（安裝版 scripts 只有 3 支），其 SKILL.md 點名它時指的是上游 repo。

因此 `diagram-design` 流程除執行可用的自動檢查外，仍須以瀏覽器目視驗證標籤碰撞與連接線交疊。`map` 第 6 步只驗語意保真與硬約束；若圖面不合格，退回 provider 流程修正，不得由 caller 直接 patch。
