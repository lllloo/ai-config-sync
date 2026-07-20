## 1. 安全防線補記（優先）

- [ ] 1.1 `openspec/specs/safety-check/spec.md`：「safety check 回報 hard block」補入 malformed TOML section header 為 hard block 一類，並補記引號包裝 section 名的去引號正規化（含「MUST NOT 因看似冗餘而於重構中移除」的保護語句）
- [ ] 1.2 `openspec/specs/safety-check/spec.md`：「safety check 掃描同步來源」的掃描範圍清單補入 `agents/`，消除與同 Requirement 既有 scenario 的自相矛盾
- [ ] 1.3 `openspec/specs/toml-statement-reader/spec.md`：對外匯出清單改為 `isIncompleteTomlValue`／`matchTomlHeader`／`splitTomlKey`／`readTomlStatements`，並補記 `splitTomlKey` 為安全關鍵匯出
- [ ] 1.4 `openspec/specs/toml-statement-reader/spec.md`：「多行 value 續行」Requirement 改以 `isIncompleteTomlValue` 表述，`scanTomlValueState` 降為內部細節
- [x] 1.5 對照 `safety-check.js:190`／`safety-check.js:213` 與 `test/boundary.test.js:1107-1136`，確認 1.1 的兩條補記與實際實作及既有測試斷言一致

## 2. 移除已刪除功能的規範

- [ ] 2.1 `openspec/specs/bidirectional-sync-workflow/spec.md`：刪除「to-local 採預覽後確認的閘門」中的 advisory 豁免段落與兩個 advisory scenario，改為「所有型別差異皆計入待寫入變更數」
- [ ] 2.2 `openspec/specs/sync-write-safety/spec.md`：寫入路徑列舉移除 `writeTextSafe`，並加上「清單不得保留已刪除函式」的 scenario
- [x] 2.3 全 `openspec/specs/` grep `advisory`／`writeTextSafe`，確認除 `declarative-sync-manifest` 中「advisory 型別不得存在」的回歸鎖外無其他殘留

## 3. 其餘 spec 校正

- [ ] 3.1 `openspec/specs/declarative-sync-manifest/spec.md`：manifest 欄位列舉補 `variants`／`homeLabel`／`exclude`，並註明 `variants` 有實際使用者、另兩者為保留能力
- [ ] 3.2 `openspec/specs/declarative-sync-manifest/spec.md`：`homeRootFile` scenario 的範例由 `.claude.json` 改為 `.root-level.json`，使 WHEN 條件可判定（原範例被同 spec 明文禁止）
- [ ] 3.3 `openspec/specs/cross-tool-skill-sync/spec.md`：symlink 橋 Requirement 補 `to-local` 方向限定，並加上「to-repo 不觸碰探索點」scenario
- [ ] 3.4 `openspec/specs/claude-settings-sync/spec.md`：env Requirement 移除所有 `DEVICE_ENV_KEYS` 指涉，改以「裝置特定或平台綁定的 env key」描述，並加上「不存在 env 黑名單常數」scenario
- [ ] 3.5 `openspec/specs/claude-settings-sync/spec.md`：將「settings.json 明細 diff 不顯示 env 值」更名為「diff 與 status 不輸出任何設定內容」並重寫內容，刪除從未建造的「key 層級呈現 + 值遮罩」規定

## 4. skills:diff 對稱性修正（唯一程式碼改動）

- [x] 4.1 `skills.js` `onlyInRepo` 分支：lock 項目缺 `source` 時仍輸出 `npx skills add` 建議並以 `<source>` 佔位符標示，比照 `onlyInLocal` 分支既有作法
- [x] 4.2 `test/skills.test.js` 新增覆蓋：repo lock 項目缺 `source` 時，`skills:diff` 輸出仍含該 skill 的建議指令
- [ ] 4.3 `openspec/specs/skills-lock-diff/spec.md`：補「lock 項目缺 source 仍輸出建議」scenario 與兩分支對稱性要求
- [x] 4.4 確認 `computeSkillsDiff` 的集合計算與 exit code 語義未受影響，既有 `test/skills.test.js` 全綠

## 5. Purpose 回填與文件修正

- [x] 5.1 回填 `openspec/specs/declarative-sync-manifest/spec.md` 的 `TBD` Purpose
- [x] 5.2 回填 `openspec/specs/safety-check/spec.md` 的 `TBD` Purpose
- [x] 5.3 回填 `openspec/specs/safety-check-module-boundary/spec.md` 的 `TBD` Purpose
- [x] 5.4 回填 `openspec/specs/cross-tool-skill-sync/spec.md` 的 `TBD` Purpose
- [x] 5.5 回填 `openspec/specs/skills-module-boundary/spec.md` 的 `TBD` Purpose
- [x] 5.6 重寫 `openspec/specs/claude-settings-sync/spec.md` 的 Purpose：移除 `DEVICE_ENV_KEYS`、移除「env 依 `SENSITIVE_KEY_PATTERN` 排除」與「值層防線於同步流程中攔截機密」兩項不實描述（後者實為事後獨立指令，不在寫入路徑上）
- [x] 5.7 `CLAUDE.md:84`：移除殘留的 `writeTextSafe`
- [x] 5.8 grep 全 repo 確認 `writeTextSafe`／`DEVICE_ENV_KEYS` 除測試註解外無殘留，必要時一併清理 `test/settings.test.js:116-117` 的過時註解

## 6. 收尾驗證

- [x] 6.1 `openspec validate realign-specs-with-code --strict` 通過
- [x] 6.2 `npm test` 全綠（既有 300 項 + 4.2 新增）
- [x] 6.3 `npm run safety:check` 行為不變
- [x] 6.4 `npm run diff` 輸出行為不變（確認第 4 節改動未影響設定同步路徑）
- [ ] 6.5 逐條複核本 change 提出的 12 項落差皆已消解，且未夾帶任何未載明的 spec 措辭改動
