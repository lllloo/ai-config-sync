## Context

`settings.json` 現有兩套過濾：top-level 走黑名單混合制（`DEVICE_SETTINGS_KEYS` + `SENSITIVE_KEY_PATTERN`），`env` 走純白名單（`PORTABLE_ENV_KEYS`）。方向差異的原始判準（見 CLAUDE.md）是「該區塊 key 名集合是誰定義的」：top-level 是官方有限集合 → 黑名單可枚舉壞的；env 是使用者開放空間且值即機密 → 白名單「不在名單就不同步、無漏網格」。

本 change 明知此判準，仍依使用者決策將 env 翻為黑名單以消除「新增合法 key 的摩擦」。多視角審查（安全／完整性／spec 一致性）推翻了初版兩項假設，本 design 據此修正：

1. **初版宣稱的「補償控制：值層防線納入 env key 掃描」是死碼。** `loadStrippedSettings` 的順序是 strip 先於 assert（`sync.js:1238` → `1241`），而黑名單版 strip 已用 `SENSITIVE_KEY_PATTERN` 刪掉命中的 env key；等 assert 跑到，env 已無命中 key 可掃。故**不動 `skipKeyScan`**，並移除此補償敘述。
2. **真正的洩漏在 diff 而非只有 to-repo。** `printDetailedDiff`（`sync.js:2268`）非 verbose-gated，會把 settings 明細 diff（含 env 值）印到 stdout。白名單制下 env 只含安全 key、無害；黑名單制下同一路徑會印未過濾機密。此為本 change 必須新增的補強。

## Goals / Non-Goals

**Goals**
- env 新增合法可攜 key 時，零 code／零文件改動即自動同步。
- 純讀取的 `diff`／`status` 不外洩 env 值。
- 誠實記錄殘餘風險與實際存在（非虛構）的控制。

**Non-Goals**
- 不宣稱黑名單提供與白名單等同的機密防護。
- 不引入「本機有 API key 就中止 to-repo」的 fail-loud（會癱瘓日常同步）。
- 不動 `skipKeyScan`、不重寫 top-level 過濾。

## Decision 1：env 白名單 → 黑名單混合制（靜默剝除）

```
  env key 是否同步（黑名單混合制）：
    命中 DEVICE_ENV_KEYS（新常數）  → 剝除（靜默）
    命中 SENSITIVE_KEY_PATTERN      → 剝除（靜默）
    以上皆否                        → 同步進 repo
  （值層防線的 env 值掃描 SECRET_VALUE_PATTERN 恆常適用，不受本決策影響）
```

- 移除 `PORTABLE_ENV_KEYS`（含 `sync.js:3120` export）；新增 `DEVICE_ENV_KEYS`。
- `stripNonPortableEnv` 判斷反轉：`if (!PORTABLE_ENV_KEYS.includes(key)) delete` → `if (DEVICE_ENV_KEYS.includes(key) || SENSITIVE_KEY_PATTERN.test(key)) delete`。函式改名（如 `stripDeviceEnv`）並更新呼叫點。
- `extractDeviceValues` env 迴圈同步反轉，維持 strip↔preserve 互補。
- 命中者**靜默剝除、to-repo 成功**，沿用現行白名單制 UX；不引入 fail-loud（避免「本機既有 `ANTHROPIC_API_KEY` 導致每次 to-repo 中止」的迴歸）。
- **`skipKeyScan` 不動**：env 子樹續跳過 key 名掃描（strip 已處理 key 名，值層再掃 key 名是與 strip 重複的死碼）；env **值**掃描維持恆常適用。

### `DEVICE_ENV_KEYS` 初始清單（策展）

| key | 為何須明列（pattern 抓不到） |
|---|---|
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | 平台綁定、名字不含敏感字 |
| `ANTHROPIC_CUSTOM_HEADERS` | 值常為 `Authorization: Bearer …`，名字不含敏感字 |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` | 值常內嵌 `user:pass@host` 憑證，名字不含敏感字 |

**大小寫**：proxy 慣例大小寫皆有（`http_proxy` vs `HTTP_PROXY`）。`DEVICE_ENV_KEYS.includes` 為精確比對——實作時對 proxy 類採**大小寫不敏感比對**，或大小寫變體皆列。此為黑名單的固有維護債（新裝置型 env key 需持續補列），與白名單的「加合法 key」摩擦互為代價交換。

## Decision 2（補強）：settings.json 明細 diff 不顯示 env 值

`diffSettingsItem`（`sync.js:1850`）以 `stripped.serialized` 建 tmp diff 檔，`printDetailedDiff`（`2268`，非 verbose-gated）→ `printFileDiff`（`1005`）把整份 unified diff 逐行印出，含 env 值。黑名單制下這會外洩「乾淨名+乾淨值」的漏網機密到 stdout（比 git history 更易擴散：CI log／tmux／貼上）。

修法（實作擇一，spec 只規定結果「不顯示 env 值」）：
- **A（推薦）**：settings.json 專用的明細 diff 對 env 做 key 層級比較——只印 `env.<key>` 的新增／移除／變更，值一律遮罩為 `***`。仍能看出「哪個 env key 變了」，不外洩值。
- **B**：diff 用的 serialized 對 env 值整體遮罩後再比對（較粗，會遮掉合法值變更的可讀性）。

差異狀態（`changed`/`same`）仍以未遮罩內容計算，僅**顯示層**遮罩。

## Decision 3：殘餘風險與現存控制（誠實版）

翻黑名單後 env 的防線（去除死碼、補上 diff 遮罩）實為：

```
  ① DEVICE_ENV_KEYS 黑名單        擋已知裝置型/憑證型（含名字乾淨者）
  ② SENSITIVE_KEY_PATTERN key strip 擋名字含 key/token/secret/... 者
  ③ SECRET_VALUE_PATTERN 值掃描    擋乾淨名但值為已知前綴（sk-/ghp_/AKIA…）
  ④ diff env 值遮罩（本 change 新增）擋純讀取 diff 的 stdout 外洩
```

**補不到的殘餘格**：key 名乾淨 + 值非已知前綴 + 未列入 ① 的機密（`DB_PASS=hunter2`、`postgres://u:pw@h`）——經 to-repo **寫入 repo/git history（永久）**。④ 只擋 diff 顯示、擋不了 to-repo 寫入。此為使用者接受的代價。spec 以 characterization scenario 記錄此行為，並以「SHALL NOT 宣稱等同白名單保證」為可測不變式（不以 SHALL 命令「同步機密」）。

## 互補性（回應審查：env 非「同源」）

top-level 由單一 `partitionSettingsTopLevel` 一次算兩桶（真同源）；**env 的 strip↔preserve 是 `stripNonPortableEnv` 與 `extractDeviceValues` env 迴圈兩處對稱實作**（`sync.js:1177-1178` docstring 已載明「不受本函式保護」）。翻黑名單須人工各改一次才互補。spec 用字改為「由對稱的兩處判斷保證互補」，不誇稱同源，並補一條顯式雙向 scenario 把互補鎖進斷言。

## 替代方案（記錄未採用）

- **A1（未採用）**：保留白名單、僅把清單抽單一來源、文件停止枚舉。可零安全代價解摩擦。使用者選擇黑名單的「新 key 全自動」體驗，接受殘餘風險。A1 仍是日後回頭收緊安全時的降級路徑。

## Open Questions

1. **env 的 dropped 是否顯示化？** 現況 env 剝除靜默（不進 dropped 清單）。翻黑名單後「意料之外的 env 剝除」失去白名單兜底，若比照 top-level 印出可作額外訊號。本 change 暫維持 env 靜默；記為後續強化。
2. **`DEVICE_ENV_KEYS` 是否要 pattern 化**（如 `*_PROXY`）而非逐一列舉，以降低維護債？先以列舉起步，觀察後決定。
