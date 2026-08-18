# 中介表示：四張表

`map` 第 4 步的產出格式，也是第 5 步餵給 `diagram-design` 的唯一**內容輸入**。四個區塊缺一不可：**節點表**、**邊表**、**群組**、**省略**。adapter 另附的固定 render profile 只控制呈現，不得增加內容事實。

## 語意邊界

四表只承載語意、範圍與驗證證據。不得包含座標（x/y）、viewBox、方格尺寸、字型、配色、模板、CSS／SVG primitive、焦點樣式或其他圖面提示；這些全部由 `diagram-design` 決定。

- provider 不得憑排版需要發明節點、邊或驗證狀態。
- provider 因複雜度預算合併或省略內容時，必須依 `diagram-design` 的 fidelity ledger 回報，且不得改變原關係的語意。
- provider 若發現四表不足以決定內容，須退回 `map` 補查證，不得自行猜測。

## 節點表

| 欄位 | 說明 |
|---|---|
| `id` | 唯一識別字，供邊表引用；用英數與 `-`，不含空白 |
| `label` | 圖上顯示的名稱，可含中文 |
| `種類` | `一般` 或 `禁止`（允許值見下） |
| `分層` | 節點所屬的層或邊界（如 `CLI 入口`、`功能模組`），與群組區塊對應 |
| `驗證` | `已驗證` 或 `文件主張`（允許值見下） |

## 邊表

| 欄位 | 說明 |
|---|---|
| `from` / `to` | 節點表的 `id` |
| `關係` | 箭頭標籤，必填，如 `require`、`DI 注入`、`呼叫`、`寫入`、`symlink` |
| `種類` | `一般` 或 `禁止` |
| `驗證` | `已驗證` 或 `文件主張` |

## 允許值

- **`種類`**：只有 `一般`／`禁止` 兩值。`禁止` 不是「不存在」——是「被明文禁止」的關係或事物（如永不觸碰的檔案、被回歸鎖擋住的反向依賴），必須出現在圖上且明確可見。
- **`驗證`**：只有 `已驗證`／`文件主張` 兩值。
  - `已驗證`：**必須附出處**——測試檔名（如 `boundary.test.js`）或原始碼位置（如 `sync.js` 的 `createSafetyChecker` 呼叫處）。無出處不得標 `已驗證`。出處直接寫在 `驗證` 欄，如 `已驗證（boundary.test.js）`。
  - `文件主張`：只在 `AGENTS.md`／`CLAUDE.md`／`README.md`／spec 等文件出現、尚未以程式碼或測試核對的主張。

## 群組

框選分層或邊界。每組一列：組名、成員（節點 `id` 清單）、代表的邊界語意（一句話）。

## 省略

兩類都要列：**沒展開的區塊**（超出範圍、可再展開）與**刻意不畫的東西**（一對一對照改用表格、目錄樹等）。這是第 6 步「說明圖中未包含的範圍」的來源。

## 完整範例（本 repo 模組邊界）

### 節點表

| id | label | 種類 | 分層 | 驗證 |
|---|---|---|---|---|
| sync | sync.js | 一般 | CLI 入口 | 已驗證（package.json scripts） |
| safety | safety-check.js | 一般 | 功能模組 | 已驗證（sync.js 的 createSafetyChecker 呼叫處） |
| skills | skills.js | 一般 | 功能模組 | 已驗證（sync.js 的 createSkillsHandler 呼叫處） |
| xtool | xtool-dir.js | 一般 | 功能模組 | 已驗證（sync.js 的 createXtoolDir 呼叫處） |
| toml | toml-reader.js | 一般 | 純函式 | 已驗證（safety-check.js 的 require） |
| claude-json | ~/.claude.json | 禁止 | 本機敏感檔 | 已驗證（apply-integration.test.js 內容+mtime 雙重斷言） |

### 邊表

| from | to | 關係 | 種類 | 驗證 |
|---|---|---|---|---|
| sync | safety | DI 注入（createSafetyChecker） | 一般 | 已驗證（sync.js） |
| sync | skills | DI 注入（createSkillsHandler） | 一般 | 已驗證（sync.js） |
| sync | xtool | DI 注入（createXtoolDir） | 一般 | 已驗證（sync.js） |
| safety | toml | require | 一般 | 已驗證（safety-check.js） |
| safety | sync | require（反向依賴） | 禁止 | 已驗證（boundary.test.js 回歸鎖） |
| sync | claude-json | 讀寫 | 禁止 | 已驗證（apply-integration.test.js） |

### 群組

| 組名 | 成員 | 邊界語意 |
|---|---|---|
| CLI 入口 | sync | 唯一入口，共用工具由此以 DI 注入功能模組 |
| 功能模組 | safety, skills, xtool | 不得反向 require sync.js |
| 純函式 | toml | 零 IO，可被功能模組直接 require |

### 省略

- 沒展開：`test/` 各測試檔與 drift-guard 細節；`SYNC_MANIFEST` 的各同步項。
- 刻意不畫：repo 路徑 ↔ 本機路徑的一對一對應（改用表格）；目錄樹。
