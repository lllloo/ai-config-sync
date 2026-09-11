# cross-tool-skill-sync Specification

## Purpose
定義 repo 自寫全域 skill 的安裝契約：唯一落點為 repo 頂層 `skills/<name>/`（`npx skills` 慣例掃描目錄），安裝、更新、移除一律經 `npx skills`（`add -g`／`update -g`／`remove`）並以 `skills-lock.json` 登記，`sync.js` 的任何指令不得寫入 `~/.agents/skills/`、`~/.claude/skills/` 或其他工具探索點。前身為 `xtool-dir` 型共管同步（見 `openspec/changes/archive/*-global-skills-via-npx`），因與 `npx skills` 共寫同一目錄的守門成本過高而撤除。
## Requirements

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
