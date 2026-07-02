# 提案：settings.json top-level 同步策略翻轉為黑名單混合制

## Why

現行 `PORTABLE_SETTINGS_KEYS` 白名單讓每個官方新增的可攜欄位都需手動列舉才會同步（如近期的 `CLAUDE_CODE_DISABLE_MOUSE`），維護成本隨官方 settings 欄位擴張持續上升，且漏加時「新偏好沒同步」是沉默的。使用者的目標是「盡量參數都搬，只排除明確不適合同步的」。經風險分析，top-level 官方欄位本身非機密（最高風險是 helper 指令路徑與裝置偏好互踩，屬中低風險、可恢復），翻轉為黑名單可接受；真正的災難級洩漏向量在 `env` 開放 key 空間，該層維持白名單不動。

## What Changes

- **BREAKING（策略反轉）**：`settings.json` top-level 由白名單（`PORTABLE_SETTINGS_KEYS`，預設不同步）改為黑名單（`DEVICE_SETTINGS_KEYS`，預設同步、列舉排除）。未知新 top-level 欄位從「預設留在本機」變為「預設同步」。
- 新增**敏感命名 pattern 護欄**：top-level key 命中 `/(key|token|secret|credential|helper|refresh)/i` 者自動排除，即使不在黑名單內——兜住未來官方新增的憑證類欄位。
- 黑名單初始內容：裝置偏好 `model`、`effortLevel`、`defaultShell`、`tui`、`autoUpdatesChannel`；平台綁定 `hooks`；憑證 helper `apiKeyHelper`、`awsCredentialExport`、`awsAuthRefresh`、`otelHeadersHelper`（後四者同時被 pattern 涵蓋，列舉為雙保險）。
- **`env` 巢狀白名單（`PORTABLE_ENV_KEYS`）維持不動**——開放 key 空間無法枚舉機密名稱，此為不可退讓的安全底線。
- **diff 預設列出被排除欄位**（現僅 `--verbose` 顯示）：黑名單制下這是發現「某欄位該排除而未排除」的唯一日常訊號，改為預設可見。
- repo 現存 `claude/settings.json` 依新規則重新收斂一次。
- 設計原則一般化：「結構性官方欄位 → 黑名單；開放 key 空間（env、provider API key 區塊）→ 白名單」，作為日後新增 opencode、pi 設定同步的通用過濾慣例（本次不實作 opencode/pi，僅在 design 記錄）。
- Open question（design 處理）：codex `config.toml` 是否跟進翻轉。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `claude-settings-sync`（原 `settings-sync`，隨本次確立的「一工具一 capability」佈局改名；codex／opencode／pi 日後各立 `<tool>-config-sync`）：top-level 過濾方向反轉——「只同步白名單列舉欄位」改為「預設同步、黑名單與敏感 pattern 排除」；「未知新欄位預設留在本機」改為「未知新欄位預設同步，除非命中黑名單或敏感 pattern」；新增「被排除欄位於 diff 預設可見」需求。`env` 巢狀白名單與「不得洩漏敏感值」需求不變。

## Impact

- **`sync.js`**：`PORTABLE_SETTINGS_KEYS` → `DEVICE_SETTINGS_KEYS` + `SENSITIVE_KEY_PATTERN` 常數；`loadStrippedSettings`、`extractDeviceValues` 判斷反轉；diff 輸出的 dropped keys 顯示從 `--verbose` gate 改為預設。`stripNonPortableEnv` 與 env 路徑零改動。
- **`claude/settings.json`（repo 來源檔）**：依新規則重新收斂（可能新增進 repo 的欄位需逐一人工確認）。
- **測試**：`test/settings.test.js` 白名單語義測試反轉、新增 pattern 護欄測試；`boundary.test.js`、`diff-integration.test.js`、`apply-integration.test.js` 受影響斷言同步修正。
- **文件**：`CLAUDE.md` 修改守則與同步項目表、`README.md` 同步策略章節改寫；「未來新欄位預設不外洩」的結構保證降級為「pattern 護欄 + 黑名單防守」，需明文記錄此心智模型轉向。
- **風險承擔（明文化）**：官方未來新增「裝置型且命名不含敏感字」的欄位會先跨裝置互踩、再被人工加入黑名單；此為黑名單制固有成本，由 diff 預設可見性緩解。
