## REMOVED Requirements

### Requirement: xtool-dir 型別邏輯位於獨立模組

**Reason**: `xtool-dir` 型別與 `xtool-dir.js` 一併刪除，無模組可界定邊界。
**Migration**: 刪除 `xtool-dir.js` 與 `sync.js` 的 lazy singleton／re-export。

### Requirement: xtool-dir 模組不反向依賴同步核心

**Reason**: 模組不存在。
**Migration**: `boundary.test.js` 的反向 require 掃描清單移除 `xtool-dir.js`。

### Requirement: 通用檔案系統工具留在同步核心

**Reason**: 該要求原意為「symlink 工具層不搬入 xtool 模組」；型別撤除後 `sync.js` 內僅供其使用的 symlink 工具層亦一併移除，無工具需保留。
**Migration**: 移除 `ensureSymlink`／`createSymlinkAtomic`／`symlinkWithFallback`／`lstatSyncSafe` 及其專屬測試。

### Requirement: 測試沙箱包含 xtool-dir runtime 檔案

**Reason**: 無此 runtime 檔。
**Migration**: 各整合測試的 runtime 檔清單改為 `sync.js`／`safety-check.js`／`toml-reader.js`／`skills.js`。

### Requirement: xtool-dir 對外面限於兩個進入點

**Reason**: 模組不存在。
**Migration**: 無。
