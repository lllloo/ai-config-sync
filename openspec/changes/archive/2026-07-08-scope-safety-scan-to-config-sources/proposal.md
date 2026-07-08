## Why

`safety:check` 目前對 `claude/`、`codex/` 遞迴掃「全部」檔案跑機密／HOME-path／私鑰 text pattern，包含 `claude/agents/`、`claude/skills/` 這類**原樣鏡射的外部套件文件**。這些是公開上游、本 repo 不編輯的說明文件，本質會談論 token／路徑，用機密 pattern 掃它們天生製造**整類 false positive**——實例：`claude/agents/everything-claude-code/opensource-sanitizer.md` line 54（`github_pat_[A-Za-z0-9_]{22,}` 是該 sanitizer agent 自己要偵測的 regex 定義）觸發 secret hard block、line 95（`/home/[a-z]...` pattern 定義）觸發 HOME 路徑 hard block，使 `safety:check` **恆 exit 2、無法當 clean gate**。安全審核意圖是守「使用者會手改、可能不慎寫入機密的設定同步來源」，而非審計第三方文件。

## What Changes

- **限縮 text pattern 掃描範圍**：`SECRET_VALUE_PATTERN`、`PRIVATE_KEY_PATTERN`、`HOME_PATH_PATTERN` 的 text 掃描（`scanSafetyTextFile`）只對本 repo 維護的設定同步來源跑，排除外部套件文件目錄前綴（新增 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES = ['claude/agents/', 'claude/skills/', 'codex/agents/']`）。
- **結構化掃描維持不變**：`scanSafetyStructuredFile`（對 `.json`／`.toml`，含 `settings.json` hooks／credential hard block、`config.toml` 機密 section hard block、敏感命名 key warning）不變——agents/skills 目錄下無 `.json`／`.toml` 設定檔，影響面為零。
- **保留完整偵測**：`claude/settings.json`、`claude/CLAUDE.md`、`claude/statusline.sh`、`claude/rules/`、`codex/AGENTS.md`、`codex/config.toml`、`skills-lock.json` 的 text pattern 偵測不受影響。
- **文件同步**：`CLAUDE.md` 與 `README.md` 的 `safety:check` 掃描範圍描述更新，寫明「排除外部套件文件目錄」的理由與取捨。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `safety-check`：掃描範圍語義變更——text pattern 掃描排除外部套件文件目錄（`claude/agents/`、`claude/skills/`、`codex/agents/`），只掃本 repo 維護的設定來源。

## Impact

- **`safety-check.js`**：新增 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 常數；`scanSafetyTextFile`（或其呼叫點 `runSafetyChecks`）依檔案相對路徑前綴略過 text pattern 掃描；結構化掃描不變。常數由本檔持有、`sync.js` re-export。
- **`sync.js`**：re-export 新常數（若測試需引用）。
- **測試**：`test/boundary.test.js` 的 `safety:check` sandbox 新增案例——(a) 套件文件目錄（`claude/agents/foo.md`）含 secret/HOME pattern → **不**觸發 hard block；(b) 設定來源（`claude/statusline.sh`、`codex/AGENTS.md`）含 pattern → 仍觸發 hard block（防過度排除回歸）。
- **文件**：`CLAUDE.md`（架構重點 safety-check 段、修改守則的 safety:check hard block/掃描範圍描述）、`README.md`（注意事項 safety:check 掃描範圍）。
- **風險承擔（明文化）**：agents/skills 套件文件若真被塞入機密不再被 text pattern 偵測到——可接受，因其為公開上游原樣鏡射、本 repo 不編輯；結構化設定檔（真正的機密載體）與使用者手改的設定來源仍全覆蓋。
