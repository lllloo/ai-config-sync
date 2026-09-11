# 繪圖器：`scripts/render-map.js`

把 `map-fast` 第 3 步的 JSON 算成佈局，產出無外部相依的深色單檔 HTML。Node.js >= 18，零 npm 相依；佈局用同目錄 `vendor/elkjs`。

## 指令

```bash
# 只驗資料、不寫檔（先跑這個，錯誤訊息會指出是哪個節點／邊有問題）
node <skill 目錄>/scripts/render-map.js <圖譜.json> --check

# 產出頁面
node <skill 目錄>/scripts/render-map.js <圖譜.json> -o <輸出.html>
```

輸出目錄不存在會自動建。輸入 JSON 屬中間產物：一次性的圖連同 JSON 一起放 scratchpad；要進版控的圖則 JSON 與 HTML 一起放 `docs/architecture/`，之後改圖直接改 JSON 重跑。

## 輸入 JSON

```json
{
  "title": "ai-config-sync 模組邊界",
  "question": "共用工具怎麼流到各功能模組？",
  "nodes": [
    { "id": "sync", "label": "sync.js", "layer": "CLI 入口" },
    { "id": "safety", "label": "safety-check.js", "layer": "功能模組" },
    { "id": "toml", "label": "toml-reader.js", "layer": "純函式" }
  ],
  "edges": [
    { "from": "sync", "to": "safety", "label": "DI 注入（createSafetyChecker）" },
    { "from": "safety", "to": "toml", "label": "require" }
  ],
  "groups": [
    { "id": "cli", "label": "CLI 入口", "members": ["sync"],
      "boundary": "唯一入口，共用工具由此以 DI 注入功能模組" },
    { "id": "mods", "label": "功能模組", "members": ["safety"],
      "boundary": "不得反向 require sync.js" },
    { "id": "pure", "label": "純函式", "members": ["toml"],
      "boundary": "零 IO，可被功能模組直接 require" }
  ],
  "omitted": [
    "沒展開：test/ 各測試檔與 drift-guard 細節",
    "刻意不畫：repo 路徑 ↔ 本機路徑的一對一對應（改用表格）"
  ]
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `title` | ✅ | 頁標題與側欄標題 |
| `question` | | 第 1 步固定的那句讀者問題，顯示在標題下與側欄 |
| `nodes[].id` | ✅ | ASCII kebab-case，全檔唯一 |
| `nodes[].label` | ✅ | 節點主標，可含中文 |
| `nodes[].layer` | ✅ | 節點副標（分層） |
| `nodes[].group` | | 群組 id。與 `groups[].members` 二擇一，不可互相矛盾 |
| `nodes[].note` | | 點該節點時側欄顯示的一句補充 |
| `edges[].from`/`to` | ✅ | 節點 id |
| `edges[].label` | ✅ | 箭頭標籤（關係） |
| `edges[].id` | | 省略時自動編號；只有想在多次產出間穩定引用才需自填 |
| `edges[].note` | | 點該關係時側欄顯示的一句補充 |
| `groups[].id` | ✅ | ASCII kebab-case |
| `groups[].label` | ✅ | 分區框標題與圖例文字 |
| `groups[].members` | | 節點 id 陣列 |
| `groups[].boundary` | | 邊界語意一句話，顯示在側欄「群組邊界」 |
| `omitted[]` | | 字串陣列，顯示在側欄「圖中未包含」 |

**`--check` 會擋下的錯誤**：id 重複或非 kebab-case、`label`／`layer`／邊 `label` 缺漏、邊引用不存在的節點、群組成員不存在、節點同時屬於兩組、**孤立節點**（沒有任何邊）。這些對應 SKILL.md 的硬約束，不要靠改繪圖器繞過，回去改 JSON。

## 圖面規格（繪圖器已固定，不必也不該逐次指定）

- **佈局**：ELK `layered`、方向 `DOWN`、正交路由、標籤內聯（由 ELK 自行避開節點與彼此）。群組是 ELK 的子圖，分區框大小與位置由佈局層決定。
- **配色**：固定深色。群組各配一色，節點左緣色條與副標跟著群組走；邊的線色由來源群組漸變到目標群組，箭頭取目標群組色。
- **字型**：系統字型序（`-apple-system` → `PingFang TC` → `Noto Sans TC` → `Microsoft JhengHei`），不連 Google Fonts，離線可開。
- **互動**（約 175 行行內 JS，無外部相依）：滾輪縮放、拖曳平移、點節點只留直接鄰居其餘淡出、點關係線看該關係、點空白處回總覽、`重設檢視` 鈕回初始狀態。側欄總覽顯示標題、讀者問題、節點／關係／群組計數、群組邊界與「圖中未包含」。
- **尺寸**：畫布大小由內容 bounding box（含邊標籤）推導，開頁時自動 fit；視窗改變時重新 fit。

要改上述任何一項，改繪圖器本體並複跑範例確認，**不要手改產出的 HTML**——下次重產就沒了。
