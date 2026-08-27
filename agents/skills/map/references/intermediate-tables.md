# 中介表示：四張表

`map` 第 3 步的產出格式，也是第 4 步餵給 `diagram-design` 的唯一**內容輸入**。四個區塊缺一不可：**節點表**、**邊表**、**群組**、**省略**。adapter 另附的固定 render profile 只控制呈現，不得增加內容事實。

## 語意邊界

四表只承載語意與範圍。不得包含座標（x/y）、viewBox、方格尺寸、字型、配色、模板、CSS／SVG primitive、焦點樣式或其他圖面提示；這些全部由 `diagram-design` 決定。

- provider 不得憑排版需要發明節點或邊。
- provider 因複雜度預算合併或省略內容時，必須依 `diagram-design` 的 fidelity ledger 回報，且不得改變原關係的語意。
- provider 若發現四表不足以決定內容，須退回 `map` 補查證，不得自行猜測。

## 節點表

| 欄位 | 說明 |
|---|---|
| `id` | 唯一識別字，供邊表引用；用英數與 `-`，不含空白 |
| `label` | 圖上顯示的名稱，可含中文 |
| `分層` | 節點所屬的層或邊界（如 `CLI 入口`、`功能模組`），與群組區塊對應 |

## 邊表

| 欄位 | 說明 |
|---|---|
| `from` / `to` | 節點表的 `id` |
| `關係` | 箭頭標籤，必填，如 `require`、`DI 注入`、`呼叫`、`寫入`、`symlink` |

循序圖以邊表由上到下的列序為訊息時序，provider 依列序繪製、不得重排；其他圖型的邊表列序不帶語意。

## 方向與證據

邊的方向與 `關係` 必須對應實際看到的證據；只看到 A 呼叫 B，不得反推 B 呼叫 A。查不到依據的關係不畫，寫進省略表。

## 群組

框選分層或邊界。每組一列：組名、成員（節點 `id` 清單）、代表的邊界語意（一句話）。

**節點超過 9 個時**：群組須為 2–4 組，且每個節點都要入組。這是 `diagram-design` 對 `faithful` 的硬性條件（未分區的 20 節點圖是配線圖、不是示意圖），而 provider 依上方語意邊界不得自行發明分區，四表不滿足只能退回 `map` 重補、白跑一次 provider。分不出 2–4 組就是節點選太雜，回第 3 步收斂範圍。

## 省略

兩類都要列：**沒展開的區塊**（超出範圍、可再展開）與**刻意不畫的東西**（一對一對照改用表格、目錄樹等）。這是第 5 步「說明圖中未包含的範圍」的來源。

## 完整範例（本 repo 模組邊界）

### 節點表

| id | label | 分層 |
|---|---|---|
| sync | sync.js | CLI 入口 |
| safety | safety-check.js | 功能模組 |
| skills | skills.js | 功能模組 |
| xtool | xtool-dir.js | 功能模組 |
| toml | toml-reader.js | 純函式 |

### 邊表

| from | to | 關係 |
|---|---|---|
| sync | safety | DI 注入（createSafetyChecker） |
| sync | skills | DI 注入（createSkillsHandler） |
| sync | xtool | DI 注入（createXtoolDir） |
| safety | toml | require |

### 群組

| 組名 | 成員 | 邊界語意 |
|---|---|---|
| CLI 入口 | sync | 唯一入口，共用工具由此以 DI 注入功能模組 |
| 功能模組 | safety, skills, xtool | 不得反向 require sync.js |
| 純函式 | toml | 零 IO，可被功能模組直接 require |

### 省略

- 沒展開：`test/` 各測試檔與 drift-guard 細節；`SYNC_MANIFEST` 的各同步項。
- 刻意不畫：repo 路徑 ↔ 本機路徑的一對一對應（改用表格）；目錄樹；`~/.claude.json` 等「明文禁止觸碰」的約束（改寫成圖下的說明）。
