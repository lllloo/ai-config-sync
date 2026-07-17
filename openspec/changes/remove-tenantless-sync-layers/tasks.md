## 1. 前置查核（實作前必做）

- [x] 1.1 ~~於各裝置查核 `~/.claude/commands`~~ → **改以 git 歷史查證，風險已解除且方向相反**：`claude/commands` 於 `1d06f4e`（2026-04-30）刻意清空；repo 端無 src 時 `mirrorDir` 提早返回不刪檔，故他機殘留物早已不被同步追蹤（未進版控 = 未同步），移除不失去任何同步中內容；反之殘留物在 `to-repo` 時會復活已移除的 command，移除該列正是堵掉此路。本機已確認為空。詳見 design Risks 第一項
- [x] 1.2 執行 `npm test` 取得綠燈基準線：**295 pass / 0 fail**

## 2. 移除 manifest 兩列與順序約束

- [x] 2.1 `sync.js`：`SYNC_MANIFEST` 移除 `{ area: 'claude', label: 'commands', type: 'dir' }` 列
- [x] 2.2 `sync.js`：`SYNC_MANIFEST` 移除 `{ area: 'claude', label: 'skills', type: 'dir' }` 列，並移除 `agents` 區 `xtool-skills` 列上方的三行順序約束註解（「必須排在 claude skills dir 列之前…見 design D5 空目錄陷阱」）
- [x] 2.3 確認 `xtool-skills` 型的 diff／apply 邏輯（`diffXtoolItems`／`applyXtoolItem`／`ensureSymlink`）**一行未動**——本變更不碰其行為
- [x] 2.4 **（實作中追加）** `collectSkillDiffSummary`：regex 由 `(?:claude|agents)/skills` 收斂為 `agents/skills`——`claude/skills/` 前綴的逐檔 label 已不可能產生；同步修正其 docstring 與 `printSkillDiffSummaries` 的 key 註解。已確認探索點 symlink entry 的 label（`agents/skills/<name> [claude 探索點]`）無檔名尾段故不匹配此 regex，收斂不影響其呈現

## 3. 撤除安全掃描排除前綴

- [x] 3.1 `safety-check.js`：`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 移除 `'claude/skills/'`，清單收斂為 `['agents/skills/']`
- [x] 3.2 執行 `npm run safety:check` 確認**與基準線一致、無新增命中**：改動前後皆 `exit=1`，輸出同為 4 筆既有 env key warning（`claude/settings.json` 的 env 審核提示）。註：原任務誤寫「clean exit 0」，本 repo 實際基準線即為 exit 1（僅 warning）；移除豁免是擴大掃描射程，未引入任何新命中

## 4. 測試調整

- [x] 4.1 `test/sync.test.js`：claude label 硬編碼 drift-guard 清單移除 `'commands'` 與 `'skills'`，改為 `['CLAUDE.md', 'settings.json', 'statusline.sh', 'rules']`
- [x] 4.2 `test/sync.test.js`：`materializeSyncItem` 的 exclude／無 exclude 兩處合成 entry（現用 `label: 'skills'`）改用存活項目 `label: 'rules'`，避免引用已不存在的 label
- [x] 4.3 `test/diff-integration.test.js`：dir 型 fixture 由 `claude/commands/pkg/sample.md` 改為 `claude/rules/pkg/sample.md`，同步更新斷言的 regex
- [x] 4.4 `test/apply-integration.test.js`：dir 同步中途失敗的 fixture 由 `claude/commands` 改為 `claude/rules`（`partialChanges` 可見度測試）
- [x] 4.5 `test/apply-integration.test.js`：移除三個共存測試——「xtool + claude mirror 共存：claude 區 mirror 不誤刪 agents 探索點 symlink（P4 回歸）」「xtool 空 claude/skills 情境」「xtool to-repo：~/.claude 探索點 symlink 不被吸回 repo claude/skills」。註：僅第一個原本紅燈，後兩個移除前已因前提消失而 trivially pass——正是其失去指涉對象的證據
- [x] 4.6 確認**未被刪除**的既有測試仍在並通過：`boundary.test.js` 的 `getFiles：逃逸到目錄外的 symlink 不被列入`（2 pass）、`isPathInside`（6 pass）、`apply-integration.test.js` 的「真實目錄轉 symlink」（3 pass）——三者是刪除 4.5 後的覆蓋依據（design D5／Risks 第二項），已驗證無缺口
- [x] 4.7 回歸鎖：既有的「`SYNC_MANIFEST`：agents/skills 為 xtool-skills 型且排在 claude skills dir 之前」測試（`sync.test.js:521`，計畫外發現——順序不變式原來也有測試把關）拆為兩個：保留「agents/skills 為 xtool-skills 型」，新增「不得含 claude 區 skills／commands dir 列」回歸鎖（對稱於既有「不得含 config.toml」鎖），註解載明恢復任一層須先重評估的後果
- [x] 4.8 **（實作中追加）** `test/boundary.test.js:1200`：safety text 掃描豁免的行為測試原以 `claude/skills/` 為對象改寫為 `agents/skills/`，並將 `claude/skills/` 移入「不再豁免」的反向斷言（與既有 `codex/agents/` 反向斷言並列，理由同構）。**此測試原為 `agents/skills/` 豁免的唯一行為覆蓋缺口**——改寫後覆蓋從已死前綴移至實際生效前綴，屬淨增益
- [x] 4.9 **（實作中追加）** `test/sync.test.js` 的 `collectSkillDiffSummary` 三個測試 fixture label 由 `claude/skills/...` 改為 `agents/skills/...`（源自 2.4 的 regex 收斂）
- [x] 4.10 `npm test` 全綠：**293 pass / 0 fail**（基準線 295 − 移除 3 個共存測試 + 1 個順序測試拆分為二 = 293）

## 5. 文件同步（依修改守則）

- [x] 5.1 `README.md`：同步項目表移除 `Command 定義` 與 `全域 Skill（Claude-only）` 兩列；「三種 Skill 分層」收斂為兩層；移除「Command 定義…`sync.js` 仍原樣支援此路徑」（該句正是幽靈的文件化）；`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 清單更新為僅 `agents/skills/` 並載明「同步層移除時排除前綴一併撤除、不做預防性列名」
- [x] 5.2 `CLAUDE.md`：目錄命名段的 `claude/` 說明移除 `commands` 與「**Claude-only** skill 放 `claude/skills/`」；「新增同步項目」段改為「全域 skill 一律放 `agents/skills/<name>/`（唯一落點）」
- [x] 5.3 `CLAUDE.md`：同步項目對應表移除 `claude/commands/` 與 `claude/skills/` 兩列；`agents/skills/` 列的備註移除順序不變式整句，改載明「dir→symlink 轉換內生於此型的 apply，不依賴與其他 manifest 列的相對順序」
- [x] 5.4 `CLAUDE.md`：Skills 管理三層表收斂為兩層，移除「全域·Claude-only（同步）」列與「只給 Claude 放 `claude/skills/`」敘述
- [x] 5.5 `CLAUDE.md`：於 Skills 管理段補恢復指引——加回 `claude/skills/` 須同步更新 label drift-guard 與回歸鎖、README 與兩層表，並**先重新評估**順序不變式復活的後果（指向 archive 的 D5 與本 change）
- [x] 5.6 **（實作中追加）** `CLAUDE.md` 架構重點的 Skills lock 段：「`npx skills list -g` 會把 `sync.js` 同步管理的 `~/.claude/skills/` skill（如 `ob`、`pen-design`）列入」——機制敘述因本變更失準（`~/.claude/skills/` 已無 dir 鏡射、只剩 symlink 橋），且舉例 `ob` 早已不存在。改為正典／橋接雙路徑敘述並換用實際存在的 skill 舉例

## 6. 驗收

- [x] 6.1 `npm run status` 輸出不再出現 `claude/commands/` 與 `claude/skills/` 兩列，其餘 8 列全綠、狀態與變更前一致
- [x] 6.2 `npm run diff -- --dry-run` exit 0；`npm run to-repo -- --dry-run` 回報「無任何變更」，確認移除未引入意外寫入
- [x] 6.3 `npm run safety:check` 與基準線一致（exit 1、僅既有 env warning，無新增命中）
- [x] 6.4 `openspec validate remove-tenantless-sync-layers` 通過
- [x] 6.5 函式行數守則：`sync.js` 僅縮不增（+7/−11），無函式因本變更超過 60 行
- [ ] 6.6 commit（繁體中文訊息，`refactor` 型），不 push（`main` 為保護分支）
