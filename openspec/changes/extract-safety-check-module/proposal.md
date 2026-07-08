## Why

`decouple-safety-check` 已把安全審核從同步流程分離，但實作仍留在 `sync.js` 內，使同步核心與 safety scan 邏輯在檔案層級仍耦合。將 safety check 抽成獨立檔案可讓責任邊界更清楚，並避免 `sync.js` 持續膨脹。

## What Changes

- 將 `safety:check` 的掃描、判斷與輸出邏輯從 `sync.js` 抽到獨立模組，例如 `safety-check.js`。
- 保留 `node sync.js safety:check` 與 `npm run safety:check` 作為對外入口，不新增使用者可見指令。
- 保持既有 safety 行為不變：掃描範圍、hard block、warning、輸出遮罩與 exit code 皆不變。
- 更新測試沙箱，讓整合測試複製必要模組檔案。
- 更新 README / AGENTS / CLAUDE 中「單檔 CLI」與 safety check 架構描述。

## Capabilities

### New Capabilities
- `safety-check-module-boundary`: 定義 `safety:check` 的模組邊界、對外入口穩定性與行為不變要求。

### Modified Capabilities
- 無。`safety:check` 的需求語意不變；本 change 只改實作邊界。

## Impact

- 影響 `sync.js`：保留 command dispatch 與 exit code 對接，但移除 safety scan 細節。
- 新增或調整 safety check 專用模組檔案。
- 影響 `test/boundary.test.js` 與可能的 sandbox helper，確保測試 repo 包含新模組。
- 影響 README、AGENTS、CLAUDE 的架構描述。
- 不新增外部 npm 相依，不改 safety:check 對外行為。

## Dependency

- 建議先歸檔或至少完成 `decouple-safety-check`，因為本 change 以該 change 導入的 `safety:check` 行為作為既有基線。
