# Design：跨工具全域 skill

## 目標佈局

```
  repo                          本機
  ─────────────────────         ──────────────────────────────────────────
  agents/skills/<name>/  ──sync──▶  ~/.agents/skills/<name>/   ← 正典（真實目錄）
   （無點，新區）                          ▲                      Codex 原生掃 ✓
                                          │ symlink（sync 建立）
                                  ~/.claude/skills/<name> ──────┘  Claude 探索 ✓（官方支援，會去重）

  claude/skills/<name>/  ──sync──▶  ~/.claude/skills/<name>/   ← 維持現狀：只給 Claude
  .agents/skills/<name>/            專案內，跨工具，維持現狀：只本 repo
```

## 決策

### D1：走 A-full（symlink 橋），不走 A-lite

Claude Code 不讀 `~/.agents/skills/`（官方探索路徑表），故無法只靠「改鏡射目的地」讓 Claude 看到。必須在 `~/.claude/skills/` 留探索點，且該點採 symlink（官方支援、與 npx 同軌、自動去重）。

### D2：新增 `agents/` 同步區，不重載 `claude/skills/`

`SYNC_AREAS` 加一列 `agents: { homeBase: ~/.agents, repoDir: 'agents', prefix: 'agents/' }`。命名與既有慣例同構（無點 repo 目錄 ↔ 家目錄點目錄）。跨工具分類 = 目錄位置，避免在 `SYNC_MANIFEST` 引入 per-skill flag。

### D3：新增 `xtool-skills` 同步型別（不可複用 `dir`）

**理由**：`mirrorDir`（`sync.js:602-615`）對 dest 內不在 src 的檔案一律 `rmSync`。`~/.agents/skills/` 與 `npx skills` 共管，套用 prune-extras 會**刪光 npx 裝的全域 skill**。

新型別語意：

- **apply（to-local）**：對 repo `agents/skills/` 下每個 skill 名 `<name>`：
  1. 以「只認名」upsert 把 `agents/skills/<name>/` 內容寫進 `~/.agents/skills/<name>/`（此 skill 目錄內部仍可 prune 該目錄自己的殘檔，但**絕不觸碰 sibling skill 目錄**）。
  2. 確保 `~/.claude/skills/<name>` 為指向 `~/.agents/skills/<name>` 的 symlink（不存在則建、指錯則修）。
  - **never** 列舉 `~/.agents/skills/` 全體再刪差集——只迭代 repo 受管名字。
- **apply（to-repo）**：只從 `~/.agents/skills/<受管名字>/` 讀回 repo，不掃描、不吸入 npx 住戶。
- **diff**：只比對受管名字；輸出狀態行，不列 npx 住戶。

### D4：機制選 (a) 真實目錄＋symlink，不選 (b) 反向 symlink 進 repo

- (a) `~/.agents/skills/` 放**真實目錄**（同 npx 佈局，Codex 已知可讀）、`~/.claude/skills/` 放 symlink（官方支援）。兩條探索路徑皆已知可靠。
- (b) 兩 tool 目錄都 symlink 進 repo 工作區——編輯迴圈更快，但「Codex 是否跟隨 `~/.agents/skills/` 內的 symlink」**未驗證**，且與 repo「複製內容」的一貫模型不一致、綁死 repo 路徑。安全優先，選 (a)。

## 需要改動的位置（sync.js 分派點）

- `SYNC_AREAS`：加 `agents` 區。
- `SYNC_MANIFEST`：加 `{ area: 'agents', label: 'skills', type: 'xtool-skills' }`，**必須插在 `claude` 區 `skills` dir 列之前**——順序即安全：xtool 先完成 agents 端寫入與 dir→symlink 轉換，claude mirror 再跑時 dest 只剩 symlink（`getFiles` 會跳過），不會在 agents 端寫入前誤刪真實目錄（見 D5 的空目錄陷阱）。
- `diffSyncItem` / `applySyncItem` 兩個 `switch`：接上 `xtool-skills` 分支。
- `buildFullDiffList`：若 `xtool-skills` 需摘要行呈現（類比 `dir` 特判）。
- 新增 symlink 建立工具函式（sync.js 至今無 symlink 能力）：需走 atomic 慣例、Windows fallback 策略（見 open question）。**型別判斷一律 `lstatSync`**——`statSync`／`existsSync` 會跟隨 link，把正確 symlink 誤判成真實目錄（每次 apply 重走 D5 刪建、破壞幂等）；懸空 symlink 對 `existsSync` 回 false，須以 lstat 辨識後 unlink 重建，不可直接 `symlinkSync`（會 EEXIST）。
- `mirrorDir` **不改**（保留 prune 語意給獨佔目錄的 `dir` 型）；新型別用獨立的非 prune 實作。

## 需要同步的文件與測試

- README：同步項目表加 `agents/skills/` 一列；「刻意不同步」與命名說明。
- CLAUDE.md：目錄命名節加 `agents/`（無點）；Skills 管理節補「全域跨工具」層。
- drift-guard：`SYNC_AREAS`／`SYNC_MANIFEST` ↔ README 的既有 drift 測試涵蓋新區。
- 沙箱整合測試：`apply-integration.test.js` 加 `xtool-skills` 雙向 apply，**特別測「共管目錄下 npx 住戶不被刪」**（模擬 dest 有非受管 skill，apply 後仍在）。
- `boundary.test.js`：symlink 建立失敗 fallback、to-repo 不吸入非受管名字。

## D5：遷移路徑（一次性，破壞性，必須有）

現狀：`bmad-run-story`、`mini-research`、`pen-design` 在 repo 是 `claude/skills/<name>/`、在本機是 `~/.claude/skills/<name>/` **真實目錄**。切到新機制需：

1. **repo 端搬移**：`git mv claude/skills/<name> agents/skills/<name>`（三個 skill），並**確認 repo `claude/skills/` 不殘留空目錄**——`mirrorDir` 只在 src 不存在時提早返回；src 存在但為空會把 dest 差集全數 prune，若 `claude/skills` dir 列又排在 xtool 列之前，會在 agents 端寫入前先刪光本機真實目錄（繞過第 2 點的順序保證）。防線有二：移除殘留空目錄＋manifest 順序（xtool 在前，見「需要改動的位置」）。
2. **本機端 dir→symlink 轉換**（`to-local` 首次跑新機制時）：
   - 先 upsert 到 `~/.agents/skills/<name>/`（真實目錄）。
   - 再把 `~/.claude/skills/<name>` 從**真實目錄**改成指向 `~/.agents/skills/<name>` 的 symlink：需「先確認 `~/.agents` 端已寫成功 → 刪 `~/.claude` 真實目錄 → 建 symlink」，任一步失敗要能回滾或至少留下可見警告（沿用 `partialChanges` 機制），**不可在刪掉真實目錄後、建 symlink 前中斷而掉 skill 內容**。註：dir→symlink 轉換本質上無法原子（rename 不能以 symlink 覆蓋目錄），可保證的是「正典內容已先安全落在 `~/.agents`」——殘餘空窗僅限 Claude 探索點短暫缺席、不損失內容，測試斷言以此為準。
3. 轉換具**幂等性**：已是正確 symlink 就跳過。

## D6：共管目錄的同名碰撞守門

`~/.agents/skills/<name>` 與 `~/.claude/skills/<name>` 都可能已被 npx 佔用同名。upsert 前必須偵測：

- **碰撞判準唯一：`<name>` 登記於 `~/.agents/.skill-lock.json`**（npx 安裝必有登記；本機制永不登記）→ **拒絕覆寫、報 warning**，不 silently 蓋掉 npx 的 skill。
- **「claude 側 symlink 存在」不得作為碰撞訊號**：本機制首次 apply 後的產物（agents 真實目錄＋claude symlink）與 npx 產物在檔案系統上無法區分，用它判碰撞會讓第二次 apply 起所有受管 skill 被誤判、直接破壞幂等。
- **已知取捨**：手動複製進 `~/.agents/skills/`、未登記 lock 的同名目錄無 ownership 標記可辨，會被視為受管而覆寫。接受此風險，記錄於 README 共管語意補述。
- diff 階段就先標示碰撞,別等到 apply 才炸。**呈現方式**：新增 diff status 值 `conflict`，以狀態行輸出（不印內容），計入 `EXIT_DIFF=1`。

## 已驗證的外部事實（原 open question 收斂）

- **③ Codex 讀 `~/.agents/skills/` — 已用原始碼確認**：`openai/codex` `codex-rs/core-skills/src/loader.rs:335-339` 明確 `home_dir.join(".agents").join("skills")` push 成 `SkillScope::User` root（附註解 `// $HOME/.agents/skills`）。且讀的是**真實目錄**,對上機制 (a),不需 Codex 跟 symlink。地基成立。
- **T2 #743 — 大幅降險**：PR #743 為**加法型 restore**（reads lock → restores canonical → recreates links），diff 內**無** prune/delete 未登記項的邏輯,測試明載「without disturbing overlapping project-scoped skills」。我們的未登記住戶會被略過、不被刪。**保留追蹤**：grep diff 非逐行讀、PR 未 merge 仍可能變,#743 merge 時複驗即可,不再是阻塞級風險。

## 未決

- **Windows symlink** fallback：優先評估 **junction**（`fs.symlinkSync(target, path, 'junction')`，Windows 免開發者模式、對讀取工具透明）；需測 Claude/Codex 是否認 junction。次選：報錯中止或退回雙寫副本。
- **opencode** skill 探索是否納入（目前 Non-Goal；opencode 是否讀 skill、讀哪未查證）。
