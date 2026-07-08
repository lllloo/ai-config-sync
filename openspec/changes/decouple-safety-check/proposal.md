## Why

目前 `sync.js` 同時負責同步與安全判斷，導致 `settings.json` 的敏感命名護欄成為同步規則本身，容易把 `keyboardLayout`、`refreshRate` 等可攜設定誤判為不可同步。使用者希望安全審核由人主導，讓同步流程保持單純，並以獨立指令在 commit/push 前自行檢查 repo 內容。

## What Changes

- 新增 `npm run safety:check`，作為唯讀、離線、手動執行的安全檢查入口。
- 將敏感命名從「同步時自動排除／中止」降級為 `safety:check` 的 warning 訊號。
- 保留明確不同步欄位，如 `hooks`、`apiKeyHelper`、`awsCredentialExport`、`awsAuthRefresh`、`otelHeadersHelper`。
- 允許 `env` 依同步流程進 repo，但 `safety:check` 必須列出 env key 並遮罩值，供人工審核。
- `safety:check` 對明顯高風險內容回報 hard block，例如已知 token 值、私鑰片段、絕對 HOME 路徑、repo 內出現不該同步的 hooks/helper 欄位。
- 不加入 LLM review、不安裝 pre-push hook、不自動修復、不自動阻擋 git push。

## Capabilities

### New Capabilities
- `safety-check`: 定義獨立安全檢查指令的掃描範圍、輸出等級、exit code 與唯讀行為。

### Modified Capabilities
- `claude-settings-sync`: 調整 `settings.json` 同步安全邊界，讓敏感命名不再作為同步流程的自動排除規則，改由獨立 safety check 報告。

## Impact

- 影響 `sync.js` 的 settings 過濾、diff 顯示與 CLI 指令集合。
- 影響 `package.json` scripts 與 README 常用指令文件。
- 需要調整 `settings.test.js`、`diff-integration.test.js`、`apply-integration.test.js` 等與敏感命名剝除相關的測試。
- 不新增外部 npm 相依，不連網，不執行 build。
