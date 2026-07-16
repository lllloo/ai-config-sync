## Context

`sync.js`（約 2360 行）已實作完整的核心同步引擎：CLI 分派、`diff`／`status`／`to-repo`／`to-local` 雙向流程、以及一組跨模組共用的寫入安全不變式（atomic write、統一錯誤處理、path 遮罩）。`skills.js` 實作 `skills:diff` 的 lock 比對。這些邏輯有完整的 inline 註解與測試覆蓋（`sync.test.js`／`apply-integration.test.js`／`boundary.test.js`／`skills.test.js`），且 `CLAUDE.md` 已詳述其不變式——**唯獨沒有 OpenSpec 規格**。

現有 7 份 spec 都是「周邊」能力（settings 黑名單、跨工具 skill、宣告式 manifest、opencode、safety-check、兩份模組邊界）。它們全都預設核心引擎的行為成立，卻沒有任何規格明文定義該行為。本 change 是**規格回填（spec backfill）**，非功能開發。

## Goals / Non-Goals

**Goals:**
- 把已存在於程式碼與 `CLAUDE.md` 的核心不變式，提升為可測試的 OpenSpec requirement。
- 四份新 spec 對齊現況：`core-sync-cli`、`bidirectional-sync-workflow`、`sync-write-safety`、`skills-lock-diff`。
- 每條 requirement 皆可對應到既有測試或可新增測試驗證，成為日後重構的回歸護欄。

**Non-Goals:**
- 不改任何執行期行為、不新增／移除指令、旗標或同步項目。
- 不新增測試（既有測試已覆蓋；本 change 只要求規格與測試不矛盾）。
- 不涵蓋已有 spec 的能力（settings／manifest／opencode／safety／模組邊界不重述）。
- 不觸及 `safety-check.js`／`toml-reader.js` 的掃描細節（已由 `safety-check` 系列 spec 承載）。

## Decisions

**決策 1：拆成四份 spec，而非一份大 spec。**
以「使用者可觀察的行為面」切分——CLI 契約、同步流程、寫入安全、skills 比對。理由：四面各有獨立的 scenario 群與測試檔對應，合成一份會讓 requirement 過長且難對應測試。替代方案（單一 `core-sync-engine` spec）被否決，因為 skills-lock-diff 與 settings／manifest 的關係更近，混入核心 spec 會模糊邊界。

**決策 2：全部用 `ADDED Requirements`，Modified Capabilities 留空。**
本 change 不改任何既有 spec 的 requirement，只新增四個此前無 spec 的能力。理由：現有 7 份 spec 沒有任何一條描述核心 CLI／流程／寫入安全，故無「修改」對象。

**決策 3：requirement 敘述綁定現況、不綁實作行號。**
scenario 以「WHEN 使用者做 X → THEN 系統 SHALL Y」描述可觀察行為（exit code、是否寫入、是否提示），不寫「呼叫哪個函式第幾行」。理由：spec 要在重構下存活；函式名僅在 requirement 描述段作為定位參考（如 `writeFileSafe`、`assertNoSwallowedNpmFlags`），scenario 本身只斷言行為。

**決策 4：安全相關不變式優先入規格。**
旗標白名單拒絕 typo、npm flag fail-fast、非互動環境拒絕 hang、dry-run 絕不寫入、atomic write 的 `O_EXCL`、部分失敗可見度、path 遮罩——這些是「錯了會靜默造成資料寫入或洩漏」的路徑，最需要規格護欄，故逐條列為 requirement 而非合併帶過。

## Risks / Trade-offs

- **[規格與程式碼漂移]** → 回填後若日後改行為卻沒更新 spec，spec 會過期。緩解：每條 scenario 都對應既有測試（`sync.test.js` 的 parseArgs／exit code、`apply-integration.test.js` 的 dry-run／preview-confirm、`boundary.test.js` 的訊號與非互動、`skills.test.js` 的三向差），測試紅燈即提示需同步 spec。
- **[過度規格化]** → 把實作細節寫進 spec 會綁死重構。緩解：見決策 3，scenario 只斷言可觀察行為，函式名僅作定位。
- **[邊界重疊]** → `sync-write-safety` 的錯誤處理與 `safety-check` spec 可能被誤讀為重疊。緩解：本 spec 只涵蓋「寫入與錯誤輸出的安全」，`safety-check` 涵蓋「commit 前的機密掃描」，兩者關注點不同，proposal 的 Non-Goals 已界定。

## Migration Plan

無程式碼遷移。流程：（1）`openspec validate` 通過四份 spec；（2）人工複核每條 scenario 與 `sync.js`／`skills.js` 現況一致；（3）`npm test` 綠燈確認未意外改動；（4）archive 時四份 spec 併入 `openspec/specs/`。回滾：純文件，移除 change 目錄即可，無執行期影響。

## Open Questions

- skills-lock-diff 是否應與既有 `skills-module-boundary` spec 合併？暫維持獨立：module-boundary 談「邏輯位於獨立模組」，本 spec 談「比對行為」，關注點不同。archive 後若發現重複可再議。
