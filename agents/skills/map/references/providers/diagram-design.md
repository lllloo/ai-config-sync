# Provider adapter：diagram-design

`map` 第 4 步的唯一 provider。這是 prompt-level 呼叫：即使檔案最終由同一個 agent 寫出，該 agent 此時是 `diagram-design` 的執行者，不是另一個可自由設計 HTML 的 caller。本檔只定義交接 profile 與 `map` 語意覆寫；所有圖面決策仍以 provider 規範為準。

## 固定 render profile

除非使用者明確指定不同目的地或細節層級，套用以下 profile；顯式要求可覆寫 `size`、`detail`、`audience`，但不得覆寫 `map` 的單檔、固定深色與不上傳硬約束。

| Dial | 預設值 | 理由 |
|---|---|---|
| format | `html` | `map` 的交付格式 |
| size | `slide-16x9`（viewBox `0 0 1280 720`、presentation 字級） | 固定畫布比例避免各 harness 自選；ramp 取捨見下方 |
| detail | `balanced`（仍守非 import 的 ≤9 節點預算） | 保留主線所需技術內容，不套用 import 的擴張額度 |
| audience | `engineer` | 保留 verified edge label 與技術名稱 |
| template | `template-dark.html` | 固定同一頁面骨架，不自行發明 shell |
| skin | provider 預設 dark | 此固定 profile 視同已明確選用預設 skin，不另啟動品牌 onboarding |
| motion | `none` | 架構頁預設為靜態文件 |

主流程方向與其餘佈局決策由 `diagram-design` 依所選 type reference 自行決定；繪圖前宣告即可，caller 不指定。

**`size` 不得改回 `doc-wide` 或 `fit`**（兩者綁 standard ramp，其 sublabel 9px／箭頭標籤 8px 低於上游自己標的 CJK 可讀下限 10px）。preset 選的是 typography 取向，不是實際觀看情境——「產出不是投影片」不構成改回的理由。

## 交付步驟

1. 以 harness 可用的方式載入 `diagram-design`（Claude Code 可直接呼叫該 skill；其他工具讀取其安裝目錄下的檔案）。只認名字、不限定安裝路徑，但**載入成功以實際讀到檔案為判準**：本步須讀到其 `SKILL.md`，後續第 3 步的 type reference 與 output spec、第 5 步的 template 亦同（皆指 `diagram-design` 安裝目錄內的 `references/type-*.md`、`references/output-spec.md` 與 `assets/template-dark.html`，非 `map` 的 references）——任一讀不到即視為載入失敗，走 `map` 的晚停規則，不憑記憶、本檔摘要或風格印象湊合作畫。找不到安裝位置時先問使用者要路徑，再決定繼續或晚停。
2. 依其 **§3（Selection: semantic pattern, then visual type）** 選型：模組邊界圖多為 Architecture 型，狀態機用 State 型，循序圖用 Sequence 型。
3. 在繪圖前宣告 visual type、固定 render profile、主流程方向與因複雜度預算將省略的內容；再載入選型對應的 `references/type-*.md`（如 `type-architecture.md`）與 `references/output-spec.md`。**後者不可略過**——本檔 profile 的 `size`／`detail`／`audience` 定義都在該檔（§2–§4），而上游只從 import 路徑指向它。
4. 把中介表示四張表（見 `../intermediate-tables.md`）原樣交給 provider；不得先翻譯成座標、方格角色或自製 page shell。
5. 以 `template-dark.html` 為頁面基底，依 provider 規則產生 HTML/SVG 並完成 taste gate（繪圖前的自我檢核清單，不含開瀏覽器驗圖），完成即交回 `map` 第 5 步。

**不做繪後目視檢查**：產出直接交付，圖面品質由使用者目視回饋。使用者反饋圖面問題時，重新載入 `diagram-design` 與所選 type reference 依其規則修正，不得由 caller 直接 patch。

## 繁體中文字型

Geist 系列無 CJK 覆蓋，不指定 fallback 中文就落到未定義的 `system-ui`。以下兩條取代上游 `output-spec.md` §4 的處置（該處給的是日文序，繁中套用會拿到日文字形）。

**一、字型序**：

```
sans（標題、節點名稱）：'Geist', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif
mono（sublabel、箭頭標籤、eyebrow、legend）：'Geist Mono', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', monospace
```

產出的 `<link>` **必須補上 `Noto+Sans+TC:wght@400;500;600`**，否則序裡寫了也載不到。mono 一欄刻意也用 `Noto Sans TC`（CJK 全形等寬，在 mono 情境仍對齊），不必另尋 CJK 等寬家族——`map` 的箭頭標籤走 mono 而關係名多為中文（`DI 注入`、`寫入`），這欄不是可選項。

**二、一律不使用 serif**，含頁面標題與 annotation callout。此條**覆寫上游的「Page title in Instrument Serif」**（其 SKILL.md §5 與 §9 taste gate 皆要求 serif 標題），**taste gate 不得據此改回**。

## 禁止邊的降級規則

中介表示的 `種類` 欄不得在翻譯中丟失，`map` 第 5 步驗收：

- **`種類=禁止`**：短虛線＋停止符號（如 `⊥`）＋路徑終止於邊界。用普通 Architecture 型即可，不必用 `Secure paved road` 語意模式（其自帶 ≤2 forbidden paths 預算；普通型只受總箭頭預算 12 限制）。禁止邊用 ink 色＋符號呈現，不佔 coral（coral 留給 focal 節點）。
