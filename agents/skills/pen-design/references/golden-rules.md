# 🚨 Pencil 切版/核對 — 三條黃金守則

任何讀取 `.pen` 設計稿並對應到前端程式碼的 subagent，動手前都必須遵守這三條。這不是建議，是踩過坑之後的硬規則。

## 守則 1：遇到 `ref` 必須 `batch_get` 本體

任何節點有 `ref: "xxx"` 屬性，都要另外用 `mcp__pencil__batch_get` 抓該 reusable component 的本體，至少看兩件事：

- `name` 屬性——**這才決定元件語意**。看起來像 checkbox 的東西可能是 `btn-xs`（按鈕）或 `form-title`（純 label）。**既有 Vue/React 實作不一定對**，有真實案例連續 4 個 agent 被既有錯誤程式誤導，沒人去查 ref 本體，整輪報告報錯。
- 每個子節點的**預設 fill / stroke**——下一條守則會用到。

## 守則 2：`descendants` 有兩種模式，先分清楚再讀

instance 的 `descendants` 有兩種完全不同的 override 模式，搞混會看錯整個結構：

**模式 A — 屬性 override**：`descendants.X` 裡只有屬性欄位（content / fill / x / y 等）
```json
{ "ref": "giHjx", "descendants": { "nI2Vj": { "fill": "#b5afc3" } } }
```
→ 只改 `nI2Vj` 的 `fill`，其他欄位、其他子節點用本體預設。
公式：`實際顯示值 = instance descendants override ?? component 本體預設值`
真實案例：只 override 期別欄 `#b5afc3`，但 2-4 欄在本體預設是 `#f0d0d0`。只看 override 會把對的改錯。

**模式 B — 整組 `children` 替換**：`descendants.X` 裡出現 `children` 陣列（或 `type` 欄位）
```json
{ "ref": "d5ZTS", "descendants": { "NvL81": { "children": [{"ref":"h12kK"}, ...] } } }
```
→ `NvL81` 本體的 children 完全不算，實際顯示的就是 override 裡這個 children 陣列。

**判斷**：看 `descendants.X` 是否有 `children` 或 `type` 欄位——有就是模式 B，沒有就是模式 A。

完整樣本見 `references/pen-output-patterns.md` pattern 4/5/6。

## 守則 3：`batch_get` 必須帶 `resolveVariables: true`

否則顏色/尺寸欄會是變數名（`$color/brand/navy-dark`），不是 hex。展開後才能直接對應 Tailwind class。沒帶這個參數就等於在猜，而猜通常會錯。

---

## 快速對照（貼在腦袋裡）

| 看到 | 要做 |
|---|---|
| `ref: "xxx"` | 另外 `batch_get` xxx 本體，記 name + 預設 fill/stroke |
| `descendants: {X: {...}}` | 只有 X 被改，其他維持本體預設 |
| `$color/...` 字串 | `batch_get` 忘了帶 `resolveVariables: true`，重抓 |
| 既有 Vue 寫 `<input type="checkbox">` | 不要信，去查 ref 本體的 name |
