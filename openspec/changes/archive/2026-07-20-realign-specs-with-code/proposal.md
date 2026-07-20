## Why

`openspec/specs/` 已與程式碼實況脫節。三個成因疊加：（1）`2026-07-20-remove-mcp-sync` 的 delta 只涵蓋 3 份 spec，漏掉 `bidirectional-sync-workflow` 與 `sync-write-safety`，留下描述已刪除功能的規範；（2）commit `8adc319`（收斂零消費者 export）為純 refactor、未走 openspec 流程，改動了 `toml-reader.js` 的對外契約卻未更新 spec；（3）歷史沉積——`claude-settings-sync` 的 Purpose 仍描述 `flip-settings-sync-to-blocklist` 之前的舊白名單設計，5 份 spec 的 Purpose 仍是 `TBD` 佔位符。

後果不只是「文件過時」：`bidirectional-sync-workflow:43` 現在要求的 advisory 行為，若照做會直接踢爆 `sync.test.js:590` 的回歸鎖，而 `declarative-sync-manifest:69-74` 明文要求該行為不得存在——同一 spec set 內自我矛盾。同時，兩條實際存在的安全防線（malformed TOML header 觸發 hard block、引號包裝 section 名正規化）完全無 spec 依據，未來重構容易被當成多餘邏輯移除。

## What Changes

以「程式碼為事實、spec 追上」為原則校正，唯一例外是 `skills:diff` 的一處實作不對稱，改為修程式碼向 spec 靠攏。

**移除已不存在的功能規範**
- 刪除 `bidirectional-sync-workflow` 中整段 `advisory` 型項目的閘門豁免規範與兩個對應 scenario
- 修正 `sync-write-safety` 寫入路徑列舉，移除已隨 MCP 一併刪除的 `writeTextSafe`

**補記已存在但無 spec 依據的行為**（安全相關，優先）
- `safety-check` hard block 清單補入「malformed TOML section header」一整類（`safety-check.js:190`，severity `hard`、exit 2）
- `safety-check` 補記引號包裝 section 名的正規化（`splitTomlKey`，`["mcp_servers"]` 等變體亦命中 hard block）
- `safety-check` 掃描範圍清單補入 `agents/`（`SAFETY_SCAN_DIRS` 已含，但條文漏列，與同 Requirement 的 scenario 自相矛盾）
- `toml-statement-reader` 匯出清單校正：移除已改私有的 `scanTomlValueState`、補入實際匯出且為安全關鍵的 `splitTomlKey`
- `declarative-sync-manifest` 補記 `variants` 欄位（`SYNC_MANIFEST` 實際使用中，全 spec 零描述）與 `homeLabel`／`exclude`

**校正描述已被推翻之設計的條文**
- 重寫 `claude-settings-sync` 的 Purpose：移除不存在的 `DEVICE_ENV_KEYS`、移除「env 依 `SENSITIVE_KEY_PATTERN` 排除」與「值層防線在同步流程中攔截機密」兩項不實描述（前者與同檔 Requirement 本體相反，後者把事後獨立指令錯置為寫入路徑上的防線）
- 移除 `claude-settings-sync` 中所有對 `DEVICE_ENV_KEYS` 的指涉（該常數在程式碼中不存在，使該 scenario 的前置條件不可判定）
- 重寫「settings.json 明細 diff 不顯示 env 值」：現行條文規定「env 差異 SHALL 以 key 層級呈現、值 SHALL 被遮罩」，此機制**從未建造**且與專案刻意設計相反（`diff` 只輸出狀態行、不印設定內容）。改為據實規範「不輸出任何設定內容」
- `declarative-sync-manifest` 的 `homeRootFile` scenario 改用中性範例：現用 `.claude.json`，但同 spec `:56-57` 明文禁止該列存在，使 WHEN 條件永不成立、不可驗證
- `cross-tool-skill-sync` 的 symlink 橋規範補上 direction 限定（實作只在 `to-local` 建立）

**唯一程式碼修正**
- `skills.js:126` 的安裝建議對 `skill.source` 加了 spec 未載明的前置條件，缺 `source` 時該 skill 出現在狀態行卻無任何建議指令，且與 `onlyInLocal` 分支（有 `<source>` placeholder fallback）不對稱。改為對稱處理，並在 spec 補 scenario

**文件與 Purpose 回填**
- 回填 5 份 spec 的 `TBD` Purpose：`declarative-sync-manifest`、`safety-check`、`safety-check-module-boundary`、`cross-tool-skill-sync`、`skills-module-boundary`
- `CLAUDE.md:84` 同樣殘留 `writeTextSafe`，一併修正

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `bidirectional-sync-workflow`: 移除 advisory 型項目的確認閘門豁免規範
- `sync-write-safety`: 寫入路徑列舉移除 `writeTextSafe`
- `toml-statement-reader`: 對外匯出清單校正；`scanTomlValueState` 降為內部細節
- `safety-check`: hard block 清單補 malformed header 與引號 section 正規化；掃描範圍補 `agents/`
- `declarative-sync-manifest`: manifest 欄位列舉補 `variants`／`homeLabel`／`exclude`；`homeRootFile` scenario 改中性範例
- `claude-settings-sync`: 移除 `DEVICE_ENV_KEYS` 指涉；重寫 diff 輸出規範以符合「只輸出狀態行」的實際設計
- `cross-tool-skill-sync`: symlink 橋規範補 direction 限定
- `skills-lock-diff`: 補記 lock 項目缺 `source` 時的建議指令行為

## Impact

- **spec**：8 份 delta spec + 5 份主 spec 的 Purpose 回填
- **程式碼**：`skills.js`（一處對稱性修正）、`CLAUDE.md`（一處殘留函式名）
- **測試**：新增 `skills:diff` 缺 `source` 的覆蓋；既有 300 項測試行為不變
- **非目標**：不重新設計 MCP 同步、不建造 settings key 層級 diff、不改動任何同步行為
