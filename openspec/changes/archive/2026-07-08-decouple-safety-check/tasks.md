## 1. 同步流程降責

- [x] 1.1 調整 `settings.json` top-level 分區邏輯，讓 `SENSITIVE_KEY_PATTERN` 不再作為 to-repo 剝除或 to-local 保留的條件，只保留 `DEVICE_SETTINGS_KEYS` 明確黑名單。
- [x] 1.2 調整 `env` 同步邏輯，讓 env key 不再因 `DEVICE_ENV_KEYS` 或敏感命名 pattern 被同步流程剝除或保留，並維持 diff/status 不顯示 env 值。
- [x] 1.3 移除或改寫 sync 流程中的值層中止行為，使已知 secret value、巢狀敏感命名與絕對 HOME 路徑不再讓 `to-repo` 或 `diff` 中止／blocked。
- [x] 1.4 保留明確不同步 top-level 欄位，包括 `hooks`、`apiKeyHelper`、`awsCredentialExport`、`awsAuthRefresh`、`otelHeadersHelper` 與既有裝置偏好欄位。
- [x] 1.5 調整 diff 顯示，移除「未同步（敏感護欄排除）」對敏感命名 key 的特殊輸出，讓未被明確黑名單排除的 key 依一般 settings 差異處理。

## 2. 新增 safety:check 指令

- [x] 2.1 在 CLI 指令集合與 `package.json` scripts 新增 `safety:check`，不新增外部 npm 相依。
- [x] 2.2 實作 safety check 掃描範圍：`claude/`、`codex/`、`skills-lock.json`，並排除 `test/`、`openspec/` 與純文件內容。
- [x] 2.3 實作 hard block 偵測：已知 secret value pattern、私鑰片段、絕對 HOME 路徑、repo `claude/settings.json` 中出現 `hooks` 或 credential helper 欄位。
- [x] 2.4 實作 warning 偵測：`claude/settings.json` 的 env key 清單與結構化設定中命中敏感命名 review pattern 的 key path。
- [x] 2.5 實作安全輸出格式，僅列分類、檔案路徑、欄位路徑或 key 名稱，不輸出 env 值、secret 原值或完整 HOME 路徑。
- [x] 2.6 實作 exit code：clean 為 0、只有 warning 為 1、任一 hard block 為 2。

## 3. 測試更新

- [x] 3.1 更新 `settings.test.js`，移除敏感命名自動剝除與值層中止的舊期望，新增敏感命名照常同步的案例。
- [x] 3.2 更新 `diff-integration.test.js`，確認敏感命名不再產生「未同步」摘要，env 值仍不顯示。
- [x] 3.3 更新 `apply-integration.test.js`，確認 `to-repo` 不因敏感命名、known-secret value 或絕對 HOME 路徑中止。
- [x] 3.4 新增或更新 boundary 測試，覆蓋 `safety:check` 的 hard block、warning、輸出遮罩與 exit code。
- [x] 3.5 執行 `npm test`，確認全數通過。

## 4. 文件與規格對齊

- [x] 4.1 更新 README 常用指令與安全模型說明，加入 `npm run safety:check`，移除 sync 流程會自動攔截敏感命名的敘述。
- [x] 4.2 更新 AGENTS/CLAUDE 專案指引中與 `SENSITIVE_KEY_PATTERN`、env 黑名單、值層防線相關的架構描述。
- [x] 4.3 確認 `openspec validate` 或等效 OpenSpec 檢查通過。
