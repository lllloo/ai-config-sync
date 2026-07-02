# 設計：settings.json top-level 黑名單混合制

## Context

現行 `settings.json` 同步為三層白名單之一（top-level `PORTABLE_SETTINGS_KEYS`、env 巢狀 `PORTABLE_ENV_KEYS`、codex `CODEX_CONFIG_*`）。可攜性判斷集中在兩個互補函式（`sync.js`）：

- `loadStrippedSettings()`（to-repo 方向）：只保留白名單 key，其餘進 `dropped`
- `extractDeviceValues()`（to-local 方向）：保留所有非白名單 key 的本機值

`dropped` 清單目前僅 `--verbose` 顯示。經探索（見對話與業界調查）：VS Code Settings Sync 的「黑名單」建立在機密架構隔離（OS keychain）與官方 scope metadata 之上，Claude Code `settings.json` 兩者皆無；但 top-level 官方欄位本身非機密（最高風險為 helper 路徑與裝置偏好），與 `env` 開放 key 空間（可含明文金鑰）的風險等級截然不同——這是混合制的依據。

## Goals / Non-Goals

**Goals:**

- top-level 官方欄位「預設同步、列舉排除」，消除每個官方新欄位都要手動白名單追加的維護成本
- 敏感命名 pattern 護欄，未來憑證類欄位自動排除
- 被排除欄位在 diff 預設可見（黑名單制的日常防守訊號）
- 過濾慣例一般化，為 opencode／pi 接入立規範

**Non-Goals:**

- 不動 `env` 巢狀白名單（`PORTABLE_ENV_KEYS`）——開放 key 空間維持白名單是安全底線
- 不實作 opencode／pi 同步（僅記錄慣例）
- 不在本次翻轉 codex `config.toml`（列 open question，另行決策）
- 不引入設定檔加密、外部 secret manager 等新機制（維持零相依）

## Decisions

### D1：混合制切分——top-level 黑名單、env 白名單

**選擇**：top-level 改黑名單 `DEVICE_SETTINGS_KEYS`；`env` 維持 `PORTABLE_ENV_KEYS` 白名單，`stripNonPortableEnv` 零改動。

**理由**：風險不對稱。top-level key 名是官方定義的有限集合，值最糟是指令路徑／裝置偏好（中低風險、可恢復）；env key 名是使用者任意定義的開放集合，值可能是明文 API key（進 git history 即永久、需改寫歷史）。黑名單在開放集合上無法枚舉機密名稱——這正是 VS Code 把機密整個移出 settings.json 的原因。

**替代方案**：(a) 全面黑名單——被否決，env 層做不到；(b) 維持全白名單 + diff 提示——維護成本仍在，與使用者「盡量都搬」的目標不符。

### D2：單一 partition 函式，保證 top-level 雙向互補

**選擇**：新增 `partitionSettingsTopLevel(data)` → `{ portable, device }`，一次分區產出兩桶；`loadStrippedSettings`（取 `portable`，`device` 的 key 名即 `dropped`）與 `extractDeviceValues`（取 `device`）皆消費同一次分區結果。

**理由**：現行兩函式各自寫 `PORTABLE_SETTINGS_KEYS.includes(key)` 的正反面。翻轉後判斷變成兩段式（名單 + pattern），若兩處各自實作必然漂移。partition 比「共用 predicate 各自呼叫取正反」更強——互補由**同一次計算**保證，不存在「否定式寫錯」的空間；diff 的 dropped 清單也強制與實際 strip 同源（agent 審查採納）。

**範圍限縮**（agent 審查採納）：此互補保證僅涵蓋 **top-level**。`env` 子鍵的 strip（`stripNonPortableEnv`）與 preserve（`extractDeviceValues` 的 env 迴圈）是另一對獨立互補實作，不受 partition 保護——本次不動它，但文件與註解不得宣稱「單一機制罩住全部」。

### D3：黑名單初始內容與 pattern 雙保險

**選擇**：

```js
const DEVICE_SETTINGS_KEYS = [
  // 裝置偏好
  'model', 'effortLevel', 'defaultShell', 'tui', 'autoUpdatesChannel',
  // 平台綁定（command 為 shell 方言，跨 Win/mac 必壞）
  'hooks',
  // 憑證 helper（同時被 pattern 涵蓋，列舉為雙保險）
  'apiKeyHelper', 'awsCredentialExport', 'awsAuthRefresh', 'otelHeadersHelper',
];
const SENSITIVE_KEY_PATTERN = /(key|token|secret|credential|password|auth|cert|cookie|session|jwt|helper|refresh)/i;
```

pattern 詞彙依安全審查擴充（原六詞補 `password`、`auth`、`cert`、`cookie`、`session`、`jwt`——`sessionAuth`、`oauthConfig`、`clientCert` 類官方潛在欄位原本全數漏網）。已驗證現行全部可攜欄位（`env`、`permissions`、`statusLine`、`enabledPlugins`、`extraKnownMarketplaces`、`language`、`spinnerTipsEnabled`、`theme`、`skipDangerousModePermissionPrompt`、`skipAutoPermissionPrompt`）皆不命中擴充後 pattern，翻轉後仍可攜（需回歸測試固定此斷言）。

**理由**：憑證四欄位雖全數命中 pattern，仍明列——pattern 是護欄不是規格，日後若有人「精修」pattern 不致於讓已知憑證欄位漏網。`hooks` 排除是功能正確性問題（PowerShell vs zsh），非安全問題，pattern 不涵蓋、必須明列。

**注意**：pattern 會誤傷未來合法欄位（如假想的 `keyboardLayout` 命中 `key`）。誤傷方向是「該同步的沒同步」＝白名單時代的失敗模式（沉默但無害），由 D4 的可見性補救；放寬 pattern 的誤放方向才是不可接受的。故 pattern 寧緊勿鬆。

### D4：dropped keys 從 `--verbose` 提升為 diff 預設輸出

**選擇**：`npm run diff`（及 `status`）預設列出被排除的 top-level key 名（一行摘要，只列 key 名、不印值）；`--verbose` 維持現有較詳細輸出。

**理由**：黑名單制下，「某欄位該排除而未排除」與「pattern 誤傷了合法欄位」都只能靠人看見才會被修正；藏在 `--verbose` 後等於沒有日常訊號。只列 key 名不印值，維持「diff 不得出現敏感值」不變式。

**訊號分工釐清**（agent 審查採納）：黑名單制的兩種失敗由**不同訊號**偵測——(a) 「裝置型新欄位被自動納入而互踩」靠**一般 value-diff**（新欄位出現在 repo diff 內容中）；(b) 「pattern 誤傷合法欄位／該排除而未排除」靠 **dropped 清單**。維護者不能以為只盯 dropped 清單就能發現互踩，文件需明寫。

### D5：repo 來源檔重新收斂 + 不變式改寫

**選擇**：實作完成後以新規則對本機 settings.json 跑一次 to-repo，逐一人工確認新進 repo 的欄位；CLAUDE.md「repo settings.json 永遠為白名單收斂版」不變式改寫為「永遠為黑名單＋pattern 收斂版」。

**理由**：diff 語義依賴「repo 檔已是收斂版」；策略翻轉後舊 repo 檔內容仍合法（白名單 ⊂ 新可攜集合），但本機會有新欄位待進 repo，首次收斂需人工把關。

### D6：跨工具過濾慣例（opencode／pi 擴充規範）

**選擇**：立為 repo 慣例並寫入 CLAUDE.md——

| 設定區塊性質 | 過濾方向 | 範例 |
|---|---|---|
| 結構性官方欄位（key 名為工具官方定義的有限集合） | 黑名單（預設同步、列舉排除裝置／平台／憑證欄位） | claude settings top-level |
| 開放 key 空間（key 名使用者任意定義、可含機密） | 白名單（預設不同步、列舉放行） | claude `env`；opencode provider/API key 區塊；pi 的 provider 金鑰欄位 |

**理由**：opencode 的設定（`opencode.json`）含 provider `apiKey` 類欄位、pi 設定含 provider 金鑰——兩者都同時存在「結構欄位」與「機密載體區塊」，與 claude settings 同構。慣例先立，接入時只需按性質歸類，不必每次重新辯論過濾方向。新工具接入時的判準：**該區塊的 key 名集合是誰定義的**——官方有限集合可黑名單；使用者開放集合必白名單。

**Spec 佈局配套**：本專案涵蓋 claude code／codex／opencode／pi 四種工具，capability 採**一工具一 capability**切分，避免混寫：既有 `settings-sync` 改名 `claude-settings-sync`（隨本 change 執行），日後各立 `codex-config-sync`、`opencode-config-sync`、`pi-config-sync`。跨工具引擎級不變式（不得洩漏敏感值、atomic write、exit code 語義）若日後要 spec 化，另立 `sync-engine` capability，不塞進任一工具的 spec。

### D7：值層 fail-loud 防線（defense in depth，安全審查採納）

**選擇**：新增 `assertPortableSettingsSafe(clean)`，在 `loadStrippedSettings` 收斂完成後、回傳前執行，遞迴掃描整個可攜結果：

- **巢狀 key 名**命中 `SENSITIVE_KEY_PATTERN` → 拋 `SyncError` 中止（`env` 子樹跳過 key 掃描——它有自己的白名單權威，但其值仍受值掃描）
- **字串值**命中機密樣式（`sk-…`、`ghp_…`、`github_pat_…`、`AKIA…`、`xox?-…`、`eyJ…` JWT 等已知前綴）或**絕對家目錄路徑**（`C:\Users\…`、`/Users/…`、`/home/…`）→ 拋 `SyncError` 中止

錯誤訊息指出命中的欄位路徑（**不顯示值本身**），並提示兩條出路：改寫該值（如絕對路徑改 `~/`）或把該 top-level key 加入 `DEVICE_SETTINGS_KEYS`。

**理由**：黑名單只查 top-level key 名、巢狀內容整包放行，是安全審查指出的最大結構缺口（未來官方若新增 `integrations`／`mcpServers` 類物件欄位，內層 `apiToken` 完全不被攔截）。選 **fail-loud 而非靜默剝除**：靜默剝除會讓 repo 拿到殘缺物件、to-local 合併行為難以推理，且問題永遠不會被人看見；中止則把「該加黑名單的欄位」逼到人眼前，一次修正終身受益。此防線同時涵蓋 diff 路徑（`loadStrippedSettings` 是 diff 與 to-repo 的共同入口），確保機密樣式值連 diff 輸出都到不了。已驗證現行 repo 收斂版內容（`statusLine.command` 用 `~/`、permissions 規則無絕對路徑）不會誤觸。

**取捨**：合法內容若長得像機密（或 permissions 規則裡真的要寫絕對路徑）會被擋——這是刻意的：該情境正是「完整使用者路徑不得進 repo」不變式要攔的東西，使用者需改寫為可攜形式。

## Risks / Trade-offs

- **[裝置型新欄位互踩]** 官方新增「裝置型且命名不含敏感字」的欄位（如假想的 `windowPosition`）會先同步、跨裝置互相覆寫，直到人工加入黑名單 → 緩解：D4 讓新欄位首次出現即在 diff 可見；此為黑名單制明文承擔的固有成本（proposal 已列）。
- **[命名不含敏感字的機密欄位漏網]** 機率低（官方憑證欄位命名一向命中 pattern），但非零 → 緩解：pattern + 黑名單雙層、D4 可見性；`env` 這條災難級向量本就不受影響。
- **[pattern 誤傷合法欄位]** 如未來 `keyboardLayout` 被 `key` 誤中 → 緩解：誤傷方向沉默且無害（等同白名單時代行為），D4 可見後把該欄位加入「pattern 豁免」不在本次範圍——若實際發生，屆時以精確字串豁免清單處理，不放寬 pattern。
- **[strip／preserve 不互補的回歸]** 翻轉觸及同步心臟 `mergeSettingsBetween` 雙向 → 緩解：D2 單一 predicate + `settings.test.js` 互補性測試（同一 key 集合經 to-repo strip 與 to-local preserve 後無遺失、無雙寫）＋既有沙箱整合測試全數通過。
- **[D7 誤擋合法內容]** 使用者設定值恰好長得像機密前綴或含絕對路徑（如 permissions 規則指向絕對目錄）→ 同步中止 → 緩解：錯誤訊息明確指出欄位路徑與兩條出路（改寫值／加黑名單）；此誤擋方向與不變式一致（絕對路徑本就不該進 repo）。
- **[心智模型漂移]** 文件若仍殘留「白名單」措辭，未來維護者會按舊模型加欄位 → 緩解：CLAUDE.md、README、sync.js 註解全面改寫，D6 慣例表落地。

## Migration Plan

1. `sync.js` 常數與 predicate 翻轉（D2、D3）→ 單元測試反轉並通過
2. diff 輸出 dropped keys 預設化（D4）
3. 以新規則收斂 repo `claude/settings.json`（D5，人工確認新進欄位）
4. 文件改寫（CLAUDE.md、README）
5. 回滾策略：單一 commit 可 revert；repo settings.json 收斂版與程式碼同 commit，revert 後白名單語義即恢復

## Open Questions

- **codex `config.toml` 是否跟進翻轉？** 按 D6 判準，codex config top-level 屬官方有限集合、理論上可黑名單；但 codex 欄位擴張速度與敏感欄位命名慣例尚未盤點，且現行 `CODEX_CONFIG_SECTION_KEYS` 是兩層結構（section 內再挑 key），翻轉改動面較大。傾向：本次不動，累積 claude 端黑名單運行經驗後另開 change 決策。
- **pi 的設定檔結構尚未盤點**（`~/.pi/` 下哪些檔、哪些區塊屬開放 key 空間）——接入前需先做一次結構調查，按 D6 歸類。opencode 同（`opencode.json` 的 provider 區塊已知含金鑰，其餘 top-level 待盤點）。
