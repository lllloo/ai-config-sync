# Design — map 繪圖能力外派

## Context

見 `proposal.md` 的 Why。以下只列影響做法的現況與限制。

`map` 是 `xtool-dir` 型同步的跨工具 skill（`agents/skills/map/` → `~/.agents/skills/map/` 正典 + `~/.claude/skills/map` symlink 橋），Claude Code 與 Codex 都掃得到。目前 51 行，圖面規則、頁面產出規範與架構分析流程混在同一份檔案。

外部繪圖能力有兩種截然不同的形狀，這決定了插槽只能定在哪一層：

```
prompt-level（diagram-design、artifact-diagramming）
  介面 = 文字規則。載入其規範後由 agent 自己寫 HTML。

tool-level（archify）
  介面 = JSON schema + CLI。需要 bin/、renderers/、schemas/ 實際在磁碟上。
  ⇒ 在「不 vendor、只呼叫」的前提下，探測到 skill 也不保證跑得動。
```

本次實測環境：`diagram-design` 2.4.0，安裝於 `~/.claude/plugins/cache/diagram-design/diagram-design/2.4.0/`（Claude Code plugin，Codex 掃不到）。

## Goals / Non-Goals

**Goals**

- 把 `map` 不可替代的部分（讀宣告 → `rg` 驗證 → 標落差）與可替換的部分（圖面呈現）在檔案層級分開。
- 讓「換 provider」的成本降到改一份 adapter 檔或名單一列。
- 保住 `map` 的兩個招牌標記——**約束**與**驗證狀態**——在外派過程中不被靜默丟棄。

**Non-Goals**

- 不設計 provider 的安裝、版本管理或更新機制。
- 不為 tool-level provider（archify）建立呼叫契約。它可作為使用者自行安裝後的第三順位，本次不寫 adapter。
- 不追求兩端（Claude Code / Codex）能力對等。Codex 端缺 provider 時停下提示即為預期行為。

## Decisions

### D1：插槽定在「產圖」整段，而非只換視覺

**選擇**：`map` 保留第 1–4 步（定義範圍、讀宣告、驗證實作、產中介表示），第 5 步整段外派（含圖型選型、產生 HTML/SVG、視覺呈現）。

**替代方案**：只換視覺層（配色／字型／節奏），選型與產圖仍由 `map` 做。**否決**：`diagram-design` 這類 provider 把選型、佈局、產出綁在一起，硬拆會兩邊都拿不到完整規範；而 `map` 真正不可替代的價值全在第 2、3 步——兩個候選 provider 都不做「文件主張與實作的對照」（`archify` 的 Repository evidence 一節只講防幻覺，不做對照）。

### D2：中介表示用 Markdown 表格，不用 JSON schema

**選擇**：四張表——節點、邊、群組、省略。欄位固定。

```
節點  | id | label | 種類 | 分層 | 驗證 |
邊    | from | to | 關係 | 種類 | 驗證 |
群組  分層或邊界的框選
省略  沒展開的區塊、刻意不畫的東西
```

**理由**：`種類`（一般／禁止）與`驗證`（已驗證／文件主張）在兩個 provider 眼裡都不是圖元素——外派最可能的失敗模式不是「畫得醜」，是**這兩個標記蒸發**。把它們做成**固定欄位**而非修辭，翻譯過程就丟不掉。

**替代方案**：
- 散文＋清單 → **否決**：標記最容易在自然語言翻譯中蒸發。
- JSON schema → **否決**：`map` 要維護 schema，換來的可靠度增量有限；欄位固定的表格已足以擋住主要風險，且人直接看得懂（這在 D4 的晚停模式下是關鍵）。

### D3：provider 只具名、不定址

**選擇**：`map` 寫 provider 的**名字**與 adapter 要點，不寫安裝路徑、不做檔案存在性檢查、不記錄到 `skills-lock.json`。呼叫得動就用，呼叫不動就停下提示。

**替代方案**：
- 檢查 `~/.agents/skills/<provider>/SKILL.md` 是否存在 → **否決**：會讓安裝落點變成承重牆。本次實測即證實這條路會誤判——`diagram-design` 裝成 Claude Code plugin，落在 `~/.claude/plugins/cache/`，路徑檢查會回報「沒裝」而實際上可用。
- 把 provider vendor 進 `agents/skills/` → **否決**：等於 fork 上游（6.9 MB），且撞上「與 `npx skills` 共管、非 prune」的既有設計意圖，`safety-check.js` 也要新增排除項（`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 目前刻意為空）。
- 完全不具名（「找環境裡任何繪圖 skill」）→ **否決**：adapter 無從寫，選型品質不可控。折衷是名單外的 skill 亦可用，但須說明選了誰、為什麼。

### D4：無 provider 時「晚停」，不保留 builtin fallback

**選擇**：第 1–4 步照跑，中介表示的表格輸出到終端，第 5 步停下並提示裝哪個 provider。

**理由**：`map` 的職責是內容，畫圖是外派；讓外派的缺席回頭吃掉本職產出是錯的失敗模式。而 D2 選了人可讀的 Markdown 表格，正好使降級輸出本身就有價值。

**替代方案**：
- 保留 builtin（手寫 inline SVG）fallback → **否決**（使用者拍板）：有 fallback 就會靜默產出低品質圖，且圖面規則得繼續養在 `map` 本文裡，違背 D1 的切分。
- 早停（一開始就檢查，什麼都不做）→ **否決**：零產出，且要求在分析前就確定 provider 可用性，與 D3 的「呼叫得動才知道」相衝突。

### D5：CJK 度量覆寫（實測結論）

實測方式：依 `diagram-design` 2.4.0 的 Architecture 型規範（正交 `r=8` elbow、4px grid、標籤遮罩 + 6–10px 間距、legend 底部橫條、accessible SVG contract）產出本 repo 模組邊界圖，標籤全用中文，以 `google-chrome --headless` 渲染量測。

**中文顯示本身沒問題**：Geist／Instrument Serif／Geist Mono 皆無 CJK 字符，瀏覽器逐字 fallback 到系統 CJK 字型（本機為 `Noto Sans CJK TC`），標題、節點名、sublabel、legend 全部清晰。

**問題在排版預算**。同一 8px 字級下：

| 字串 | 實測寬度 |
|---|---|
| `REQUIRE` | 37 px |
| `禁止 REQUIRE` | 59 px（+60%） |

第一版嚴格照它的間距常數排，當場撞了兩處標籤重疊，須把禁止標籤整組上移 32px 才排得開。adapter 需要的覆寫：

| `diagram-design` 原規則 | CJK 覆寫 |
|---|---|
| 箭頭標籤 ≤14 字元、all-caps | 中文 ≤8 字；all-caps 對中文無意義，取消 |
| 標籤字級 8px | 12px（4px grid 的下一階） |
| eyebrow 7px | 沿用但僅限純拉丁內容 |
| 接點間距 ≥12px | ≥20px |
| 遮罩寬度依字元數估 | 依實測 bbox |

### D6：約束與驗證狀態的降級規則

adapter 契約寫死一條：**provider 若無原生表達方式，必須降級成明確可見的形式（虛線＋圖例、或圖下的文字清單），不得靜默丟棄。** 第 6 步驗收此條。

實測確認 `diagram-design` 兩者都表達得出來：

- **約束**：它有 `Secure paved road` 語意模式原生支援禁止路徑（「forbidden ingress terminating at the boundary」「用線型與停止符號，不只靠顏色」）。實測用普通 Architecture 型 + 短虛線 + `⊥` 停止符號 + 路徑終止於 zone 邊界，三條禁止邊都一眼可辨。
  - 註：`Secure paved road` 模式自帶 ≤2 forbidden paths 的預算；改用普通 Architecture 型不受該限制（總箭頭預算 12）。
- **驗證狀態**：細虛線節點框 + sublabel + legend 三件套即可，不需要 provider 原生支援。
- 先前擔心的「3 條禁止邊要吃掉 3 個 coral、撞上 ≤2 focal 上限」**不成立**：禁止邊用 ink + 停止符號即可，coral 只用於 1 個 focal 節點。

### D7：固定深色主題，不做主題切換

**選擇**（使用者拍板）：產出固定深色版、單檔。不產 light 版、不做 `prefers-color-scheme`／`data-theme` 切換。

**背景**：`diagram-design` 把 hex 硬編碼進 SVG，主題切換要嘛出兩份檔、要嘛 adapter 強加 CSS 變數覆寫（先前實測記錄）。固定深色讓這個衝突直接消失——adapter 只需指定「產 dark 版」，上游的配色機制原樣可用。

**替代方案**：
- 單檔雙主題（CSS 變數＋`prefers-color-scheme`）→ **否決**：與上游 hex 硬編碼機制正面衝突，覆寫成本高且每次上游改版都要重驗。
- light／dark 兩份檔 → **否決**：落點、連結、維護全部翻倍。
- 註：先前提案過的「SVG 顏色一律走 CSS 變數」圖面規則增補，由本條**明確否決**（其餘三條增補——正交直角、標籤留白、線不重疊——`diagram-design` 原生規範已涵蓋，由外派自然吸收）。

**已知代價**：淺色環境（列印、投影）下閱讀較差，接受。

### D8：終端示意圖一併移除

**選擇**（使用者拍板）：示意圖不分大小一律走 provider。原第 4 步「選擇輸出」的「三五個框用終端」選項刪除；「短內容不必開檔」縮限為表格、清單、程式碼。

**理由**：BREAKING 條款「無 provider 不再自行產圖」若保留終端小圖，等於留一條規模判斷的模糊地帶（幾個框以下算小？），且終端字元圖正是另一種「靜默產出低品質圖」。晚停時終端輸出的是中介表示**表格**，不是圖，兩者不衝突。

## Risks / Trade-offs

- **[兩端能力不對等]** `diagram-design` 裝成 Claude Code plugin，Codex 掃不到；Codex 端會落到「無 provider → 停下提示」。→ 緩解：這是 D4 的預期行為而非缺陷；使用者可自行在 Codex 端補裝（該 repo 有 `.codex-plugin/plugin.json`，但 Codex CLI 是否支援 plugin 安裝**未驗證**）。

- **[provider 自帶的檢查工具有缺口]** `self_check.py` 在兩次實測中都回 OK，但它只驗 accessible SVG contract、單檔安全與 motion，**抓不到標籤碰撞**。能抓幾何碰撞的 `verify-geometry.py` 沒隨 skill 打包（SKILL.md §6/§9 點名它時寫 "in this repository"，安裝版只有 3 支腳本）。→ 緩解：第 6 步交付前檢查不得依賴 provider 自帶工具，須自行驗證標籤與連接線。

- **[上游漂移]** provider 的規則由上游控制，可能改到與 `map` 硬約束衝突（例如改成多檔輸出）。→ 緩解：硬約束住在 `map`，第 6 步驗收；衝突時以 `map` 為準並在 adapter 記下。

- **[名單外 provider 的品質不可控]** 允許使用清單外的繪圖 skill 是為了不被名單擋死，代價是無 adapter 可依。→ 緩解：要求說明選了誰、為什麼，硬約束照樣驗收。

- **[新環境第一次跑會被擋]** 無 fallback 的直接代價。→ 緩解：晚停讓使用者仍拿到中介表示的表格。

- **[context 成本]** prompt-level 呼叫每次產圖都整份載入 provider 的 SKILL.md（`diagram-design` 約 37KB，`map` 本文的 11 倍），另加選型後的 `type-*.md`。→ 已接受：摘要化 adapter 會隨上游漂移，反而製造新的維護面；此成本是「不 vendor、不 fork」的直接對價。

- **[複雜度預算落差]** `map` 原規則是「超過 10 個框先畫頂層」，`diagram-design` 是 ≤9 節點／≤12 箭頭。→ 緩解：以 provider 的預算為準（較嚴），`map` 的「超過就先畫頂層」語意不變。

## Migration Plan

1. 改 `agents/skills/map/SKILL.md`（repo 端，不是本機那份）與新增 `references/`。
2. `npm test` + `openspec validate --strict` 確認未破壞既有 drift-guard（本 change 不動 `sync.js`，預期全綠）。
3. `npm run to-local` 套用到本機（整組執行，會先預覽再套用）。
4. 開新 session 讓 `map` 讀到新版（session 中途載過舊版的仍走舊規則）。
5. 以本 repo 實跑一次 `/map` 驗收。

**回滾**：`git revert` 後重跑 `npm run to-local`。無資料遷移、無狀態，回滾成本為零。

## Open Questions

- Codex CLI 是否支援 plugin 形式安裝（`diagram-design` 的 `.codex-plugin/plugin.json`）。答案只影響使用者要不要在 Codex 端補裝，不改變本設計。
- `npx skills add cathrynlavery/diagram-design` 能否正確識別其 `skills/diagram-design/` 佈局。同上，屬安裝方式的選擇，不進 `map`。
