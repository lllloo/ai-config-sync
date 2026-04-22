# 上游功能追蹤

追蹤本工具依賴的上游專案尚未完成的關鍵功能。當相關 issue／PR 合併後，本 repo 可考慮調整同步流程。

## vercel-labs/skills — 從 lock 檔跨裝置還原

**現況**：我們用 `skills-lock.json` 作各裝置 skills 清單的 source of truth，但 `npx skills` **尚無穩定的一鍵還原指令**，新裝置需手動 `npx skills add -g <source>` 逐項安裝。

**追蹤項目**：

| Issue / PR | 狀態 | 最後更新 | 備註 |
|---|---|---|---|
| [#283 skills install / skills sync from lock](https://github.com/vercel-labs/skills/issues/283) | Open（WIP 宣告於 2026-02-18，停滯） | 2026-04-21 | 有人留言「great idea! WIP」後 2 個月無進展，社群持續追問 |
| [#549 npx skills install（npm ci 等價）](https://github.com/vercel-labs/skills/issues/549) | Open | 2026-04-20 | 社群回應：`npx skills experimental_install` 已可用，但多位使用者回報 **Claude Code symlink 未建立**（Codex 正常） |
| [#132 .skills 版控檔跨裝置](https://github.com/vercel-labs/skills/issues/132) | Closed 2026-01-30（completed） | 2026-02-16 | 提交者 `quuu` 以「已由 `~/.agents/.skills-lock.json` 提供」為由關閉，但未解決跨裝置還原 |
| [#937 merge skills-npm features into experimental_sync](https://github.com/vercel-labs/skills/pull/937) | Open PR | 2026-04-17 | 相關但非直接解決 |

**目前可用的 workaround**（社群回報）：

```bash
npx skills experimental_install
# Codex 可用，Claude Code 的 symlink 要自己補建
```

**本 repo 的補位策略**：

- 短期：保持用 `skills-lock.json` + `npm run skills:diff` 提示指令，讓使用者手動執行
- 中期：若上游仍停滯，可考慮在 `sync.js` 加 `skills:install` 指令，逐項呼叫 `npx skills add -g <source>`，繞開 symlink bug
- 長期：`npx skills install` 合併後，簡化成一行呼叫，並在 README 更新流程

**觸發條件**：#283 或 #549 合併、experimental_install 的 Claude Code symlink bug 修復。

---

**維護方式**：定期檢查上述連結。若有新相關 issue，附到表格；若已合併／解決，更新狀態並評估是否調整本 repo 行為。
