## Context

`skills.js` 的 `runSkillsAdd`／`runSkillsRemove` 是本 repo **唯一會修改版控 manifest（`skills-lock.json`）的寫入路徑**。其變更語義——引數解析兩形態、add 無覆寫冪等、lock 初始化與結構正規化、remove 冪等與缺檔前置、atomic write——目前只在程式碼與 CLAUDE.md，OpenSpec 未捕捉。

現有覆蓋分工：`skills-lock-diff` 規範唯讀比對（`skills:diff`）與終端注入驗證（`validateSkillName`／`validateSkillSource`／`sanitizeForTerminal`）；`core-sync-cli` 規範指令分派；`skills-module-boundary` 規範邏輯位置與 runtime 檔清單。三者都不規範「寫入 lock 檔的契約」，形成缺口。此 change 延續 `document-core-sync-engine`／`document-toml-reader-contract` 的 backfill 慣例，以 `skills.js` 為 single source of truth，**不改程式碼**。

## Goals / Non-Goals

**Goals:**
- 規格化 `skills:add`／`skills:remove` 的變更語義，成為與 `skills-lock-diff` 互補（一寫一讀）的被依賴規格。
- 忠實反映實作：無覆寫冪等、remove no-op、缺檔報錯、結構正規化、atomic write、**不重新排序**。

**Non-Goals:**
- 不改 `skills.js`、`sync.js` 或任何測試。
- 不重述終端注入驗證（已歸 `skills-lock-diff`），只指涉為前置。
- 不改變任何指令行為（如不新增「強制覆寫」旗標——若日後要，另開 change）。
- 不涉及 `skills:diff` 的比對邏輯（已有 spec）。

## Decisions

**決策 1：新增獨立 capability `skills-lock-mutation`，不併入 `skills-lock-diff`。**
- 理由：`skills-lock-diff` 的 folder 名與 Purpose 都聚焦「唯讀比對」；把寫入語義塞進去會擴張其範疇並使命名失真。獨立 capability 讓「讀」與「寫」兩份 spec 各自內聚、共享同一 lock 檔契約。
- 替代：MODIFIED `skills-lock-diff` 折入 add/remove。否決——範疇混淆、folder 名誤導。

**決策 2：注入驗證指涉而不重述。**
- 理由：`validateSkillName`／`validateSkillSource` 的注入安全需求已由 `skills-lock-diff` 規範。若在本 spec 再寫成獨立 SHALL，archive／merge 後兩份 spec 對同一需求各執一詞，易漂移。故本 spec 只在 `parseSkillSource` 需求與 scenario 標明「驗證通過後才採用」，規範本體留在 `skills-lock-diff`。
- 替代：本 spec 自包含地重述驗證。否決——製造重複需求。

**決策 3：明確規格化「不重新排序 key」。**
- 理由：實作 `writeJsonSafe` 直接序列化 `skills` 物件，不排序；key 沿用插入順序。若 spec 沉默，讀者可能誤以為有排序保證而在日後「修正」成排序、造成非預期 diff。以 SHALL NOT 釘死現況。

## Risks / Trade-offs

- **[與 skills-lock-diff 邊界模糊]** → 以「寫 vs 讀」清楚切分：本 spec 只管改動 lock 檔的語義，注入驗證與比對輸出留在 `skills-lock-diff`。design 與 proposal 均明列此邊界。
- **[過度規格化實作細節]** → 只固定對外可觀察契約（冪等結果、exit code、錯誤碼、檔案結構），不規範內部演算法；`skills.js` 為 single source of truth。
- **[規格與實作漂移]** → 不改碼，spec 忠實描述現況；`test/skills.test.js` 已覆蓋 `parseSkillSource`／驗證等，作為可執行對照，日後改碼時 spec 與測試一併檢視。

## Migration Plan

1. 建立 proposal／specs／design／tasks（本 change）。
2. `openspec validate` 通過後，依 tasks 核對 spec 與 `skills.js`／`test/skills.test.js` 一致。
3. 執行 `/opsx:apply`：本 change 無程式碼變更，apply 主要為核對與 `openspec archive`。
4. archive 時 `skills-lock-mutation` spec 落入 `openspec/specs/`，Purpose 改寫為正式描述。
- 回滾：純文件與規格，移除 change 目錄即可。

## Open Questions

- 無。行為已由現有測試與程式碼釘死，規格為忠實回填。
