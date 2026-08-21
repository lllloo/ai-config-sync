# Provider adapter：diagram-design

`map` 第 4 步的唯一 provider。這是 prompt-level 呼叫：即使檔案最終由同一個 agent 寫出，該 agent 此時是 `diagram-design` 的執行者，不是另一個可自由設計 HTML 的 caller。本檔只定義交接 profile 與 `map` 語意覆寫；所有圖面決策仍以 provider 規範為準。多圖頁另有「SVG 交接模式」：provider 職權止於每張圖的 SVG，頁面骨架由 `map` 的「多圖組頁」承載。

## 固定 render profile

除非使用者明確指定不同目的地或細節層級，套用以下 profile；顯式要求可覆寫 `size`、`detail`、`audience`，但不得覆寫 `map` 的單檔、固定深色與不上傳硬約束。

| Dial | 預設值 | 理由 |
|---|---|---|
| format | `html` | `map` 的交付格式 |
| size | 固定寬 1200、高度依內容推導（沿用 `fit` 的推導規則：內容 bounding box 進位到 4 的倍數＋四周 40px 邊距＋底部 60px legend 帶），字級用 presentation ramp（16px 節點名／12px 副標與箭頭標籤／盒高 64） | 寬 1200 在一般視窗近 1:1；縱向流程不被固定高截斷；ramp 取捨見下方 |
| detail | `faithful` 優先；四表節點 ≤9 時降為 `balanced` | 詳細度以四表節點數決定、不憑現場感覺，跨次可重現；≤9 時 faithful 無可放寬之處，降級省掉分區成本 |
| audience | `engineer` | 保留 verified edge label 與技術名稱 |
| template | `template-dark.html` | 固定同一頁面骨架，不自行發明 shell |
| skin | provider 預設 dark | 此固定 profile 視同已明確選用預設 skin，不另啟動品牌 onboarding |
| motion | `none` | 架構頁預設為靜態文件 |

主流程方向與其餘佈局決策由 `diagram-design` 依所選 type reference 自行決定；繪圖前宣告即可，caller 不指定。

**本 profile 借用 `fit` 的高度推導，但不得連帶採用其 standard ramp**（`fit`／`doc-wide` 綁的 sublabel 9px／箭頭標籤 8px 低於上游自己標的 CJK 可讀下限 10px），字級一律維持 presentation ramp。preset 選的是 typography 取向，不是實際觀看情境。

**1:1 渲染**：頁面 CSS 把 `svg` 顯示寬寫死為 1200px（不用 `width:100%`），外層容器 `overflow-x: auto`——字級數字即螢幕實際大小，不隨視窗寬度縮放；視窗較窄時橫向捲動、不縮圖。

## 交付步驟

1. 以 harness 可用的方式載入 `diagram-design`（Claude Code 可直接呼叫該 skill；其他工具讀取其安裝目錄下的檔案）。只認名字、不限定安裝路徑，但**載入成功以實際讀到檔案為判準**：本步須讀到其 `SKILL.md`，後續第 3 步的 type reference 與 output spec、第 5 步的 template 亦同（皆指 `diagram-design` 安裝目錄內的 `references/type-*.md`、`references/output-spec.md` 與 `assets/template-dark.html`，非 `map` 的 references）——任一讀不到即視為載入失敗，走 `map` 的晚停規則，不憑記憶、本檔摘要或風格印象湊合作畫。找不到安裝位置時先問使用者要路徑，再決定繼續或晚停。
2. 依其 **§3（Selection: semantic pattern, then visual type）** 選型：模組邊界圖多為 Architecture 型，狀態機用 State 型，循序圖用 Sequence 型。
3. 載入選型對應的 `references/type-*.md`（如 `type-architecture.md`）與 `references/output-spec.md`——**後者不可略過**：本檔 profile 的 `size`／`detail`／`audience` 定義都在該檔（§2–§4），而上游只從 import 路徑指向它；載入後、繪圖前，宣告 visual type、固定 render profile、主流程方向與因複雜度預算將省略的內容。
4. 把中介表示四張表（見 `../intermediate-tables.md`）原樣交給 provider；不得先翻譯成座標、方格角色或自製 page shell。
5. 以 `template-dark.html` 為頁面基底，依 provider 規則產生 HTML/SVG 並完成 taste gate（繪圖前的自我檢核清單，不含開瀏覽器驗圖），完成即交回 `map` 第 5 步。

**不做繪後目視檢查**：產出直接交付，圖面品質由使用者目視回饋。使用者反饋圖面問題時，重新載入 `diagram-design` 與所選 type reference 依其規則修正，不得由 caller 直接 patch。

## SVG 交接模式（多圖頁）

大綱頁與主題頁（多張圖同頁）適用；單圖頁不用本節，照上方交付步驟全包 HTML。

- 每張圖仍走完整交付步驟 1–5 產出 HTML，隨後抽取其中**第一個 `<svg>` 區塊**原樣交回 `map` inline 組頁。SVG 須自包含：樣式全 inline、不依賴頁面 CSS class（上游 template 本即如此，交接時驗一次）。
- **不走上游 export 的 standalone 程序**：不注入 Google Fonts `@import`、不加 `<?xml ?>` 宣告——字型由 `map` 組頁統一掛 `<link>`（序沿用下方「繁體中文字型」）。保留 `viewBox`、`role="img"`、`aria-labelledby` 與 `<title>`／`<desc>`。
- **ID 命名空間化**：上游只對 `<title>`／`<desc>` 加 per-diagram 前綴，`<defs>` 內的 `arrow`／`arrow-accent`／`arrow-link`／`dots` 都是固定字面 id。多張 SVG inline 同頁時這些 id 重複，所有 `url(#…)` 一律解析到第一張的定義——marker 或 dot pattern 一有色差，後幾張就靜默吃到第一張的顏色，而本流程不做繪後目視檢查、抓不到。組頁前對每張 SVG 的 defs id 與其 `url(#…)` 引用一律加 `<圖 slug>-` 前綴。此為同頁 inline 的機械改寫、不含圖面決策，是 `map` 責任邊界「不直接修補 SVG 內容」的唯一例外。
- 頁面骨架由 `map` 的「多圖組頁」承載，樣式自本模式第一張圖的產出頁 `<style>` 抽取沿用；「1:1 渲染」條對組頁後的頁面 CSS 同樣生效。
- **跨圖同色**（主題頁）：後續每張圖的呼叫附上前圖對應元素的色票（`map` 自前圖 SVG 抽取），provider 對同一語意實體沿用同色——這是轉述 provider 先前的用色，不是 caller 自創圖面決策。

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

- **`種類=禁止`**：短虛線＋停止符號（如 `⊥`）＋路徑終止於邊界。用普通 Architecture 型即可，不必用 `Secure paved road` 語意模式（其自帶 ≤2 forbidden paths 預算；普通型的邊數受當次 detail 預算管——本 profile 預設 `faithful`，上游 §7 的 12 條箭頭預算對它明文豁免，改以 ≤32 邊計）。禁止邊用 ink 色＋符號呈現，不佔 coral（coral 留給 focal 節點）。
