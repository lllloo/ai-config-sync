## ADDED Requirements

### Requirement: 全域 skill 經 npx skills 安裝與更新

repo 自寫的全域 skill SHALL 唯一放於 repo 頂層 `skills/<name>/`（`npx skills` 慣例掃描容器目錄）。全域 skill 的安裝、更新與移除 SHALL 一律經 `npx skills`（`add -g`／`update -g`／`remove`），並以 `skills-lock.json` 登記（source 為本 repo 的 GitHub 位址）。`sync.js` 的任何指令 SHALL NOT 寫入、刪除或修復 `~/.agents/skills/` 與 `~/.claude/skills/` 下的任何項目，也 SHALL NOT 在 `SYNC_MANIFEST` 保有任何指向 `~/.agents/` 的同步區。

#### Scenario: npx skills 可直接發現全域 skill

- **WHEN** 對本 repo 執行 `npx skills add <repo> --list`（不加 `--full-depth`）
- **THEN** `skills/` 下每一支 skill SHALL 出現在可安裝清單中

#### Scenario: 安裝建議由 skills:diff 承接

- **WHEN** 某裝置的 `~/.agents/.skill-lock.json` 缺少 `skills-lock.json` 登記的自寫全域 skill，執行 `skills:diff`
- **THEN** 該 skill SHALL 與其他外部 skill 一樣列於「僅在 repo」並印出 `npx skills add <repo> -g -y --skill <name>` 建議指令

#### Scenario: to-local 不觸碰全域 skill 目錄

- **WHEN** 執行 `to-local`（含 `to-win-local`）
- **THEN** `~/.agents/skills/` 與 `~/.claude/skills/` 的內容與 mtime SHALL 與執行前相同

## REMOVED Requirements

### Requirement: 跨工具全域 skill 同步區

**Reason**: `agents/` 同步區與 `~/.agents/` 的對應隨 `xtool-dir` 型別一併撤除；全域 skill 改由 `npx skills` 裝進 `~/.agents/skills/`，repo 端落點改為頂層 `skills/`。
**Migration**: `git mv agents/skills skills`；各裝置手動移除 `~/.agents/skills/<name>` 與 `~/.claude/skills/<name>` 舊產物後依 `skills:diff` 建議指令重裝。

### Requirement: xtool-dir 非 prune upsert（共管安全）

**Reason**: `sync.js` 不再寫入 `~/.agents/skills/`，共管問題不存在。
**Migration**: 無需動作；`npx skills` 自身即為該目錄的唯一寫入者。

### Requirement: Claude 探索 symlink 橋

**Reason**: `npx skills add -g` 安裝時自行建立 `~/.claude/skills/<name>` symlink。
**Migration**: 重裝後由 `npx skills` 建立；舊 symlink 於遷移時手動移除。

### Requirement: 同名碰撞守門

**Reason**: 兩套機制不再共寫同一目錄，撞名情境消失。
**Migration**: 無。

### Requirement: 真實目錄至 symlink 的遷移

**Reason**: 舊機制產物的轉換責任隨型別撤除；本機殘留由一次性手動遷移處理。
**Migration**: README 遷移段落列出手動步驟。

### Requirement: to-repo 只讀回受管名字

**Reason**: `to-repo` 不再讀取 `~/.agents/skills/`。
**Migration**: skill 內容直接於 repo `skills/<name>/` 編輯後 commit。

### Requirement: 新同步來源納入 safety 掃描

**Reason**: `agents/` 目錄不存在；掃描來源改列於 `safety-check` capability 的 `skills/`。
**Migration**: 見 `safety-check` delta。

### Requirement: Windows symlink fallback

**Reason**: `sync.js` 不再建立任何 symlink。
**Migration**: 無。

### Requirement: apply 部分變更的併入

**Reason**: `xtool-dir` 型別不存在，逐 skill 迴圈套用的兩層來源隨之消失；`sync-write-safety` 的一般「部分失敗可見」要求仍適用其餘型別。
**Migration**: 無。
