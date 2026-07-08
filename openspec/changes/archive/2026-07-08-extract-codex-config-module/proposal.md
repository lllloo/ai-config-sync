## Why

`safety-check.js` 已示範以 dependency injection 把一個獨立領域從 `sync.js` 抽出。Codex 的 `config.toml` 過濾同步邏輯（`sync.js` 的 Codex Config Handler section，約 296 行、19 個函式）是全檔**領域邊界最強**的一段：它處理的是**另一個工具**（Codex CLI）的設定格式（TOML），與 Claude 的 JSON `settings.json` 完全不同的 parse／serialize／merge 子系統，且自帶專屬常數（`CODEX_CONFIG_TOP_KEYS`、`CODEX_CONFIG_SECTION_KEYS`）與獨立測試檔（`test/codex-config.test.js`）。

它對同步核心的相依邊也是全檔最乾淨的：整段只吃 `readFileSafe`、`writeTextSafe`（leaf fs util）與 `REPO_ROOT`、`CODEX_HOME` 常數，**零顯示層耦合**（無 `col`／`printStatusLine`／`printSectionDivider`），函式回傳純資料或 boolean，輸出交給呼叫端。抽成獨立模組可讓 `sync.js` 專注於 Claude 設定同步與流程調度，Codex TOML 子系統獨立演進。

> 本 change 為**結構性重構**：不改任何 Codex config 同步行為，動機是領域內聚與檔案邊界，非既有痛點修復。

## What Changes

- 將 Codex Config Handler 的 parse／serialize／merge／load／apply 邏輯與專屬常數從 `sync.js` 抽到獨立模組，例如 `codex-config.js`。
- 以 dependency injection 傳入 `readFileSafe`、`writeTextSafe` 與必要路徑常數；模組**不反向 require `sync.js`**。
- **diff 渲染留在 diff 引擎**：`diffCodexConfigItem`／`diffCodexConfigToLocal`（Sync Core 內、direction-aware）不搬，改為呼叫模組匯出的純函式（`loadPortableCodexConfig`／`mergePortableCodexConfig`／`getPortableCodexConfig`）。
- 保留 `to-repo`／`to-local`／`diff`／`status` 對 `codex/config.toml` 的既有行為：可攜欄位過濾、方向相依合併、保留本機未受管理欄位皆不變。
- 更新測試沙箱，讓整合測試臨時 repo 一併複製新模組檔案。
- 更新 README／CLAUDE 架構描述，加入 `codex-config.js`。

## Capabilities

### New Capabilities
- `codex-config-module-boundary`: 定義 Codex config 過濾同步的模組邊界、對外行為穩定性與行為不變要求。

### Modified Capabilities
- 無。Codex config 同步的需求語意不變；本 change 只改實作邊界。

## Impact

- 影響 `sync.js`：移除 Codex Config Handler section 細節，保留 `SYNC_TYPE_HANDLERS` 的 `codex-config` 分派與 diff 渲染，改呼叫模組。
- 新增 `codex-config.js` 專用模組檔案。
- 影響 `test/apply-integration.test.js` 的 sandbox setup（`SYNC_RUNTIME_FILES` 需納入新檔）；`test/codex-config.test.js` 的 import 來源可能改為模組或經 `sync.js` re-export。
- 影響 README、CLAUDE 的架構描述。
- 不新增外部 npm 相依，不改 Codex config 對外同步行為。

## Dependency

- 無前置 change 相依。以 `extract-safety-check-module` 導入的 DI 模組模式為實作範本。
