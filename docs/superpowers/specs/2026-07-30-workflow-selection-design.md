# Superpowers 手動啟動規則設計

## 目標

讓 Codex 與 Claude 不因 task 類型或可用 skill 自行啟動 Superpowers，只有在使用者明確要求或呼叫時才進入 Superpowers 流程。

## 適用範圍

- Codex 全域規則：`codex/AGENTS.md`
- Claude 全域規則：`claude/CLAUDE.md`
- 本次只新增流程選擇規則，不修改 skill、CLI 或 OpenSpec 文件格式。

## 啟動規則

Superpowers 僅在使用者明確要求使用 Superpowers，或明確呼叫其 skill 時才能啟動；不得因 task 類型、文件資料夾、skill 安裝狀態或模型判斷可能適用而自行啟動。

## 驗證方式

以 `rg` 確認兩份全域規則都包含相同的判定語意，以 `git diff --check` 檢查 Markdown 格式，並確認工作樹只包含本次預期文件。
