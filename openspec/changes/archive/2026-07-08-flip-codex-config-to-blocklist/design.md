# 設計：codex config.toml section 級黑名單混合制

## Context

`config.toml` 是本 repo 同步項目裡**唯一僅存的白名單**。過濾集中在 `codex-config.js` 的 `isPortableCodexConfigKey(section, key)`：top-level 只放行 `CODEX_CONFIG_TOP_KEYS`（`personality`、`web_search`）、固定 section 只放行 `CODEX_CONFIG_SECTION_KEYS`（`tui.status_line`、`features.{memories,goals}`、`memories.*`）、`plugins.*` 只放行 `enabled`。其餘一律不進 repo——這是 safe-by-construction 的 fail-safe。

`flip-settings-sync-to-blocklist`（archive）已把 settings.json 翻黑名單並立下 **D6 慣例**：

| 設定區塊性質 | 過濾方向 |
|---|---|
| 結構性官方欄位（key 名為官方定義的有限集合） | 黑名單（預設同步、列舉排除） |
| 開放 key 空間（key 名使用者任意定義、可含機密） | 白名單（預設不同步、列舉放行） |

該 change 的 Open Question 明文把 codex 翻轉留待「累積經驗後另開 change」。本設計即該後續。

**現行 settings.json 當前模型**（非 flip 當時、是後續 change 收斂後的狀態）：黑名單（`DEVICE_SETTINGS_KEYS`）剝除 + `safety:check` 審核（`hooks`/credential helper → hard block、敏感命名 key → warning）。**pattern 已不參與同步自動剝除**。本設計對齊此當前模型，故 config.toml 亦**不**引入 pattern 自動剝除。

**實測資料**（本機 `~/.codex/config.toml`，佐證分類）：top-level 僅 `personality`/`web_search`；`[tui.model_availability_nux]`（裝置 NUX 狀態）與 `[projects."/home/barney/code/..."]`（信任清單，**絕對路徑內嵌在 section 名**）為實際存在、白名單正確排除的裝置內容。

## Goals / Non-Goals

**Goals:**

- config.toml 由白名單改 section 級黑名單，統一為「預設同步 + 排除清單 + hard-block 兜底」單一心智模型
- 消除白名單維護黏性（Codex 新增可攜欄位不再需手動列舉）與 `warnUnclassifiedCodexConfig` 補丁機制
- 在**不製造 fail-open** 前提下完成：機密整段排除、開放/未知 schema 層以精確 carve-out 守住
- safety:check 對 config.toml 機密 section 升 hard block，達成與 settings.json 對等的雙層防線

**Non-Goals:**

- **不翻 top-level 語義**——維持 `personality`/`web_search` 窄允許清單（缺 Codex 權威 schema，見 D3/Open Question）
- **不放寬 `plugins.*`**——維持 `enabled`-only（開放 key 空間，見 D2）
- 不引入 pattern 自動剝除（對齊 settings.json 當前模型，pattern 僅供 safety:check review）
- 不引入設定檔加密、外部 secret manager（維持零相依）

## Decisions

### D1：Section 級黑名單，`CODEX_CONFIG_DEVICE_SECTION_PREFIXES` 升格權威

**選擇**：翻轉的過濾單位是 **section**，不是 (section, key)。排除清單為現有常數升格：

```js
// 從「僅供未分類提示降噪」升格為「權威排除清單」
const CODEX_CONFIG_DEVICE_SECTION_PREFIXES = [
  'model_providers',          // api_key 明文 — SECRET
  'mcp_servers',              // 憑證 — SECRET
  'projects',                 // 信任清單，絕對路徑內嵌 section 名 — DEVICE/PATH（實測）
  'profiles',                 // 裝置 profile — DEVICE
  'history',                  // 裝置狀態 — DEVICE
  'shell_environment_policy', // env 透傳 — DEVICE/SECRET
  'tui.model_availability_nux', // 裝置 NUX 狀態 — DEVICE（實測，[tui] 子表）
];
```

排除語義：section 名等於清單項或以 `<項>.` 為前綴者，整段（含所有 key）不同步。

**理由**：機密與裝置內容的邊界**落在 section 層、不落在個別 key**——`model_providers` 整段都是 provider 設定、`projects` 整段都是本機路徑。整段排除即 safe-by-construction，與白名單同等安全，且 section 邊界粗、跨 Codex 版本穩定，維護成本低。此清單原已為「未分類提示降噪」列出，內容已驗證，升格零新增判斷。

**替代方案**：(a) (section,key) 級黑名單——被否決，會退化回白名單的精度負擔，違背去黏性目標；(b) 全 section 無差別同步——被否決，machine 機密會流進 repo。

### D2：carve-out — `plugins.*` 維持 `enabled`-only

**選擇**：`plugins.*` 不走「整段同步」，維持只放行 `enabled` key。

**理由**：plugin 名是**半開放集合**（使用者裝什麼 plugin 就有什麼 section），且 plugin 可能在自己 section 內存 API token 或本機路徑——屬 D6 定義的「開放 key 空間」，依慣例必白名單。整段同步會讓 plugin 私有機密 fail-open 進 repo。維持 `enabled`-only 是「排除模型裡的精確 carve-out」，**非破壞一致性**——settings.json 自己也有 `hooks` 這類硬編碼特例。

**取捨**：plugin 若有其他合法可攜設定（非 `enabled`）不會同步——可接受，`enabled`（啟用與否）是唯一已知的跨裝置可攜面；日後若有具體需求再逐 key 放行。

### D3：carve-out — top-level 維持 `personality`/`web_search` 窄允許清單

**選擇**：top-level **不**翻黑名單，維持只放行 `CODEX_CONFIG_TOP_KEYS = ['personality', 'web_search']`。

**理由**：白名單在此層編碼了一個**精確事實**——「可攜 top-level 就這 2 個」。翻黑名單 = 反過來宣稱「除裝置黑名單外全同步」，但：
- Codex top-level 尚有 `model`、`approval_policy`、`sandbox_mode`、`cwd` 等裝置/行為 key，**且隨版本增生**；
- 本專案**無 Codex config 的權威 top-level schema**，無法安全反列裝置 key 全集，漏列一個即 fail-open（裝置偏好跨裝置互踩）。

白名單在此**反而更精確、更安全**。維持它是刻意的 interim，不是遺漏。此決策與 settings.json 把 codex 列為 Open Question「不半吊子翻轉」的精神一致。

**取捨**：top-level 這一層仍是白名單語義，與整體黑名單心智模型不完全一致——以「精確 carve-out」框定並在文件寫明理由；Codex 新增的可攜 top-level key 仍需手動列入（黏性殘留於此層），是拿一致性換安全的明文選擇。

### D4：第 2 層 — safety:check 對機密 section 升 hard block

**選擇**：`safety-check.js` 對 repo `config.toml` 出現 `model_providers.*`／`mcp_servers.*`（及其他機密 section）從 warning 升為 **hard block**（exit 2），比照 `SETTINGS_HARD_BLOCK_KEYS` 對 settings.json `hooks`/credential helper 的待遇。

**理由**：D1 的 section 黑名單已在**同步層**確保機密 section 不進 repo；D4 是**獨立第二層**——防手動編輯 repo config.toml、或黑名單清單有漏的情形。settings.json 的雙層（DEVICE_SETTINGS_KEYS 剝除 + safety:check hard-block hooks）正是此結構，config.toml 對齊後才算真正一致。safety:check 已在掃 config.toml（`scanTomlKeyWarnings`），只需對機密 section 升級嚴重度。

**注意**：升 hard block 的是**明確機密 section**（provider/mcp 憑證載體），非所有敏感命名 key；後者維持 warning，與 settings.json 一致。

### D5：移除 `warnUnclassifiedCodexConfig` 未分類提示

**選擇**：移除 `collectUnclassifiedCodexKeys`／`isKnownDeviceCodexSection`／`warnUnclassifiedCodexConfig` 及其在 diff/status/to-repo 的呼叫。

**理由**：此機制的存在前提是白名單——「有欄位既非白名單、也非已知 device，可能是該納入白名單的新可攜欄位」。黑名單制下語義反轉：未分類欄位**預設就同步**，不需提示納入。新同步的 section／key 改由**一般 value-diff** 自然顯示（黑名單制的日常訊號，對稱於 settings.json 的 D4 可見性）。

### D6：repo 來源檔重新收斂

**選擇**：實作完成後以新規則對本機 config.toml 跑一次 to-repo（先 `--dry-run`），逐一人工確認新進 repo 的 section／key 皆非機密、非裝置特定。

**理由**：diff 語義依賴「repo 檔已是收斂版」。翻轉後舊 repo 檔內容仍合法（白名單 ⊂ 新可攜集合），但本機保留 section（tui/features/memories）內若有白名單時代未收的 key，會首次進 repo，需人工把關。實測本機這些 section 目前無額外 key，預期收斂結果與現狀相近。

## Risks / Trade-offs

- **[保留 section 新 key 互踩]** Codex 未來在 tui/features/memories 新增「裝置型且非機密」的 key 會先跨裝置互踩，直到人工加入排除 → 緩解：value-diff 讓新 key 首次出現即可見；此為黑名單制明文承擔的固有成本。top-level/plugins 因維持允許清單不承擔此風險。
- **[section 黑名單漏列新機密 section]** Codex 若新增一個機密載體 section 而未及時列入黑名單 → 會流進 repo → 緩解：D4 的 safety:check hard-block 對已知機密 section 兜底；但**全新命名的機密 section**（非 model_providers/mcp_servers 家族）確實可能漏網，機率低但非零，與 settings.json 黑名單同級的殘留風險。
- **[top-level 一致性殘缺]** top-level 維持白名單，心智模型未完全統一 → 緩解：以精確 carve-out 框定、文件寫明；此為刻意拿一致性換安全（缺權威 schema）。
- **[carve-out 判斷漂移]** plugins/top-level 的允許清單與 section 黑名單分屬兩套判斷，可能實作漂移 → 緩解：集中在 `isPortableCodexConfigKey` 單一 predicate 內以清楚分支表達（section 黑名單 → 排除；plugins → enabled-only；top-level → 允許清單），單元測試覆蓋三分支。
- **[repo 收斂引入非預期內容]** 首次 to-repo 可能帶入保留 section 的本機專屬 key → 緩解：D6 先 dry-run 人工確認。

## Migration Plan

1. `codex-config.js` 過濾反轉（D1–D3、D5）→ `test/codex-config.test.js` 反轉並通過
2. `safety-check.js` config.toml 機密 section hard-block（D4）→ `boundary.test.js` 新增案例
3. 以新規則收斂 repo `codex/config.toml`（D6，人工確認新進內容）
4. 文件改寫（CLAUDE.md、README）
5. 回滾策略：單一 commit 可 revert；repo config.toml 收斂版與程式碼同 commit，revert 後白名單語義即恢復

## Open Questions

- **top-level 何時翻黑名單？** 前置條件：對 Codex 原始碼／docs 抓出 top-level 裝置 key 全集（`model`/`approval_policy`/`sandbox_mode`/… 與可攜偏好的完整切分）。抓到後另開 change 把 `CODEX_CONFIG_TOP_KEYS` 白名單改為 top-level 裝置 key 黑名單，屆時 config.toml 才完全對齊 settings.json。本 change 刻意不做半吊子翻轉。
- **`plugins.*` 是否需放行 `enabled` 以外的 key？** 目前無具體可攜需求；若日後 Codex plugin 有跨裝置可攜的非機密設定，以逐 key 放行處理，不整段翻。
