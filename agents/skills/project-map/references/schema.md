# 資料格式

地圖由兩份可編輯檔案構成：`project-map.json` 管結構，`evidence/sources.json` 管程式碼依據。
所有路徑使用專案根目錄相對路徑，所有識別碼使用穩定的 ASCII kebab-case。

## project-map.json

```json
{
  "schemaVersion": 2,
  "project": {"name": "example", "summary": "專案的一句話用途", "updatedAt": "2026-08-27T00:00:00Z"},
  "groups": [{"id": "authentication", "label": "認證", "description": "登入與 token 生命週期"}],
  "nodes": [{"id": "api", "label": "HTTP API", "kind": "service", "group": "authentication", "summary": "接收外部請求", "status": "active", "notes": []}],
  "edges": [{"id": "api-to-db", "from": "api", "to": "database", "label": "findUserById", "status": "active"}],
  "flows": [{"id": "login", "label": "登入流程", "summary": "使用者登入的主要路徑", "steps": [{"node": "web", "label": "提交帳密"}, {"node": "api", "label": "驗證"}]}],
  "questions": [{"id": "q-auth-1", "text": "Token 在何處撤銷？", "status": "open"}]
}
```

`label` 是圖上唯一會顯示的關係說明，寫具體的函式名、型別條件或協定，不要寫「呼叫」這類泛稱。

必要欄位：根物件需要 `schemaVersion`、`project`、`nodes`、`edges`；node 需要 `id`、`label`、`kind`、`summary`；edge 需要 `id`、`from`、`to`、`label`；flow step 必須引用既有 node。

`kind` 建議值：`entrypoint`、`ui`、`service`、`module`、`database`、`queue`、`external`、`job`、`library`。

**`groups` 決定模組分頁**：每個 group 產生一頁 `modules/<group-id>.html`，內容為該 group 的節點加上所有進出邊，對端節點以外部樣式呈現並連往其所屬模組頁。因此 group 應以功能領域切分（`authentication`、`billing`、`api`），而非「前端／後端」這類過寬的分層；group id 會直接成為檔名。未指定 `group` 的節點只出現在總覽。

## evidence/sources.json

以 node id 或 edge id 為 key，值為證據陣列。node 與 edge 的 evidence 都放這裡，主檔不再內嵌。

```json
{
  "schemaVersion": 1,
  "sources": {
    "api": [{"path": "src/server.ts", "line": 12}],
    "api-to-db": [{"path": "src/repository.ts", "line": 30, "note": "查詢使用者"}]
  }
}
```

`path` 必填，`line` 與 `note` 可選。沒有證據的 node／edge 可以不出現在此檔，UI 會顯示「尚無程式碼證據」。

## 驗證不變量

由 `render_project_map.py --check` 強制執行：

- node、edge、flow、group 各自的 id 不得重複，且必須符合 ASCII kebab-case。
- **node id 與 edge id 不得互相撞名**——evidence 以單一 id 空間索引，撞名會讓證據掛錯對象。
- edge 的 `from`、`to` 必須引用既有 node；node 的 `group` 必須引用既有 group。
- flow step 的 `node` 必須引用既有 node。
- `sources` 的每個 key 必須對應既有 node 或 edge（孤兒條目視為錯誤，代表結構刪了而證據沒清）。
- evidence 的 `path` 不得為絕對路徑或含 `..`。
