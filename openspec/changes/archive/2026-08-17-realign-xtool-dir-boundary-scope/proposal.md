## Why

前一個 change（`2026-08-17-backfill-xtool-dir-module-boundary`）在補 `xtool-dir-module-boundary` 時把兩條**行為不變式**寫進了模組邊界 capability，越出該 capability 的職責範圍：

1. 「行為不依賴與其他同步項的相對順序」—— `cross-tool-skill-sync` 已有同義的 requirement 文字與專屬 scenario，屬純重複。同一規則寫在兩處，日後改一處另一處就 drift。
2. 「apply 中途失敗時，先前已完成的 skill 與當前 skill 內部變更兩邊須併入、任一邊不得被覆寫」—— 這條**沒有任何 spec 覆蓋**：`sync-write-safety` 定義的是 `mirrorDir`→`applySyncItems` 的通用鏈，`cross-tool-skill-sync` 只要求「附掛 partialChanges 並警告」，都沒說到兩邊併入。它是 `xtool-dir` 型獨有的行為，屬於行為 capability 而非模組邊界。

module-boundary capability 應只約束「誰住哪、依賴方向、注入契約、對外面」；行為契約歸行為 capability。本次把兩條各自歸位。

## What Changes

- `xtool-dir-module-boundary`：從「對外契約保持穩定」requirement 移除上述兩條行為不變式，只保留「type switch 只經 diff／apply 兩個進入點、其餘 helper 僅為 re-export 與測試 seam」的邊界約束。
- `cross-tool-skill-sync`：新增一條 requirement，把「兩邊部分變更須併入」這條無主的行為不變式收進來，補上規格空缺。
- 不新增、不修改程式碼。實作行為完全不變，本次僅調整規格歸屬。

## Capabilities

### Modified Capabilities
- `xtool-dir-module-boundary`：「xtool-dir 對外契約保持穩定」移除兩條越界的行為不變式
- `cross-tool-skill-sync`：新增「apply 部分變更的併入」requirement，承接原本無主的不變式

## Impact

- **規格**：`openspec/specs/xtool-dir-module-boundary/spec.md` 一條 requirement 縮減；`openspec/specs/cross-tool-skill-sync/spec.md` 新增一條 requirement。
- **程式碼**：無。
- **測試**：無。既有 `test/fs-symlink.test.js` 的四條 `mergeXtoolPartialChanges` 測試即為新 requirement 的現成證據。
- **文件**：無。
