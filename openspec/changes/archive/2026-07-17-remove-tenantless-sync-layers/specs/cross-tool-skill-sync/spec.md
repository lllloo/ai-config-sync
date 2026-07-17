## MODIFIED Requirements

### Requirement: 跨工具全域 skill 同步區

系統 SHALL 提供一個同步區 `agents/`（無點），對應本機 `~/.agents/`，與既有 `claude/`↔`~/.claude/`、`codex/`↔`~/.codex/` 命名同構。放於 `agents/skills/<name>/` 的 skill SHALL 被視為「全域跨工具」skill。「哪些 skill 跨工具」SHALL 由目錄位置決定，不引入 per-skill flag。

全域 skill SHALL 只有 `agents/skills/` 一個落點；系統 SHALL NOT 提供 Claude 專屬的全域 skill 同步層。

#### Scenario: agents 區解析

- **WHEN** `resolveSyncArea('agents')` 被呼叫
- **THEN** 回傳 homeBase `~/.agents`、repoBase `<repo>/agents`、prefix `agents/`

#### Scenario: 全域 skill 落點唯一

- **WHEN** 維護者新增一個全域 skill
- **THEN** 該 skill 放於 repo `agents/skills/<name>/`，作為跨工具 skill 同步
- **AND** `SYNC_MANIFEST` SHALL NOT 含 `claude` 區的 `skills` dir 型同步項

### Requirement: 真實目錄至 symlink 的遷移

當 `~/.claude/skills/<name>` 目前為真實目錄（舊機制產物）時，apply SHALL 安全地轉換為 symlink：先確認 `~/.agents/skills/<name>` 已寫入成功，再刪除真實目錄並建立 symlink。轉換 SHALL 幂等；任一步失敗 SHALL 透過 `partialChanges` 附掛已完成變更並警告，SHALL NOT 遺失 skill 內容（dir→symlink 轉換無法原子，容許的空窗僅限 Claude 探索點短暫缺席，正典內容 SHALL 已先安全落於 `~/.agents`）。

轉換 SHALL 內生於 `xtool-skills` 型的 apply，SHALL NOT 依賴其與任何其他同步項的相對順序。

#### Scenario: dir 轉 symlink

- **WHEN** `~/.claude/skills/<name>` 為真實目錄且 `~/.agents/skills/<name>` 已寫入，執行 apply
- **THEN** 真實目錄被替換為指向 `~/.agents/skills/<name>` 的 symlink，內容仍可經 symlink 存取

#### Scenario: 中途失敗可見

- **WHEN** 轉換過程中途失敗
- **THEN** 已完成變更附掛於 `SyncError.context.partialChanges` 並印出警告

#### Scenario: 轉換不依賴 manifest 順序

- **WHEN** 本機 `~/.claude/skills/<name>` 仍為舊真實目錄，執行 `to-local`
- **THEN** `xtool-skills` apply 完成 agents 端寫入與 dir→symlink 轉換
- **AND** 轉換結果 SHALL NOT 因 `SYNC_MANIFEST` 中其他項目的相對位置而改變

### Requirement: 新同步來源納入 safety 掃描

新增的 `agents/` 同步來源 SHALL 納入 `npm run safety:check` 的掃描射程（`SAFETY_SCAN_DIRS` 含 `'agents'`），SHALL NOT 讓任何寫入家目錄的同步來源逃出安全掃描。`agents/skills/` SHALL 列為 text-pattern 掃描排除前綴（`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES`），以避開 skill 內文的整類假陽性，其結構化掃描（secret value／私鑰／絕對 HOME 路徑）SHALL 仍照常執行。

#### Scenario: agents 來源在掃描射程內

- **WHEN** `agents/skills/` 內含觸發 hard block 的內容（如私鑰片段），執行 `npm run safety:check`
- **THEN** 該問題被偵測並以 hard block（exit 2）回報，不因來源未列入 `SAFETY_SCAN_DIRS` 而漏掃

#### Scenario: skill 內文不誤報

- **WHEN** `agents/skills/` 下的 skill 內文含觸發 text-pattern 的字串
- **THEN** text-pattern 掃描略過該類內文，但結構化掃描仍對其執行

