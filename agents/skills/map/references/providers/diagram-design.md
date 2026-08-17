# Provider adapter：diagram-design

`map` 第 5 步的首選 provider（優先序 1）。prompt-level 呼叫：介面是文字規範，載入後由 agent 自己寫 HTML。本檔只寫 `map` 側的交付步驟與覆寫；圖型選型、佈局、配色全依上游規範，不在此重述。

## 交付步驟

1. 以 harness 可用的方式載入 `diagram-design`（Claude Code 可直接呼叫該 skill；其他工具讀取其 SKILL.md）。只認名字、不檢查安裝路徑；載入不了就走 `map` 的晚停規則，不要湊合。
2. 依其 **§3（Selection: semantic pattern, then visual type）** 選型：模組邊界圖多為 Architecture 型，狀態機用 State 型，循序圖用 Sequence 型。
3. 載入選型對應的 `references/type-*.md`（如 `type-architecture.md`）。
4. 把中介表示四張表（見 `../intermediate-tables.md`）餵進去產圖，套用下方覆寫。

## CJK 度量覆寫（中文標籤必套）

上游的間距與字級常數照拉丁文校準，中文同字數寬約 1.6 倍，直接沿用會標籤碰撞（實測）。

| 上游規則 | CJK 覆寫 |
|---|---|
| 箭頭標籤 ≤14 字元、all-caps | 中文 ≤8 字；all-caps 對中文無意義，取消 |
| 標籤字級 8px | 12px（4px grid 的下一階） |
| eyebrow 7px | 沿用，但僅限純拉丁內容 |
| 接點間距 ≥12px | ≥20px |
| 遮罩寬度依字元數估 | 依實測 bbox |

## 約束與驗證狀態的降級規則

中介表示的 `種類`／`驗證` 兩欄不得在翻譯中丟失，第 6 步驗收：

- **`種類=禁止`**：短虛線＋停止符號（如 `⊥`）＋路徑終止於邊界。用普通 Architecture 型即可，不必用 `Secure paved road` 語意模式（其自帶 ≤2 forbidden paths 預算；普通型只受總箭頭預算 12 限制）。禁止邊用 ink 色＋符號呈現，不佔 coral（coral 留給 focal 節點）。
- **`驗證=文件主張`**：細虛線節點框／邊＋sublabel＋legend 三件套，不需要上游原生支援。

## 主題（固定深色）

固定產**深色版、單檔**：不產 light 版、不做 `prefers-color-scheme`／`data-theme` 主題切換。上游把 hex 硬編碼進 SVG，固定深色使其配色機制原樣可用，無需任何顏色覆寫。

## 交付前檢查不得依賴上游工具

- `self_check.py` 只驗 accessible SVG contract、單檔安全與 motion，**抓不到標籤碰撞**。
- `verify-geometry.py` 未隨 skill 打包（安裝版 scripts 只有 3 支），其 SKILL.md 點名它時指的是上游 repo。

標籤碰撞與連接線交疊須自行驗證（`map` 第 6 步），不得以「上游檢查通過」代替。
