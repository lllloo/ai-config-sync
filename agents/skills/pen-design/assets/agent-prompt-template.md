# Subagent Prompt 範本

派發 `Agent` tool（`Explore` subagent type）時，複製對應模式的骨架，把 `<...>` 換成實際值。

---

## 切版模式 subagent prompt

```
你是切版助手。只處理「<區塊名稱>」，不要碰其他區塊。

## 設計稿節點
- 檔案：<path>.pen
- 主節點：<ROOT_SUB_ID>
- 相關子節點：[<id_1>, <id_2>, ...]

## 必讀
開工前依序 `Read`：
1. `~/.claude/skills/pen-design/references/golden-rules.md`——三條黃金守則，違反會讓後續所有產出不可信
2. `~/.claude/skills/pen-design/references/pen-output-patterns.md`——`batch_get` 真實輸出的 6 種 pattern 範例，第一次讀 Pencil JSON 必看，能避免把 `descendants` 兩種模式搞混

讀完再繼續下面的工作步驟。

## 工作步驟
1. `Read` 上面兩份 references
2. `mcp__pencil__get_editor_state({include_schema: true})`（僅首次載入 schema）
3. `mcp__pencil__batch_get` 抓上列節點，`readDepth: 3-4`，**務必帶 `resolveVariables: true`**
4. **對每個有 `ref` 屬性的節點，另外 `batch_get` 該 reusable component 本體**，看 `name` 判斷語意、記錄子節點預設 `fill` / `stroke`
5. `mcp__pencil__get_screenshot` 截圖
6. 輸出結構 spec（見下方格式），**不要寫 Vue 檔案**

## 重點萃取項
（主流程填入具體項目）
- 顏色：背景 fill、文字 fill、border stroke（hex 值）
- 間距：padding、gap（px）
- 對齊：主軸 / 交叉軸方向
- 元件語意：ref 指向的 reusable 是什麼（查 name 後對應 Vue 元件）
- 寬度策略：fill_container / fit_content / 固定 px
- 邊框：stroke thickness、cornerRadius

## 設計系統變數對照
（主流程從 `batch_get` 的 `resolveVariables` 結果抽出該專案實際用到的變數，填在這裡。範例格式：）
- $size/gap/<name> = <px>
- $color/<group>/<name> = #<hex>
- $radius/<name> = <px>

**不要**照抄下面的範例值——每個專案的 token 名稱與數值都不同，照抄會讓 subagent 用錯色。

## 輸出格式（spec）

請用以下格式回報，不要寫 Vue 檔案：

### 區塊：<區塊名稱>
**結構**：（文字描述巢狀關係，例如「flex-col，包含 header row 和 content grid」）

**Tailwind 建議**：
```html
<!-- 外層容器 -->
<div class="flex flex-col gap-4 p-4 bg-[#f5f5f5]">
  <!-- 標題 -->
  <h2 class="text-base font-bold text-[#002447]">...</h2>
  ...
</div>
```

**Vue 元件對應**：
- `<節點名>` → `<FormFieldRow type="input" label="...">` （或其他對應元件）

**顏色摘要**：
- 背景：#xxx
- 文字：#xxx
- border：#xxx / Npx

**注意事項**：（列出 override 規則、特殊尺寸、或可疑之處）

限 500 字以內。
```

---

## 核對模式 subagent prompt

```
你是切版核對助手。只核對「<區塊名稱>」，不要碰其他區塊。

## 設計稿節點
- 檔案：<path>.pen
- 主節點：<ROOT_SUB_ID>
- 相關子節點：[<id_1>, <id_2>, ...]

## Vue / React 對應段落
- 檔案：<path>.vue
- **行 N-M**（務必給精確範圍，不要整份檔案）

## 必讀
開工前依序 `Read`：
1. `~/.claude/skills/pen-design/references/golden-rules.md`——三條黃金守則。**特別注意：既有 Vue 可能是錯的**，不要因為 Vue 寫了 checkbox 就相信它是 checkbox，一定要去查 ref 本體
2. `~/.claude/skills/pen-design/references/pen-output-patterns.md`——`batch_get` 真實輸出的 6 種 pattern 範例，避免把 `descendants` 兩種模式搞混

讀完再繼續下面的工作步驟。

## 工作步驟
1. `Read` 上面兩份 references
2. `mcp__pencil__get_editor_state({include_schema: true})`（僅首次載入 schema）
3. `mcp__pencil__batch_get` 抓上列節點，`readDepth: 3-4`，**務必帶 `resolveVariables: true`**
4. **對每個有 `ref` 屬性的節點，另外 `batch_get` 該 reusable component 本體**，看 `name` 判斷語意、記錄子節點預設 `fill` / `stroke`
5. `mcp__pencil__get_screenshot` 截圖
6. `Read` Vue 對應行範圍
7. 比對，實際顯示值 = `instance override ?? component 預設值`

## 重點檢查項
（主流程填入具體項目）
- 顏色：背景 fill、文字 fill、border stroke
- 間距：padding、gap、margin
- 對齊：justifyContent、alignItems、textAlign
- 元件語意：ref 指向的 reusable 到底是什麼（查 name）
- 寬度策略：fill_container / fit_content / 固定 px
- 邊框：stroke thickness 每邊、cornerRadius

## 設計系統變數對照
（主流程從 `batch_get` 的 `resolveVariables` 結果抽出該專案實際用到的變數，填在這裡。範例格式：）
- $size/gap/<name> = <px>
- $color/<group>/<name> = #<hex>
- $radius/<name> = <px>

**不要**照抄下面的範例值——每個專案的 token 名稱與數值都不同，照抄會讓 subagent 用錯色。

## 回報格式
按嚴重度分類，每項請標明：
- Vue 行號
- 設計節點 ID
- 差異描述
- 修正建議

| 嚴重度 | 判斷標準 |
|---|---|
| 嚴重 | 顏色錯、元件語意錯、結構錯位 |
| 中度 | 間距差 / 邊框缺失 / 對齊偏差 |
| 輕微 | 字體大小差 1-2px、圓角 1-2px |

限 500 字以內，不要動手修改檔案。
```

---

## 使用提醒

- **不要**把整個範本直接送出，必須針對區塊客製化「重點萃取項/檢查項」與「設計系統變數對照」
- **不要**讓單一 agent 處理超過 ~400 行展開後的 JSON — 拆更小
- **要**在單一訊息中用多個 `Agent` tool_use block 同時派發（並行）
- **要**在 prompt 明確寫「不要碰其他區塊」避免重工
- **切版模式**：subagent 只輸出 spec，**主流程統一寫 Vue 檔案**
