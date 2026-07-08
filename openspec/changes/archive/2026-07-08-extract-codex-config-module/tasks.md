## 1. 模組邊界拆分

- [x] 1.1 新增 `codex-config.js`，承載 TOML parse／serialize、可攜欄位判斷、方向相依 merge、load／get 與 apply 進出口，以及 `CODEX_CONFIG_TOP_KEYS`、`CODEX_CONFIG_SECTION_KEYS` 常數。
- [x] 1.2 以 dependency injection 傳入 `readFileSafe`、`writeTextSafe` 與路徑常數（`REPO_ROOT`、`CODEX_HOME`）；模組**不反向 require `sync.js`**。
- [x] 1.3 `sync.js` 的 `SYNC_TYPE_HANDLERS` `codex-config` 分派改為呼叫模組；`diffCodexConfigItem`／`diffCodexConfigToLocal` 留在 Sync Core，改呼叫模組匯出的 `loadPortableCodexConfig`／`mergePortableCodexConfig`／`getPortableCodexConfig`。
- [x] 1.4 常數與被測試引用的純函式由模組持有，`sync.js` re-export，維持既有 import 來源與防漂移。

## 2. 行為不變驗證

- [x] 2.1 確認 `to-repo` 對 `codex/config.toml` 仍只寫入可攜欄位、過濾裝置特定與未知欄位。
- [x] 2.2 確認 `to-local` 仍保留本機未受管理欄位、只覆寫可攜欄位。
- [x] 2.3 確認 `diff`／`status` 對 `codex/config.toml` 的 direction-aware 差異判斷與顯示不變。
- [x] 2.4 更新 `test/apply-integration.test.js` 的 `SYNC_RUNTIME_FILES`，使臨時 repo 一併包含 `codex-config.js`。
- [x] 2.5 確認 `test/codex-config.test.js` 全數通過（經 re-export 或改 import 皆可，以行為不變為準）。

## 3. 文件與檢查

- [x] 3.1 更新 README 檔案說明表，加入 `codex-config.js`。
- [x] 3.2 更新 CLAUDE 架構重點，描述 Codex config 為獨立模組、diff 渲染留在 diff 引擎。
- [x] 3.3 執行 `npm test`，確認全數通過。
- [x] 3.4 執行 `openspec validate "extract-codex-config-module" --type change` 或等效 OpenSpec 檢查。
