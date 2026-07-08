# 設計：safety:check text 掃描限縮至設定來源

## Context

`safety:check`（`safety-check.js`）的掃描分兩層：

1. **text pattern 掃描**（`scanSafetyTextFile`）：對每個收集到的檔跑 `SECRET_VALUE_PATTERN`、`PRIVATE_KEY_PATTERN`、`HOME_PATH_PATTERN`，命中即 hard block。
2. **結構化掃描**（`scanSafetyStructuredFile`）：只對 `.json`／`.toml` 跑——`settings.json` 的 hooks／credential hard block、`config.toml` 的機密 section hard block、敏感命名 key warning。

檔案由 `collectSafetyScanFiles` 收集：`SAFETY_SCAN_DIRS = ['claude', 'codex']` 遞迴取全部檔 + `SAFETY_SCAN_FILES = ['skills-lock.json']`。

問題出在 text 掃描這層無差別套用到 `claude/agents/`、`claude/skills/` 這類**外部套件說明文件**。這些文件會為了說明而寫出 token／path 樣式（實例：`opensource-sanitizer.md` 內含它自己要偵測的 regex 定義），必然命中 pattern，使 `safety:check` 恆 exit 2。

`flip-codex-config-to-blocklist`（已 archive）剛把 `config.toml` 機密 section 升為 hard block，`safety:check` 的定位是「守本 repo 維護、使用者會手改的設定同步來源」的雙層防線。外部套件文件不在此定位內。

## Goals / Non-Goals

**Goals:**

- 消除「外部套件文件觸發 text pattern hard block」的整類 false positive，讓乾淨 repo 的 `safety:check` 回 exit 0、可當 clean gate
- 保持對真正機密載體（設定來源檔、結構化 `.json`／`.toml`）的完整偵測不打折
- 排除規則以明確、可測、集中的常數表達，避免日後漂移

**Non-Goals:**

- 不改結構化掃描（`scanSafetyStructuredFile`）——agents/skills 下無 `.json`／`.toml`，且 `settings.json`／`config.toml` 的 hard block 語義是這次要保留的核心
- 不引入 per-file inline 豁免機制（`.safetyignore`／審核註解）——對「整目錄本質誤判」是 overkill，目錄前綴排除已足
- 不放寬 `settings.json`／`config.toml`／`CLAUDE.md`／`rules`／`statusline.sh`／`AGENTS.md`／`skills-lock.json` 的偵測
- 不移除 agents/skills 出現在同步流程中（它們照常同步到本機，只是不跑 text 機密掃描）

## Decisions

### D1：目錄前綴排除，只作用於 text 掃描

**選擇**：新增常數 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES = ['claude/agents/', 'claude/skills/', 'codex/agents/']`（相對 `REPO_ROOT` 的 POSIX 前綴）。在 `runSafetyChecks` 逐檔迴圈中，對命中前綴的檔**只略過 `scanSafetyTextFile`**，結構化掃描維持呼叫（無害：這些目錄無 `.json`／`.toml`，`scanSafetyStructuredFile` 對 `.md` 直接 no-op）。

判定用既有的 `toRelativePath(filePath).replace(/\\/g, '/')`（與 `scanSafetyStructuredFile` 同款正規化）比對前綴，跨平台一致。

**理由**：問題**只**在 text pattern 這層；結構化掃描本就依副檔名分派、對套件文件 no-op。把排除限縮在 text 掃描，改動面最小、語義最精確，且不需動 `collectSafetyScanFiles`（保留「這些檔仍在掃描集合內」的事實，方便日後若要對它們做別種檢查）。

**替代方案**：(a) 在 `collectSafetyScanFiles` 直接不收集這些目錄——被否決，會連帶關掉未來對這些目錄的任何檢查，語義過寬；(b) narrow pattern 讓它不匹配「pattern 定義」——被否決，無法可靠區分真 token 與 regex 定義字串，脆弱。

### D2：排除 `codex/agents/` 對稱

**選擇**：排除清單含 `codex/agents/`，即使目前該目錄無 agent。

**理由**：與 `claude/agents/` 對稱，Codex agents 同為外部套件 `.toml`／`.md`，日後新增時自動涵蓋，避免遺漏。`codex/AGENTS.md`（全域指示、使用者會改）**不**在排除內——它是設定來源，非套件文件。

### D3：明文承擔「套件文件機密不再被 text 掃描」

**選擇**：文件寫明——agents/skills 套件文件若真含機密，不再被 `safety:check` 的 text pattern 攔下。

**理由**：這些是公開上游原樣鏡射、本 repo 不編輯的內容，其「機密」多為文件示例而非真憑證；真正的機密載體（結構化設定、使用者手改的來源檔）仍全覆蓋。此為拿「對第三方文件的偵測」換「消除整類誤判 + 可用 clean gate」的明文取捨。

## Risks / Trade-offs

- **[套件文件真機密漏偵]** 若某上游 agent／skill 文件真的內嵌有效憑證，`safety:check` text 掃描不再攔 → 緩解：這些為公開上游、非本 repo 產物；新增 agent 時的人工審核與上游本身的公開性為外層防線。屬明文承擔（D3）。
- **[排除前綴漏列新套件目錄]** 日後若新增別的外部套件目錄（非 agents/skills）→ text 掃描仍會對它跑、可能再現誤判 → 緩解：屆時把新目錄前綴加進 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 即可；集中常數使擴充單點。
- **[過度排除回歸]** 實作不慎把設定來源（statusline.sh／AGENTS.md）也排除 → 緩解：測試同時鎖「套件文件不觸發」與「設定來源仍觸發」兩向，防過度排除。
