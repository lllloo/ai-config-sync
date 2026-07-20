# cross-tool-skill-sync Specification

## Purpose
定義跨工具全域 skill 同步（`xtool-skills` 型）的契約：正典為 `~/.agents/skills/<name>/`（Codex 原生掃描），`to-local` 另於 `~/.claude/skills/<name>` 建立 symlink 橋供 Claude Code 探索。與 `npx skills` **共管**同一目錄，故為**非 prune upsert**——只認 repo `agents/skills/` 登記的受管名字，不刪、不吸入 npx 住戶；單一 skill 目錄內的殘檔可清，但不影響任何 sibling。同名碰撞以 `~/.agents/.skill-lock.json` 登記為**唯一**判準（Claude 側 symlink 存在與本機制自身產物無法區分，作為訊號會破壞幂等），碰撞時拒寫並於 diff 以 `conflict` 標示、計入 `EXIT_DIFF`。涵蓋真實目錄→symlink 的遷移、懸空 symlink 修復、`to-repo` 只讀回受管名字，以及 Windows 無 symlink 權限時的 fallback。
## Requirements
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

### Requirement: xtool-skills 非 prune upsert（共管安全）

`xtool-skills` 型別的 apply SHALL 只處理 repo `agents/skills/` 列出的 skill 名；對 `~/.agents/skills/` 內不受管的項（如 `npx skills` 安裝者）SHALL NOT 刪除。系統 SHALL NOT 對 `~/.agents/skills/` 套用 `mirrorDir` 的 prune-extras 語意。

#### Scenario: 不誤刪共管住戶

- **WHEN** `~/.agents/skills/` 內同時存在受管 skill 與一個非受管（npx 安裝）skill，執行 `to-local`
- **THEN** 受管 skill 被 upsert，非受管 skill 保持原封不動、不被刪除

#### Scenario: 單一 skill 目錄內殘檔清理

- **WHEN** 受管 skill 目錄內有 repo 端已移除的檔案，執行 `to-local`
- **THEN** 該 skill 目錄內的殘檔被清除，但不影響任何 sibling skill 目錄

### Requirement: Claude 探索 symlink 橋

`to-local` 方向的 apply SHALL 為每個受管 skill 於 `~/.claude/skills/<name>` 建立指向 `~/.agents/skills/<name>` 的 symlink，供 Claude Code 探索（官方支援 symlink 探索）。建立行為 SHALL 幂等：已是正確 symlink 時跳過、指向錯誤時修正、懸空（目標不存在）symlink 移除後重建。既有狀態的型別判斷 SHALL 以 lstat（不跟隨 link）為準。

`to-repo` 方向 SHALL NOT 建立或修復探索點：該方向的資料流為本機→repo，不寫入本機探索路徑。diff 階段對探索點狀態的檢查 SHALL 同樣限於 `to-local` 方向。

#### Scenario: 建立探索點

- **WHEN** 受管 skill 已寫入 `~/.agents/skills/<name>/` 而 `~/.claude/skills/<name>` 不存在，執行 `to-local`
- **THEN** 於 `~/.claude/skills/<name>` 建立指向 `~/.agents/skills/<name>` 的 symlink

#### Scenario: 幂等

- **WHEN** `~/.claude/skills/<name>` 已是指向正確目標的 symlink，再次執行 `to-local`
- **THEN** 不重建、標記為無變更

#### Scenario: 懸空 symlink 修復

- **WHEN** `~/.claude/skills/<name>` 為懸空 symlink（目標不存在），執行 `to-local`
- **THEN** 該 symlink 被移除並重建為指向 `~/.agents/skills/<name>` 的正確 symlink，不因 EEXIST 失敗

#### Scenario: to-repo 不觸碰探索點

- **WHEN** 執行 `to-repo`，且 `~/.claude/skills/<name>` 不存在或為懸空 symlink
- **THEN** 系統 SHALL NOT 建立或修復該 symlink
- **AND** 該狀態 SHALL NOT 造成 `to-repo` 失敗

### Requirement: 同名碰撞守門

upsert 前，若 `<name>` 登記於 `~/.agents/.skill-lock.json`（npx 安裝的既有 skill），系統 SHALL 判定為碰撞、拒絕覆寫並輸出 warning，SHALL NOT 靜默覆寫既有 skill。lock 登記 SHALL 為唯一碰撞判準：`~/.claude/skills/<name>` symlink 的存在 SHALL NOT 被當作碰撞訊號（本機制自身產物與 npx 產物在檔案系統上無法區分，誤用會破壞幂等）。碰撞 SHALL 於 diff 階段即以 `conflict` 狀態行標示（不印內容），並計入 diff 有差異（`EXIT_DIFF`）。

#### Scenario: 撞名拒寫

- **WHEN** repo `agents/skills/<name>` 與一個已登記於 `~/.agents/.skill-lock.json` 的同名 skill 衝突，執行 apply
- **THEN** 不覆寫既有 skill、輸出碰撞 warning

#### Scenario: diff 先標示碰撞

- **WHEN** 存在同名碰撞，執行 `diff`
- **THEN** 該 skill 於輸出中以 `conflict` 狀態標示，不等到 apply 才顯現

#### Scenario: 重跑受管 skill 不判碰撞

- **WHEN** 受管 skill 已於前次 apply 同步成功（`~/.agents/skills/<name>` 存在、`~/.claude/skills/<name>` 為本機制所建 symlink，且 `<name>` 未登記於 `~/.agents/.skill-lock.json`），再次執行 apply
- **THEN** 不判定碰撞，正常 upsert（幂等）

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

### Requirement: to-repo 只讀回受管名字

`to-repo` 方向 SHALL 只從 `~/.agents/skills/<受管名字>/` 讀回 repo `agents/skills/`，SHALL NOT 掃描整個 `~/.agents/skills/` 而吸入非受管（npx 安裝）skill。

#### Scenario: 不吸入非受管

- **WHEN** `~/.agents/skills/` 內含受管與非受管 skill，執行 `to-repo`
- **THEN** 僅受管 skill 被寫回 repo，非受管 skill 不進入 repo

### Requirement: 新同步來源納入 safety 掃描

新增的 `agents/` 同步來源 SHALL 納入 `npm run safety:check` 的掃描射程（`SAFETY_SCAN_DIRS` 含 `'agents'`），SHALL NOT 讓任何寫入家目錄的同步來源逃出安全掃描。`agents/skills/` SHALL 列為 text-pattern 掃描排除前綴（`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES`），以避開 skill 內文的整類假陽性，其結構化掃描（secret value／私鑰／絕對 HOME 路徑）SHALL 仍照常執行。

#### Scenario: agents 來源在掃描射程內

- **WHEN** `agents/skills/` 內含觸發 hard block 的內容（如私鑰片段），執行 `npm run safety:check`
- **THEN** 該問題被偵測並以 hard block（exit 2）回報，不因來源未列入 `SAFETY_SCAN_DIRS` 而漏掃

#### Scenario: skill 內文不誤報

- **WHEN** `agents/skills/` 下的 skill 內文含觸發 text-pattern 的字串
- **THEN** text-pattern 掃描略過該類內文，但結構化掃描仍對其執行

### Requirement: Windows symlink fallback

於 Windows，當標準 dir symlink 建立失敗時，系統 SHALL 嘗試以 junction 建立探索點；junction 亦失敗時 SHALL 拋出帶 path context 的 `SyncError`，SHALL NOT 靜默略過。

#### Scenario: junction fallback

- **WHEN** 於 Windows 標準 symlink 因權限不足失敗
- **THEN** 改以 junction 建立探索點；若仍失敗則拋 `SyncError` 而非靜默略過

