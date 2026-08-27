# 中介表示：繪圖器 JSON

`map-fast` 第 3 步的產出格式，也是第 4 步餵給繪圖器的唯一**內容輸入**。直接寫成 JSON，不先做表格再翻譯。四個區塊：`nodes`、`edges`、`groups`、`omitted`（前兩者必備）。

欄位名稱、必填與否、完整 schema 見 `renderer.md`；本檔只規範**語意**。

## 語意邊界

JSON 只承載語意與範圍。不得包含座標（x/y）、viewBox、方格尺寸、字型、配色、CSS／SVG primitive 或其他圖面提示；這些全部由繪圖器決定。

- 不得為了排版好看而發明節點或邊。
- 因複雜度收斂而合併或省略內容時，寫進 `omitted`，且不得改變原關係的語意。
- 內容不足以決定時，退回第 2 步補查證，不得猜測。

## `nodes`

| 欄位 | 說明 |
|---|---|
| `id` | 唯一識別字，供 `edges` 引用；ASCII kebab-case（小寫英數與 `-`），不含空白 |
| `label` | 圖上顯示的名稱，可含中文 |
| `layer` | 節點所屬的層或邊界（如 `CLI 入口`、`功能模組`），顯示為節點副標，與 `groups` 對應 |

## `edges`

| 欄位 | 說明 |
|---|---|
| `from` / `to` | `nodes[].id` |
| `label` | 箭頭標籤，必填，如 `require`、`DI 注入`、`呼叫`、`寫入`、`symlink` |

## 只畫存在的關係

邊的方向與 `label` 必須對應實際看到的證據；只看到 A 呼叫 B，不得反推 B 呼叫 A。

**不畫「不存在」的關係。** 沒有線本身就已經表示「不會這樣跑」，再畫一條標著「禁止」的線只是把同一件事說兩次。約束（明文禁令、被回歸鎖擋住的反向依賴、對敏感檔的零觸碰、刻意不提供的反向流程）寫進 `groups[].boundary`，或列進 `omitted`。

## `groups`

框選分層或邊界。每組有組名（`label`）、成員（`members`：節點 `id` 清單）、代表的邊界語意一句話（`boundary`），另需自取 ASCII kebab-case 的 `id`。

**節點超過 9 個時**：須為 2–4 組，且每個節點都要入組——未分區的 20 節點圖是配線圖、不是示意圖。分不出 2–4 組就是節點選太雜，回第 3 步收斂範圍。

## `omitted`

字串陣列，兩類都要列：**沒展開的區塊**（超出範圍、可再展開）與**刻意不畫的東西**（一對一對照改用表格、目錄樹等）。這是第 5 步「說明圖中未包含的範圍」的來源，也會出現在產出頁側欄的「圖中未包含」。

## 完整範例（本 repo 模組邊界）

```json
{
  "title": "ai-config-sync 模組邊界",
  "question": "共用工具怎麼流到各功能模組？",
  "nodes": [
    { "id": "sync", "label": "sync.js", "layer": "CLI 入口" },
    { "id": "safety", "label": "safety-check.js", "layer": "功能模組" },
    { "id": "skills", "label": "skills.js", "layer": "功能模組" },
    { "id": "xtool", "label": "xtool-dir.js", "layer": "功能模組" },
    { "id": "toml", "label": "toml-reader.js", "layer": "純函式" }
  ],
  "edges": [
    { "from": "sync", "to": "safety", "label": "DI 注入（createSafetyChecker）" },
    { "from": "sync", "to": "skills", "label": "DI 注入（createSkillsHandler）" },
    { "from": "sync", "to": "xtool", "label": "DI 注入（createXtoolDir）" },
    { "from": "safety", "to": "toml", "label": "require" }
  ],
  "groups": [
    { "id": "cli", "label": "CLI 入口", "members": ["sync"],
      "boundary": "唯一入口，共用工具由此以 DI 注入功能模組" },
    { "id": "mods", "label": "功能模組", "members": ["safety", "skills", "xtool"],
      "boundary": "共用工具一律經 createXxx(deps) 注入；不得反向 require sync.js，boundary.test.js 有回歸鎖" },
    { "id": "pure", "label": "純函式", "members": ["toml"],
      "boundary": "零 IO，可被功能模組直接 require" }
  ],
  "omitted": [
    "沒展開：test/ 各測試檔與 drift-guard 細節；SYNC_MANIFEST 的各同步項",
    "刻意不畫：~/.claude.json 與 config.toml 的零觸碰約束（沒有邊即代表不觸碰，改寫在群組邊界）",
    "刻意不畫：repo 路徑 ↔ 本機路徑的一對一對應（改用表格）；目錄樹"
  ]
}
```

其餘欄位（`nodes[].note`、`edges[].note` 等）見 `renderer.md`。
