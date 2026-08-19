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
| `種類` | `一般` 或 `禁止`（允許值見下） |
| `分層` | 節點所屬的層或邊界（如 `CLI 入口`、`功能模組`），與群組區塊對應 |

## 邊表

| 欄位 | 說明 |
|---|---|
| `from` / `to` | 節點表的 `id` |
| `關係` | 箭頭標籤，必填，如 `require`、`DI 注入`、`呼叫`、`寫入`、`symlink` |
| `種類` | `一般` 或 `禁止` |

## 允許值

- **`種類`**：只有 `一般`／`禁止` 兩值。`禁止` 不是「不存在」——是「被明文禁止」的關係或事物（如永不觸碰的檔案、被回歸鎖擋住的反向依賴），必須出現在圖上且明確可見。
邊的方向與 `關係` 必須對應實際看到的證據；只看到 A 呼叫 B，不得反推 B 呼叫 A，也不得把「沒有找到」標成 `種類=禁止`。`禁止` 僅表示文件、程式碼或測試明文禁止該關係。

## 群組

框選分層或邊界。每組一列：組名、成員（節點 `id` 清單）、代表的邊界語意（一句話）。

## 省略

兩類都要列：**沒展開的區塊**（超出範圍、可再展開）與**刻意不畫的東西**（一對一對照改用表格、目錄樹等）。這是第 5 步「說明圖中未包含的範圍」的來源。

## 完整範例（本 repo 模組邊界）

### 節點表

| id | label | 種類 | 分層 |
|---|---|---|---|
| sync | sync.js | 一般 | CLI 入口 |
| safety | safety-check.js | 一般 | 功能模組 |
| skills | skills.js | 一般 | 功能模組 |
| xtool | xtool-dir.js | 一般 | 功能模組 |
| toml | toml-reader.js | 一般 | 純函式 |
| claude-json | ~/.claude.json | 禁止 | 本機敏感檔 |

### 邊表

| from | to | 關係 | 種類 |
|---|---|---|---|
| sync | safety | DI 注入（createSafetyChecker） | 一般 |
| sync | skills | DI 注入（createSkillsHandler） | 一般 |
| sync | xtool | DI 注入（createXtoolDir） | 一般 |
| safety | toml | require | 一般 |
| safety | sync | require（反向依賴） | 禁止 |
| sync | claude-json | 讀寫 | 禁止 |

### 群組

| 組名 | 成員 | 邊界語意 |
|---|---|---|
| CLI 入口 | sync | 唯一入口，共用工具由此以 DI 注入功能模組 |
| 功能模組 | safety, skills, xtool | 不得反向 require sync.js |
| 純函式 | toml | 零 IO，可被功能模組直接 require |

### 省略

- 沒展開：`test/` 各測試檔與 drift-guard 細節；`SYNC_MANIFEST` 的各同步項。
- 刻意不畫：repo 路徑 ↔ 本機路徑的一對一對應（改用表格）；目錄樹。
