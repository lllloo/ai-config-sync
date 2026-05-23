# 上游功能追蹤

追蹤本工具依賴的上游專案尚未完成的關鍵功能。當相關 issue／PR 合併後，本 repo 可考慮調整同步流程。

## vercel-labs/skills — 從 lock 檔跨裝置還原 global skills

**現況（2026-05-15 重新確認）**：CLI 已到 **1.5.7**（2026-05-14 釋出），但**仍無 global scope 的一鍵還原**。本 repo `skills-lock.json` 作各裝置 source of truth 的設計依舊有效，`npm run skills:diff` 仍只能提示指令、不自動執行。

**1.5.7 實際能力盤點：**

| 指令 | 範圍 | 用途 | 對本 repo 的意義 |
|---|---|---|---|
| `experimental_install` | **僅 project**（讀 `./skills-lock.json`） | 還原到 `.agents/skills/`，**明文不裝到 agent 目錄** | 不能直接用於 `~/.claude/skills` |
| `experimental_sync` | 僅 project（掃 `node_modules`） | 從 npm package 同步進 agent 目錄 | 不適用（非 npm workflow） |
| `update -g` | global | 升級已裝 global skills | 不能新裝缺漏項 |
| `add -g` / `remove -g` | global | 單項操作 | 仍是現行 workaround 基礎 |

**重要警告**：1.5.7 **完全不認 `--help` / `-h` 旗標**，子指令如 `experimental_install`、`update` 加 `--help` 會**直接執行**，不會印說明。實作或實測時禁止用 `--help` 試探子指令。

**追蹤項目：**

| Issue / PR | 狀態 | 最後更新 | 備註 |
|---|---|---|---|
| [#683 global restore/relink from `~/.agents/.skill-lock.json`](https://github.com/vercel-labs/skills/issues/683) | **Open（最對題）** | 2026-05-04 | 明文點出本 repo 痛點：「沒有 first-class workflow 還原 global canonical skills 與 agent 連結」 |
| [#549 `npx skills install`（npm ci 等價）](https://github.com/vercel-labs/skills/issues/549) | Open | 2026-04-26 | `experimental_install` 僅 project；Claude Code symlink 議題已被 #683 接續 |
| [#283 `skills install` / `skills sync` from lock](https://github.com/vercel-labs/skills/issues/283) | Open | 2026-05-09 | 社群 workaround：`npx skills update -p`（慢但能跑） |
| [#155 project 安裝未被 lock 追蹤](https://github.com/vercel-labs/skills/issues/155) | Open | 2026-05-08 | 與本 repo 全域同步設計無直接衝突，僅參考 |
| [#666 `experimental_install` 把 `https://` 砍掉](https://github.com/vercel-labs/skills/issues/666) | Open bug | 2026-03-16 | 若改採 `experimental_install` 橋接需處理 |
| [#1005 `experimental_install` strip subpath](https://github.com/vercel-labs/skills/issues/1005) | Open bug | 2026-04-27 | 同上 |
| [#132 .skills 版控檔跨裝置](https://github.com/vercel-labs/skills/issues/132) | Closed 2026-01-30（completed） | 2026-02-16 | 維護者以「已由 `~/.agents/.skill-lock.json` 提供」為由關閉，但未解決跨裝置還原 |
| [#937 merge skills-npm features into experimental_sync](https://github.com/vercel-labs/skills/pull/937) | Open PR | 2026-04-17 | 相關但非直接解決 |

**目前可用的 workaround（社群回報）：**

```bash
# Project-scope（不適用於本 repo 的全域同步需求）
bunx skills experimental_install

# Global-scope 唯一可行做法：逐項
npx skills add -g <source>
```

社群已出現多個自建 CLI 因應同題：`bmsuisse/skillup`、`jdevera/dotagents`——意味著上游短期內難以補位。

**本 repo 的補位策略：**

- **短期（現行）**：保持 `skills-lock.json` + `npm run skills:diff` 提示指令，使用者手動執行
- **中期**：若上游仍停滯，可在 `sync.js` 加 `skills:install` 指令，逐項呼叫 `npx skills add -g <source>`，繞開 #683 / #549 / symlink 與 subpath/https bug（評估方案 A，small 工作量）
- **長期**：`#683` 合併後，可簡化成單一 CLI 呼叫並更新 README

**觸發條件**：#683 合併（最對題），或 #549 連帶解決 global scope。

---

**維護方式**：定期檢查上述連結。若有新相關 issue，附到表格；若已合併／解決，更新狀態並評估是否調整本 repo 行為。
