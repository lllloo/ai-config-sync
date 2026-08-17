# Provider adapter：artifact-diagramming

`map` 第 5 步的次選 provider（優先序 2，`diagram-design` 不可用時）。它是 Claude Code 內建、為發佈 Artifact 頁面而寫的 diagramming skill；本 adapter **只取其 inline SVG 繪製手法**（何時值得畫圖、如何呈現機制、佈局與可讀性），產出仍是 `map` 的本地 HTML 檔。

## 交付步驟

1. 載入 `artifact-diagramming` skill。載入不了就走 `map` 的晚停規則。
2. 只取 SVG 手法產圖，把中介表示四張表（見 `../intermediate-tables.md`）翻成圖，套用下方界線與覆寫。

## 使用界線（必守）

- **禁止呼叫 `Artifact` 工具**、禁止任何發佈動作（claude.ai 或其他網路空間）。產出一律寫成本地 HTML 檔，落點依 `map` 的「產出成頁面」。
- 其 Artifact viewer 專屬內容（viewer 主題三態、發佈流程、favicon 等）全部不適用，忽略。

## 主題（固定深色）

固定產**深色版、單檔**：不產 light 版、不做 `prefers-color-scheme`／`data-theme` 主題切換。其「theme-aware 雙主題」指引不適用——深色 token 直接定在 `:root`，不寫切換分支。

## 約束與驗證狀態不得丟失

中介表示的 `種類`／`驗證` 兩欄須降級成明確可見的形式，第 6 步驗收：

- **`種類=禁止`**：短虛線＋停止符號、路徑終止於邊界，不只靠顏色。
- **`驗證=文件主張`**：細虛線框＋標註＋legend。

無法在圖上表達時，降級為圖下的文字清單，不得靜默丟棄。

## CJK 注意

中文標籤寬約為同字數拉丁字串的 1.6 倍：箭頭標籤 ≤8 字、標籤字級 ≥12px、接點間距 ≥20px、標籤留白與遮罩依實際渲染寬度估，不套拉丁字元數公式。
