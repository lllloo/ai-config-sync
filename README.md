# sync-ai

跨裝置同步 Claude Code 設定的私有 Git repo 工具。

**同步項目**：`~/.claude/CLAUDE.md`、`~/.claude/settings.json`、`~/.claude/statusline.sh`、全域 agents、全域 commands、全域 skills

> **目錄命名**：`claude/`（無點）是要同步到 `~/.claude/` 的全域設定；`.claude/`（有點）是本 repo 自己在用的 GSD 工作流設定，**不參與同步**，兩者不互通。

## 使用方式

```bash
# 比較本機 vs repo 差異（不寫任何東西）
npm run diff

# 同時比較設定與 skills 差異
npm run status

# 本機設定 → repo（上傳）
npm run to-repo

# repo 設定 → 本機（套用，會先預覽再確認）
npm run to-local

# 比較本機 vs repo 的 skills 差異（不自動同步）
# 本機多裝者會同時列出 (A) 加入 repo 與 (B) 從本機移除 兩種建議指令
npm run skills:diff

# 新增 skill 到 skills-lock.json
npm run skills:add -- https://skills.sh/<org>/<repo>/<skill>
npm run skills:add -- <name> <source>

# 從 skills-lock.json 移除 skill
npm run skills:remove -- <name>

# 執行單元測試（node:test，零外部相依）
npm test
```

### 指令別名

可直接用 `node sync.js` 搭配簡寫：

| 指令 | 別名 |
|------|------|
| `diff` | `d` |
| `status` | `s` |
| `to-repo` | `tr` |
| `to-local` | `tl` |
| `skills:diff` | `sd` |
| `skills:add` | `sa` |
| `skills:remove` | `sr` |

### 旗標

| 旗標 | 說明 |
|------|------|
| `--dry-run` | 預覽操作，不實際寫入（適用 to-repo / to-local） |
| `--verbose` | 顯示詳細路徑與檔案大小 |
| `--version` | 顯示版本號 |
| `--help` | 顯示指令說明 |

```bash
# 範例：預覽 to-repo 會做什麼，不實際寫入
node sync.js to-repo --dry-run

# 範例：顯示詳細差異資訊
node sync.js diff --verbose
```

## 新裝置部署

```bash
git clone <your-repo-url>
cd sync-ai
npm run to-local
```

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `sync.js` | 主腳本，實作所有指令邏輯（無外部相依） |
| `test/sync.test.js` | 同步邏輯純函式單元測試（使用 Node.js 內建 `node:test`） |
| `test/settings.test.js` | settings.json 相關純函式單元測試 |
| `package.json` | 定義所有 npm 指令 |
| `claude/CLAUDE.md` | 對應 `~/.claude/CLAUDE.md` |
| `claude/settings.json` | 對應 `~/.claude/settings.json` |
| `claude/statusline.sh` | 對應 `~/.claude/statusline.sh` |
| `claude/agents/` | 對應 `~/.claude/agents/`（以 package 子目錄組織） |
| `claude/commands/` | 對應 `~/.claude/commands/` |
| `claude/skills/` | 對應 `~/.claude/skills/` |
| `skills-lock.json` | 全域 skills 清單（跨裝置 source of truth） |

## Exit Code

| Code | 說明 |
|------|------|
| `0` | 成功（diff 模式：無差異） |
| `1` | diff 模式：有差異（可用於 CI 判斷） |
| `2` | 錯誤 |

## 注意事項

- `settings.json` 的 `model`、`effortLevel` 為裝置特定設定，to-repo 時自動排除，to-local 時保留本機值
- `settings.json` 的 `env.OBSIDIAN_VAULT_ROOT` 同屬裝置特定（`DEVICE_ENV_KEYS`），同步時排除但保留本機值；`env` 其他 key（如 `EDITOR`）仍跨裝置同步
- `.agents/` 目錄（skill 實體檔案）已加入 `.gitignore`，不進 repo
- agents 儲存於 `claude/agents/`，以 package 子目錄分組
- Skills 不在自動同步範圍內，用 `npm run skills:diff` 查看差異；本機多裝者會列出 `npm run skills:add`（加入 repo）與 `npx skills remove`（從本機移除）兩種建議
- JSON 寫入使用 atomic write（先寫暫存檔再 rename），避免中途斷電導致檔案損壞
- 每次 to-repo / to-local 操作會記錄到 `.sync-history.log`（已加入 .gitignore）
