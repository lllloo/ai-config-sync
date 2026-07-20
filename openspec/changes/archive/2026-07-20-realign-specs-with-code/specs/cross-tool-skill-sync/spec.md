## MODIFIED Requirements

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
