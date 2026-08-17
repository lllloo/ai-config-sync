## Why

`safety-check.js` 與 `skills.js` 兩個功能模組各自有 module-boundary spec 鎖住職責邊界與依賴方向，但 2026-07 拆出的第三個功能模組 `xtool-dir.js`（原名 `xtool-skills.js`）從未補上對應規格——它的 DI 注入邊界、反向 require 禁令、以及「symlink 工具層刻意留在 `sync.js`」這個取捨，目前只寫在 `CLAUDE.md` 與檔頭註解，沒有規格層約束。

同一次拆檔還留下一處規格落後實作：兩份既有 module-boundary spec 都把整合測試沙箱的 runtime 檔清單寫成四檔（`sync.js`／`safety-check.js`／`toml-reader.js`／`skills.js`），但實作與測試早已是五檔——`test/diff-integration.test.js`、`test/apply-integration.test.js`、`test/fs-symlink.test.js` 的 `SYNC_RUNTIME_FILES` 與 `test/boundary.test.js` 的 `SAFETY_RUNTIME_FILES` 都含 `xtool-dir.js`，缺任一檔 `node sync.js` 即崩。

本次為**純規格回填**：實作、測試、行為皆不變，只讓規格追上既有事實。

## What Changes

- 新增 `xtool-dir-module-boundary` capability，鎖定 `xtool-dir.js` 的職責邊界：型別專屬邏輯集中於本模組、不反向 require `sync.js`、共用常數與工具一律經 `createXtoolDir(deps)` 注入、對外契約為 `{ diffXtoolItems, applyXtoolItem }`、通用 FS 工具層留在 `sync.js` 不隨型別邏輯搬移。
- 修正 `safety-check-module-boundary` 與 `skills-module-boundary` 的沙箱 runtime 檔清單要求，由四檔改為五檔（補 `xtool-dir.js`）。
- 不新增、不修改任何程式碼與測試。既有測試已覆蓋五檔清單，本次不補測試（避免純規格回填混入實作改動）。

## Capabilities

### New Capabilities
- `xtool-dir-module-boundary`：`xtool-dir.js` 的職責邊界、依賴方向、DI 注入契約與對外匯出面

### Modified Capabilities
- `safety-check-module-boundary`：沙箱 runtime 檔清單由四檔改為五檔（補 `xtool-dir.js`）
- `skills-module-boundary`：同上

## Impact

- **規格**：新增 `openspec/specs/xtool-dir-module-boundary/spec.md`；修改 `openspec/specs/safety-check-module-boundary/spec.md` 與 `openspec/specs/skills-module-boundary/spec.md` 各一條 requirement。
- **程式碼**：無。
- **測試**：無。既有 `SYNC_RUNTIME_FILES`／`SAFETY_RUNTIME_FILES` 五檔清單即為本次規格的現成證據。
- **文件**：無。`CLAUDE.md` 與 `README.md` 已於前次改名 commit 描述 `xtool-dir.js` 的邊界，與本規格一致。
