## Context

`add-opencode-sync`（2026-07-08 歸檔）新增了 `opencode` area，同步兩個項目：主設定檔（`opencode.json`／`opencode.jsonc`）與全域指示 `AGENTS.md`。當時的設計理由是讓 opencode 的全域指示「獨立於 Claude 的 `CLAUDE.md`，可與之分歧」。

實際狀態（2026-07-20 實測）推翻了這個前提：

| 檔案 | 行數 | 與其他檔的關係 |
|---|---|---|
| `claude/CLAUDE.md` | 63 | 基準 |
| `codex/AGENTS.md` | 43 | = CLAUDE.md 扣掉「檢視低污染慣例」20 行 |
| `opencode/AGENTS.md` | 43 | **與 `codex/AGENTS.md` 逐字相同，僅標題行不同** |
| `opencode/opencode.json` | 3 | 只含 `$schema`，實質為空殼 |

預期中的分歧從未發生。同步機制在跨裝置搬運重複資料，並為此扛著一組僅 opencode 使用的 `variants` 檔名變體解析機制（`resolveVariantLabel` + manifest 可選欄位）。

本機端 `~/.config/opencode/` 為活躍安裝（volta 管理的 `opencode` 執行檔、設定家含 `node_modules/`），移除同步不代表停用該工具。

## Goals / Non-Goals

**Goals:**

- 移除 repo 端 `opencode/` 目錄與 `sync.js`／`safety-check.js` 中所有 opencode 專屬程式碼路徑
- 一併移除隨之成為零消費者的 `variants` 機制，不留無住戶的抽象
- 保持現有裝置行為完全不變

**Non-Goals:**

- **不觸碰本機 `~/.config/opencode/` 任何檔案**（含不刪除將成為孤兒的 `AGENTS.md`）
- 不處理 `codex/AGENTS.md` 與 `claude/CLAUDE.md` 的重複問題（同源議題，獨立變更）
- 不驗證或依賴 opencode 的 `AGENTS.md` fallback 行為
- 不移除 `homeLabel`／`homeRootFile` 兩個同樣無 manifest 使用者的可選欄位

## Decisions

### D1：只刪 repo 端，本機檔留為孤兒

**選擇**：移除 repo 端與程式碼，`~/.config/opencode/AGENTS.md` 原封不動保留，README 註明使用者可自行 `rm`。

**理由**：`remove-mcp-sync` 已確立先例——「為清理而寫本機檔會與『不寫入本機』原則自相矛盾」。孤兒檔在此案的漂移風險趨近於零：該檔是 `codex/AGENTS.md` 的逐字副本，內容本就不會獨立演化。

**替代方案**：刪除本機 `AGENTS.md`，讓 opencode fallback 讀 `~/.claude/CLAUDE.md`。**否決**——此方案整個建立在「opencode 缺 `AGENTS.md` 時會 fallback 讀 `~/.claude/CLAUDE.md`」之上，而該行為目前**僅見於本專案 `CLAUDE.md` 的敘述，未經官方文件或原始碼驗證**。保留本機檔使本變更完全不依賴這項未驗證前提，把風險移轉到「未來新裝置」這個可延後處理的場景。

### D2：`variants` 刪乾淨，不比照 `homeLabel`／`homeRootFile` 保留

**選擇**：刪除 `resolveVariantLabel` 函式、manifest 型別註記中的 `variants` 欄位、`sync.js` 的 re-export，以及對應測試。

**理由**：兩者性質不同。`homeLabel`（兩端檔名不同）與 `homeRootFile`（本機端在 `$HOME` 直屬）描述的是**任何工具都可能遇到的通用佈局差異**，故 `declarative-sync-manifest` spec 明文要求保留並以合成 entry 維持覆蓋。`variants` 解決的是「某工具副檔名尚未定案」的特例——Claude 與 Codex 皆無此問題。保留一個無住戶的特例抽象，等於為想像中的使用者長期支付測試與文件維護成本。

**替代方案**：比照保留 + 合成 entry 測試。**否決**，理由如上。若未來真出現雙副檔名的工具，從 git 歷史取回實作即可。

### D3：`opencode-sync` capability 整個移除，而非降級

**選擇**：delta spec 對 `opencode-sync` 的全部四項要求標記 `REMOVED`，archive 時該 capability 目錄消失。

**理由**：該 capability 的四項要求（獨立 area、雙項目同步、變體解析、機密不在射程）全部繫於「存在 opencode area」這個前提。前提消失後沒有任何殘留要求可保留，降級或部分保留只會留下描述不存在行為的死 spec。

### D4：不留回歸鎖，求零殘留

**選擇**：不加任何「opencode／variants 不得復活」的 drift-guard 測試，delta spec 亦不含對應的 SHALL NOT 要求。

**理由**：使用者明確要求「opencode 有關的都要刪除乾淨，不用為了日後而保留」。回歸鎖雖能擋下復活，但本身會讓 `opencode` 與 `variants` 字樣繼續存在於測試檔與 spec 中，與零殘留的目標直接衝突。

**替代方案**：比照既有的「不含 `config.toml`」「`mcp`／`advisory` 不得復活」鎖法加三條 drift-guard。**否決**——那些鎖存在的理由是「該機制曾寫入本機敏感檔、復活有實質風險」；opencode 同步從未觸碰敏感檔，復活的後果僅是同步一份重複資料，風險不對等，不值得用殘留字樣換取。

**代價**：日後若有人加回 `SYNC_AREAS.opencode`、manifest 列或 `variants` 欄位，不會被測試擋下，僅能靠 code review 與本 change 的 archive 紀錄察覺。

### D5：`safety-check` 掃描目錄同步收斂

**選擇**：`SAFETY_SCAN_DIRS` 移除 `'opencode'`。

**理由**：該常數的語意是「repo 中會被同步或描述同步狀態的來源」。`opencode/` 目錄刪除後，保留該項會讓 safety:check 掃一個不存在的目錄，且與 spec 敘述不符。此常數有 drift-guard 測試與 README 對照，須三處同步更新。

## Risks / Trade-offs

- **新裝置 clone 後拿不到 opencode 全域指示** → 兩種結果皆可接受：fallback 若生效則吃 `~/.claude/CLAUDE.md`（與現況幾乎等價，僅多 20 行 Claude Code 專屬慣例）；若不生效則手動複製一次。此為一次性設定成本，且發生時機可延後。README 應載明此事。
- **本機孤兒檔失去跨裝置一致性保障** → 影響極小：內容為 `codex/AGENTS.md` 逐字副本，不會獨立演化。使用者可自行 `rm` 或保留。
- **`variants` 刪除後若未來需要雙副檔名支援，須重新實作** → 從 git 歷史取回（本變更 commit 的父節點即含完整實作與測試）。相較於長期維護無住戶抽象，重寫成本更低。
- **無回歸鎖，復活不會被測試擋下** → 見 D4，屬刻意取捨。archive 後本 change 的 proposal／design 仍留在 `openspec/changes/archive/`，是唯一的決策紀錄。
- **測試改動面積大（`sync.test.js` 34 處、`boundary.test.js` 7 處）** → 多數為 opencode 專屬測試的整段刪除，非邏輯改寫；少數 drift-guard（label 清單、README 對照、`materializeSyncItem` 產出不變）需調整期望值。`sync.test.js:305` 的 `norm` 函式（正規化 `opencode.jsonc?` → `opencode.CONFIG`）於 opencode 移除後失去用途，一併清除。
- **文件三處同步更新遺漏** → `README.md` 同步項目表與 `SAFETY_SCAN_DIRS` 清單已有 drift-guard 測試把關，漏改會 fail；`CLAUDE.md` 與 `ROADMAP.md` 無測試把關，須人工確認。

## Migration Plan

無資料遷移。使用者側動作為可選：

1. 本變更合併後，各裝置 `~/.config/opencode/AGENTS.md` 成為孤兒檔，行為不變
2. 使用者可自行決定保留或 `rm ~/.config/opencode/AGENTS.md`
3. 新裝置設定 opencode 時，自行複製一份全域指示或依賴 fallback

**回滾**：本變更為純刪除，`git revert` 即可完整還原程式碼、測試與 repo 端檔案。

## Open Questions

- opencode 缺 `AGENTS.md` 時是否確實 fallback 讀 `~/.claude/CLAUDE.md`？**本變更刻意設計為不依賴此答案**（見 D1），僅影響 README 對新裝置的建議措辭。若日後實測確認，可回填 README。
