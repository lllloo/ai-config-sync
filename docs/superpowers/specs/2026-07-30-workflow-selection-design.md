# Superpowers 與 OpenSpec 流程選擇設計

## 目標

當專案同時具備 Superpowers 與 OpenSpec 流程時，讓 Codex 與 Claude 先從專案文件判斷是否已有流程上下文；只有無法可靠判定時才詢問使用者。

## 適用範圍

- Codex 全域規則：`codex/AGENTS.md`
- Claude 全域規則：`claude/CLAUDE.md`
- 本次只新增流程選擇規則，不修改 skill、CLI 或 OpenSpec 文件格式。

## 判定規則

1. 先找與目前 task 對應的未完成文件。
2. OpenSpec 的證據來源是 `openspec/changes/` 下的相關 change。
3. Superpowers 的證據來源是 `docs/superpowers/specs/`、`docs/superpowers/plans/` 等相關文件。
4. 只有其中一套流程有對應的既有文件時，沿用該流程。
5. 兩套流程都有對應文件、只有歷史 archive、或無法確認文件與目前 task 的關係時，先詢問使用者。
6. skill 已安裝或資料夾本身存在，不足以單獨決定流程。
7. Superpowers 僅在使用者明確要求使用 Superpowers，或明確呼叫其 skill 時才能啟動；不得因 task 類型、文件資料夾、skill 安裝狀態或模型判斷可能適用而自行啟動。

## 驗證方式

以 `rg` 確認兩份全域規則都包含相同的判定語意，以 `git diff --check` 檢查 Markdown 格式，並確認工作樹只包含本次預期文件。
