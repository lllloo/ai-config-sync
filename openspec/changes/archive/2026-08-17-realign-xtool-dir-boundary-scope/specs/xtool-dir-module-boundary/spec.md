## ADDED Requirements

### Requirement: xtool-dir 對外面限於兩個進入點

系統 SHALL 使 xtool-dir 模組對 `sync.js` 的 type switch 曝露 diff 與 apply 兩個進入點；其餘經注入綁定的輔助函式 SHALL 僅供 `sync.js` re-export 與單元測試作為 seam 使用，SHALL NOT 由型別分派直接呼叫。

本 requirement 只約束模組的對外面；`xtool-dir` 型的行為契約（含順序無關性與部分變更併入）由 `cross-tool-skill-sync` 承載。

#### Scenario: type switch 只經兩個進入點
- **WHEN** `sync.js` 對 `xtool-dir` 型項目執行 diff 或 apply
- **THEN** 分派 SHALL 只呼叫該模組的 diff 與 apply 兩個進入點
- **AND** 其餘經注入綁定的輔助函式 SHALL NOT 被型別分派呼叫

## REMOVED Requirements

### Requirement: xtool-dir 對外契約保持穩定

**Reason**: 該 requirement 除了模組對外面之外，還夾帶兩條行為不變式——「行為不依賴與其他同步項的相對順序」（`cross-tool-skill-sync` 已有同義 requirement 與專屬 scenario，屬純重複）與「apply 部分變更兩邊須併入」（屬 `xtool-dir` 型的行為契約，不屬模組邊界）。module-boundary capability 應只約束誰住哪、依賴方向、注入契約與對外面。

**Migration**: 模組對外面的約束由本 change 新增的「xtool-dir 對外面限於兩個進入點」承接，內容不變。順序無關性沿用 `cross-tool-skill-sync` 既有的「真實目錄至 symlink 的遷移」requirement 及其「轉換不依賴 manifest 順序」scenario。部分變更併入由本 change 於 `cross-tool-skill-sync` 新增的「apply 部分變更的併入」requirement 承接。三項規則均無行為變動，只是歸屬調整。
