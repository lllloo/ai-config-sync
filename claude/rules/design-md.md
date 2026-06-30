# DESIGN.md 視覺一致性規則

專案根目錄有 `DESIGN.md` 時，它是該專案視覺語言的 single source of truth；產生或修改 UI 前先讀它。沒有則跳過，不臆造、不阻擋。

- **tokens（YAML frontmatter）是規範值**：直接取用 `colors`／`typography`／`rounded`／`spacing`／`components`，不 hard-code 等價的 hex／字級／圓角／間距。
- **tokens 未涵蓋處依 body 的設計意圖判斷**，不退回 generic 預設（隨意漸層／陰影／圓角）。

格式為開放規範 [google-labs-code/design.md](https://github.com/google-labs-code/design.md)，與 Stitch 等工具無關。需驗證時隨用隨跑 `npx @google/design.md lint DESIGN.md`，不安裝。
