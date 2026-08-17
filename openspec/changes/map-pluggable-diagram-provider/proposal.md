# map 繪圖能力外派為可插拔 provider

## Why

`map` 目前把「分析架構」與「畫出架構圖」綁在同一份 SKILL.md，而其中的「設計品質」一節（`agents/skills/map/SKILL.md:48`）只寫「`artifact-design` 的結論幾乎全數適用」，本文一個字都沒有——那些結論在 Claude Code 解得開，在 Codex 端是空指標。skill 本身跑得動（`xtool-dir` 型，兩端都同步得到），但圖面設計的基準只在單一工具存在。

同時，繪圖是一個上游演進很快的領域（`diagram-design` 三天前才 push 2.4.0），把圖面規則長期養在 `map` 本文裡，等於用一個同步工具的 repo 去追一個設計系統的上游。職責切開之後，`map` 專心做它不可替代的事——讀宣告、以 `rg` 驗證實作、標出「文件主張」與「已驗證」之間的落差——圖面交給可替換的 provider。

## What Changes

- **BREAKING**（對 `map` 的使用行為）：**無 provider 時不再自行產圖**。改為第 1–4 步照跑、把中介表示的表格輸出到終端，並提示安裝哪一個 provider，然後停止。不保留內建的手寫 inline SVG fallback。
- `map` 的執行流程重劃為「本職 1–4 步 → 外派第 5 步 → 驗收第 6 步」。
- 新增**中介表示**規格：節點、邊、群組、省略四張 Markdown 表。`種類`（一般／禁止）與`驗證`（已驗證／文件主張）為必填欄位，是 `map` 分析成果的載體。
- 新增 **provider 名單**（優先序）與對應 adapter：
  1. `diagram-design`（prompt-level，載入其 SKILL.md，餵表格）
  2. `artifact-diagramming`（只取 SVG 手法，不發佈）
  - 清單外但確實具備繪圖能力的 skill 亦可用，須說明選了誰、為什麼。
- 新增 **CJK 度量覆寫**：provider 的間距／字級常數是照拉丁文校準的，中文標籤同字數寬約 1.6 倍，直接沿用會造成標籤碰撞（已實測，見 design）。
- 新增**硬約束清單**，由第 6 步驗收：不上傳網路空間、完整 HTML（`doctype`／`lang="zh-Hant"`／UTF-8）、`種類=禁止` 的邊必須可見、`驗證`欄不得丟失、**固定深色主題**（只產深色版單檔，不產 light 版、不做主題切換，見 design D7）。
- **移除**：`map` 本文的「圖面規則」整段與「產出成頁面」中的完整 HTML／圖形機制／設計品質三小節，其內容分別降為硬約束或移入 adapter。「產出成頁面」開頭段的「不可用時直接照本節做、不要停下來」句與 D4 晚停矛盾，一併改寫。「短內容不必開檔」縮限為表格／清單／程式碼——**終端示意圖選項移除**，示意圖不分大小一律走 provider（見 design D8）。
- **放寬**：不再要求「離線可開」與「零 runtime dependency」。判準改為**不上傳到網路空間**。Google Fonts CDN、provider 自帶的行內 JS 皆可接受。
- **不做**：不把任何 provider vendor 進本 repo，不新增 `skills-lock.json` 記錄，不做安裝路徑偵測。provider 裝在哪裡是環境的事，`map` 只負責呼叫。

## Capabilities

本 change 不新增或修改 `openspec/specs/` 下的任何 capability，`.openspec.yaml` 已設 `skip_specs: true`。

理由：改動全部落在 `agents/skills/map/` 的 skill 內容，同步 CLI（`sync.js` 與各功能模組）零改動。本 repo 的 `openspec/specs/` 至今收錄的都是同步工具自身的行為契約（`core-sync-cli`、`cross-tool-skill-sync`、`xtool-dir-module-boundary` 等），沒有 skill 內容類的先例，也沒有可供規格掛靠的測試。`map` 的行為規則寫在 SKILL.md 本身，設計推理寫在 `design.md`。

## Impact

**改動檔案**
- `agents/skills/map/SKILL.md` — 流程重劃、移除圖面規則段、新增 provider 名單與硬約束
- `agents/skills/map/references/intermediate-tables.md`（新增）— 中介表示四張表的欄位規格
- `agents/skills/map/references/providers/diagram-design.md`（新增）— adapter，含 CJK 度量覆寫
- `agents/skills/map/references/providers/artifact-diagramming.md`（新增）— adapter

**不改動**
- `sync.js` 及所有功能模組：`agents/skills/` 底下新增子目錄由 `xtool-dir` 型既有的 `mirrorDir` 直接涵蓋，無需改 `SYNC_MANIFEST` 或任何型別邏輯。
- `README.md`：未新增／移除指令、未改變同步項目、未新增旗標，不觸發文件同步義務。
- `skills-lock.json`：provider 不由本 repo 記錄或安裝。

**環境相依（非本 repo 改動，但影響實際效果）**
- Claude Code：`artifact-diagramming` 內建，優先 1 的 `diagram-design` 已由使用者以 plugin 形式安裝（`~/.claude/plugins/cache/`）。
- Codex：兩者皆無，`map` 會停在提示。是否補裝由使用者自行決定，不進本 change 範圍。

**取捨**
- 砍掉 fallback 換取「不會靜默產出低品質圖」，代價是新環境第一次跑會被擋一次。晚停（表格照給）把這個代價壓到最低。
- 不 vendor provider 換取「不 fork 上游、repo 不長胖」，代價是各裝置需自行安裝，且兩端可能不對等。
- prompt-level 呼叫等於每次產圖都把 provider 的 SKILL.md 整份讀進 context（`diagram-design` 約 37KB，為 `map` 本文的 11 倍，另加選型後的 `type-*.md`）。已接受的取捨：摘要化 adapter 會隨上游漂移，無縮減空間。
