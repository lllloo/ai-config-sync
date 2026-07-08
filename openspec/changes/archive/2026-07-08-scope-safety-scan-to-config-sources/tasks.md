## 1. safety-check.js 掃描範圍限縮

- [x] 1.1 新增常數 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES = ['claude/agents/', 'claude/skills/', 'codex/agents/']`（相對 REPO_ROOT 的 POSIX 前綴），附 doc comment 說明「外部套件文件排除 text pattern 掃描」的理由
- [x] 1.2 在 `runSafetyChecks` 逐檔迴圈中，對相對路徑（`toRelativePath` + `replace(/\\/g,'/')` 正規化）命中排除前綴的檔**只略過 `scanSafetyTextFile`**，仍呼叫 `scanSafetyStructuredFile`（對 `.md` no-op、對未來 `.json`/`.toml` 保留偵測）
- [x] 1.3 `module.exports` 匯出 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES`；`sync.js` re-export（供測試引用）

## 2. 測試

- [x] 2.1 `boundary.test.js` 新增案例：`claude/agents/foo.md` 含 `github_pat_...` 樣式與 `/home/user/` 路徑 → `safety:check` **不**回報 hard block、exit 0（套件文件豁免）
- [x] 2.2 `boundary.test.js` 新增案例：`codex/agents/bar.toml` 或 `claude/skills/x/SKILL.md` 含機密樣式 → 同樣不觸發 hard block（對稱排除）
- [x] 2.3 `boundary.test.js` 新增/確認反向案例：設定來源（`claude/statusline.sh` 或 `codex/AGENTS.md`）含機密樣式 → 仍 exit 2 hard block（防過度排除回歸）
- [x] 2.4 `npm test` 全數通過

## 3. 文件

- [x] 3.1 `CLAUDE.md`：更新架構重點 `safety-check.js` 段與修改守則的 `safety:check` 掃描範圍描述，記載 text pattern 掃描排除 `claude/agents/`／`claude/skills/`／`codex/agents/` 及其理由與取捨（D3 明文承擔）
- [x] 3.2 `README.md`：更新注意事項的 `safety:check` 掃描範圍說明

## 4. 收尾驗證

- [x] 4.1 全套件 `npm test` 全綠；`npm run safety:check` 對現有 repo 回 exit 0（確認 `opensource-sanitizer.md` 誤判消除、且無過度排除掩蓋真問題）
