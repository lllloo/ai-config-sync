# 提案：codex config.toml 同步策略翻轉為黑名單混合制

## Why

`flip-settings-sync-to-blocklist`（已 archive）把 `settings.json` top-level 翻成黑名單後，留下明文 Open Question：「codex `config.toml` 是否跟進翻轉？」暫定「累積 claude 端黑名單運行經驗後另開 change 決策」。本 change 即回答此問題。

現行 `config.toml` 是系統裡**唯一僅存的白名單**（`CODEX_CONFIG_TOP_KEYS` + `CODEX_CONFIG_SECTION_KEYS` + `plugins.*.enabled`，預設不同步）。它造成兩個問題：

1. **心智模型分裂**：settings.json 是「預設同步 + 排除清單」，config.toml 是「預設不同步 + 允許清單」，兩套相反語義並存，維護者每次都要切換思路。
2. **白名單維護黏性**：每次 Codex 新增可攜欄位（如新的 `features.*` flag）都要手動列進白名單才會同步，漏加時「新偏好沒同步」是沉默的——`warnUnclassifiedCodexConfig` 那套「未分類欄位提示」機制本身就是在替這個痛點打補丁。

按 `flip-settings-sync-to-blocklist` 立下的 **D6 跨工具過濾慣例**（結構性官方欄位→黑名單；開放/機密 key 空間→白名單），config.toml 的結構性 section 本就該走黑名單。經風險分析，翻轉可在**不製造 fail-open** 的前提下完成：真正的機密（`model_providers.*.api_key`、`mcp_servers.*`）住在**邊界穩定、可整段排除**的 section，整段丟棄即 safe-by-construction，與白名單同等安全。

## What Changes

- **BREAKING（策略反轉）**：`config.toml` 由白名單改為**黑名單混合制（section 級）**。預設同步各 section，僅排除列於 section 黑名單者。未知新 section／新 key 從「預設留在本機」變為「預設同步」。
- **Section 黑名單初始內容**（機密／裝置／本機路徑，整段排除）：`model_providers.*`、`mcp_servers.*`、`projects.*`、`profiles.*`、`history`、`shell_environment_policy`、`tui.model_availability_nux`。既有的 `CODEX_CONFIG_DEVICE_SECTION_PREFIXES` 常數從「僅供未分類提示降噪」升格為**權威排除清單**。
- **兩個精確 carve-out（比照 settings.json 的 `hooks` 硬編碼特例，非破壞一致性）**：
  - **`plugins.*` 維持 `enabled`-only**：plugin 名為半開放集合、plugin 可能在自己 section 存憑證/本機路徑，屬「開放 key 空間」→ 依 D6 維持白名單精度。
  - **top-level 維持 `personality`/`web_search` 窄允許清單**：本機實測 top-level 目前只有這 2 個可攜 key；Codex top-level 尚有 `model`/`approval_policy`/`sandbox_mode` 等裝置 key 且隨版本增生，缺乏權威 schema 無法安全反列。此層維持允許清單為**刻意的 interim**，待 Codex schema 盤點後另開 change 決策（見 design Open Question）。
- **第 2 層安全補償**：`safety:check` 對 repo `config.toml` 出現 `model_providers.*`／`mcp_servers.*` 等機密 section 從 warning **升為 hard block**，對齊 settings.json 對 `hooks`／credential helper 的 hard block 待遇（section 黑名單已在同步層剝除、此為 belt-and-suspenders）。
- **移除 `warnUnclassifiedCodexConfig` 未分類提示**：白名單特有的「新欄位可能該納入白名單」提示，在黑名單制下語義反轉且不再需要（新欄位預設就同步）。改由一般 value-diff 顯示新同步的 section／key。
- repo 現存 `codex/config.toml` 依新規則重新收斂一次。

## Capabilities

### New Capabilities

- `codex-config-sync`：定義 Codex `config.toml` 跨裝置同步的安全邊界（section 級黑名單混合制 + plugins/top-level 精確 carve-out + 機密 section hard block）。對稱於 `claude-settings-sync`，落實 `flip-settings-sync-to-blocklist` D6 立下的「一工具一 capability」佈局。

### Modified Capabilities

- `safety-check`：新增「repo `config.toml` 機密 section 為 hard block」需求。

## Impact

- **`codex-config.js`**：`isPortableCodexConfigKey`（白名單放行判斷）反轉為 section 黑名單排除判斷；`parsePortableCodexConfig`／`serializePortableCodexConfig`／`mergePortableCodexConfig` 由「只認白名單 key」改為「複製整段、排除黑名單 section，plugins/top-level 套 carve-out 允許清單」；`CODEX_CONFIG_DEVICE_SECTION_PREFIXES` 升格權威；`collectUnclassifiedCodexKeys`／`isKnownDeviceCodexSection` 移除。
- **`sync.js`**：`warnUnclassifiedCodexConfig` 移除；re-export 常數調整；`diffCodexConfigItem`／`diffCodexConfigToLocal` 隨新 merge 語義驗證。
- **`safety-check.js`**：新增 config.toml 機密 section 的 hard-block 偵測（`scanTomlKeyWarnings` 旁增 section 級 hard-block）。
- **`codex/config.toml`（repo 來源檔）**：依新規則重新收斂（新進 repo 的 section／key 需逐一人工確認）。
- **測試**：`test/codex-config.test.js` 白名單語義測試反轉為黑名單；新增 carve-out 測試（plugins enabled-only、top-level 窄允許）、section 黑名單排除測試；`boundary.test.js` 新增 config.toml hard-block 案例；`diff-integration.test.js`／`apply-integration.test.js` 受影響斷言修正。
- **文件**：`CLAUDE.md` 同步項目表 config.toml 列、架構重點 codex-config.js 段、修改守則；`README.md` 同步策略章節。「白名單 fail-safe」措辭全面改寫為「section 黑名單 + carve-out + hard-block 兜底」。
- **風險承擔（明文化）**：Codex 未來在**保留 section**（tui/features/memories）新增「裝置型且非機密」的 key 會先跨裝置互踩、再被人工加入排除；此為黑名單制固有成本，由 value-diff 可見性緩解。top-level 與 plugins 因維持允許清單，不承擔此風險。
