## Context

`sync.js` 目前把同步、欄位過濾、敏感命名判斷與值層防線綁在一起。這讓同步流程能防止部分機密誤入 repo，但也讓一般設定 key 因名稱含 `key`、`auth`、`refresh`、`session` 等字樣而被自動排除或中止。

本 repo 的使用模式是個人跨裝置設定同步，使用者願意在提交前人工審核可疑項目。因此安全驗證應成為獨立、可重跑、唯讀的檢查指令，而不是同步流程內的隱性決策。

## Goals / Non-Goals

**Goals:**
- 讓 `sync.js` 的同步流程只處理明確不同步項目與資料搬移。
- 新增 `npm run safety:check` 作為手動、唯讀、離線安全檢查。
- 將敏感命名降級為 warning，交由使用者人工審核。
- 對明顯高風險內容使用 hard block exit code，避免使用者忽略。

**Non-Goals:**
- 不加入 LLM review。
- 不建立或安裝 git pre-push hook。
- 不自動修復或改寫任何檔案。
- 不新增外部 npm 套件。
- 不把此工具改造成通用 secret scanner。

## Decisions

### Decision 1: safety check 獨立於同步流程

`npm run to-repo` 仍只負責把本機設定同步到 repo。安全檢查由 `npm run safety:check` 手動執行，讓使用者可在 `to-repo` 後、commit 前、push 前自行決定何時審核。

替代方案：在 `to-repo` 後自動跑 safety check。拒絕，因為會讓同步指令再次背負安全決策與 exit code 語意。

替代方案：pre-push hook 自動跑。拒絕，因為 hook 可被 `--no-verify` 繞過，且會把本機 git 工作流程與此工具耦合。

### Decision 2: 敏感命名只作 warning

命名包含 `token`、`secret`、`credential` 等字樣的 key 不再於同步時自動剝除或中止。`safety:check` 只列出 key path，值一律不顯示，讓使用者判斷是否合理。

替代方案：保留目前 `SENSITIVE_KEY_PATTERN` 的同步排除。拒絕，因為 substring pattern 已知會誤傷 `keyboardLayout` 等可攜設定。

### Decision 3: 明確高風險內容仍 hard block

`safety:check` 對已知 token 值、私鑰片段、絕對 HOME 路徑、repo 內出現 `hooks` 或 credential helper 欄位等狀況回傳 hard block。這些訊號誤判成本相對低，漏判成本高。

替代方案：全部只 warning。拒絕，因為明顯 secret 值不應只靠人工在大量輸出中辨識。

### Decision 4: 掃描範圍限於同步來源與關鍵 manifest

`safety:check` 掃描 repo 中會被同步或描述同步狀態的來源：`claude/`、`codex/`、`skills-lock.json`。不掃 `test/`、`openspec/`、README 等文件，避免測試 fixture 與文件範例造成噪音。

替代方案：掃整個 git repo。暫不採用，因為本 repo 含大量 agent/skill 文件與測試內容，容易產生與同步安全無關的噪音。

## Risks / Trade-offs

- 使用者忘記執行 `npm run safety:check` → 文件與 `to-repo` 完成訊息提醒，但不強制。
- 同步後、檢查前 repo 工作樹可能短暫含高風險值 → 這是將安全審核獨立化的代價；只要未 commit/push，尚未進 git history/remote。
- deterministic scan 無法辨識所有機密 → 明確標註為輔助工具，不宣稱完整 secret scanning。
- warnings 過多可能被忽略 → 初版只列 key path 與分類，保持低噪音。
