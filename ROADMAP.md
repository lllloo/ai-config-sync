# Roadmap

未排程的候選項目。動工前建議以 OpenSpec change proposal 收斂設計。

## `--area` 旗標：單工具範圍同步

**動機**：`SYNC_MANIFEST` 每列已有 `area` 欄位（`claude`／`codex`／`agents`），邏輯上已分區，但操作層只能全量同步。加 `--area <name>` 讓 `diff`／`to-repo`／`to-local` 可縮小到單一 area，主要價值是 `to-local` 時縮小 blast radius（只收某一 area 的 repo 端變更，不動其他 area 的本機檔）。

**實作落點**（2026-07 探索結論）：

- 過濾點唯一：`buildSyncItems(direction)` 對 `SYNC_MANIFEST` 加一層 area filter；diff／apply 引擎完全不用動。
- `parseArgs` 需支援第一個「帶值旗標」（現有白名單全是布林）。

**未決設計點**：

1. **旗標形態**：`--area=<name>`（parser 改動最小）vs `--area <name>`（慣例形、需吃下一 token）vs 逗號多值。未定。
2. **typo 安全**：不合法 area 名（如 `--area claud`）必須拋 `INVALID_ARGS`，不得靜默過濾成 0 項——與 `--dryrun` 拒絕未知旗標同一哲學。
3. **指令範圍**：`diff`／`to-repo`／`to-local` 吃；`safety:check` 刻意不吃（安全掃描保持全量）；`status` 的 skills:diff 半場不屬於任何 area，`--area` 時跳過或照跑待定。
4. **輸出誠實性**：帶 `--area` 跑出「一致」時，畫面須明示本次僅比對該 area，避免部分同步被誤讀為全量。

**同步更新義務**（依修改守則）：README 指令說明與旗標清單、`--help` 輸出、`parseArgs`／`buildSyncItems` 對應 unit test。
