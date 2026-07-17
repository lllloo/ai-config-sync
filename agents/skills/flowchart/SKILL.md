---
name: flowchart
description: 把一段流程、決策邏輯或既有程式碼/文件,轉成一張乾淨可渲染的 Mermaid 圖(預設 flowchart,必要時 sequence/state);每次都附上 mermaid.live 連結供使用者確認渲染結果。僅由使用者明確輸入 /flowchart 或明講「畫流程圖／畫成 Mermaid／把這個流程畫出來」時使用,不自動觸發。
disable-model-invocation: true
---

# flowchart — 產生 Mermaid 流程圖

把「一段流程／決策邏輯／既有程式碼或文件描述的步驟」轉成一張**語法正確、可直接渲染**的 Mermaid 圖。Claude Code 終端、Artifacts、GitHub、Obsidian 皆原生渲染 ```mermaid 圍籬,所以輸出一律用 Mermaid 而非 ASCII art。

這個 skill 是**手動觸發**:只在使用者點名時跑。它的價值在於一次把 Mermaid 的語法陷阱處理掉,不用每次重踩。

## 流程

1. **先確認要畫什麼**——來源可能是三種,對應不同起手:
   - **文字描述**:使用者用自然語言講流程/決策 → 直接抽節點與邊。
   - **既有程式碼/函式**:先讀相關檔(用 Read/Grep 定位,別整庫盲讀),把控制流(分支、迴圈、early return、錯誤路徑)逆推成節點。
   - **既有文件/流程**:讀來源,萃取步驟與判斷點。

   若步驟或分支不明確(缺結束條件、某判斷的另一支去哪),**先問一題再畫**,不要自行腦補流程——畫錯的圖比沒有圖更誤導。

2. **選圖型**(預設 flowchart,別過度):
   - **flowchart**——有先後步驟、判斷分支、迴圈。九成情況用這個。
   - **sequenceDiagram**——重點是多個角色/服務之間的**訊息往返時序**(A 呼叫 B、B 回 C)。
   - **stateDiagram-v2**——重點是**狀態轉移**(pending → running → done,及觸發轉移的事件)。

3. **選方向**:縱向流程用 `flowchart TD`(top-down),節點多、標籤長或偏線性用 `flowchart LR`(left-right)較好讀。

4. **輸出**:把圖放進 ```mermaid 圍籬直接回給使用者。預設**只輸出圖**,不逐節點複述文字(圖本身就是說明)。若使用者要存檔,寫成 `.md` 檔(內含 ```mermaid 區塊)。

5. **一律附 mermaid.live 連結**:每張圖都接著產一條連結給使用者,一鍵開瀏覽器親眼確認渲染(不是選配、不等使用者開口)。圖一改就重產,連結永遠對應當前這張。做法見下節。

## 附上 mermaid.live 連結

連結讓使用者一鍵開瀏覽器確認渲染、必要時線上微調,故每張圖都附(多數載體雖能原生渲染 ```mermaid,仍一律給)。**連結尾段是數百字 base64,手貼漏一字就 deflate 解成壞資料、圖渲染成亂碼且不報錯**,所以流程強制「產出即自我驗證 + 貼出後回驗」——三步照做:

1. **寫檔**:用 Write 工具把 Mermaid 原始碼寫成 `diagram.mmd`(別用 `echo`/`printf` 經 shell 塞長串——引號逃逸是跨 shell 地雷;有檔才好回驗)。**放暫存處**(系統 temp 或 harness 給的 scratchpad),別寫進使用者專案目錄——這是驗證用中間檔,留在人家 repo 裡是垃圾;只有使用者說要存檔才寫進專案(此時直接寫成 `.md` 含 mermaid 圍籬)。
2. **產連結**(腳本編碼後自我解碼比對,不符即 `exit 1`;通過才輸出)。檔案路徑用參數傳,**不要用 `< diagram.mmd` 重導向**——`<` 在 PowerShell 是保留運算子,Windows 上直接炸:
   ```
   node <skill 目錄>/scripts/mermaid-live-link.mjs diagram.mmd            # /view 唯讀(預設)
   node <skill 目錄>/scripts/mermaid-live-link.mjs edit diagram.mmd       # /edit 線上可編輯
   ```
   **預設 `/view`**;只有使用者明講要線上改才給 `edit`。
3. **貼上並回驗**:把連結用 markdown `[說明](url)` 貼進回覆(code block 裡的網址在終端不可點),接著把**你剛貼的那條 URL** 原樣餵回 `verify`:
   ```
   node <skill 目錄>/scripts/mermaid-live-link.mjs verify diagram.mmd "<你貼的 URL>"
   ```
   `exit 0`(印「✓ 一致」)才算數;`exit 1` = 貼漏了,重貼再驗,別交出去。step 2 的自我驗證只擔保「腳本產的連結對」,這步才涵蓋「從 stdout 手貼到回覆」這段轉錄——是唯一能抓人為漏字的關卡。

命令 cwd 是使用者當前專案、非 skill 目錄,故一律用**絕對路徑**(取上方「Base directory for this skill」接 `scripts/mermaid-live-link.mjs`)。腳本純 Node 內建 `zlib`,零相依。

## 預設風格:不套主題(最通用)

**預設不放任何 `%%{init}%%` 主題指令**,直接用 default theme。這是最多人的做法,理由:GitHub / GitLab / Obsidian / Notion 都原生渲染,且 Mermaid 會**自動跟隨檢視者的 light/dark 模式**;一旦寫死 `theme`,就破壞這個自動適應(深色圖在淺色頁變成突兀的深色方塊,反之亦然)。所以除非使用者明確要某風格,**不主動加主題**。

只在使用者**明講**要特定風格時才加,常見選項(給人挑,不預設):

- **內建主題**:`%%{init: {'theme':'dark'}}%%`(或 `forest`／`neutral`／`base`)。`neutral` 適合黑白列印;`dark` 適合固定深色場景。
- **原生新外觀(Mermaid ≥ 11.14)**:frontmatter `config: { look: neo }`(現代、加陰影)或 `look: handDrawn`(手繪素描感),可與任何 theme 併用。**注意相容性**:渲染端版本太舊會 fallback 成普通樣式(不會壞、只是沒效果),要「哪都一致」就別依賴。
- **語意上色**:用 `classDef` + `class <id> <角色>` 只點重點節點,不必配整套主題。

## Mermaid 語法要點(踩雷區,務必守住)

節點形狀——用形狀傳達語意,別全用矩形:

```
A[矩形:一般步驟]
B(圓角:起點/終點也常用)
C{菱形:判斷/是非分岔}
D([體育場形:開始/結束])
E[[子程序]]
F[(資料庫)]
G((圓形:連接點))
```

邊與標籤:

```
A --> B            實線箭頭
A -->|是| C        帶標籤(判斷分支必標「是/否」)
A -- 文字 --> C     等價寫法
A -.-> D           虛線(次要/可選路徑)
A ==> E            粗線(主幹)
```

**長標籤用 `<br/>` 折行**:`A["讀取設定<br/>並驗證格式"]`。單一節點文字過長會把整張圖橫向撐爆、逼出捲軸,主動折行比讓渲染器硬撐好讀。

**最容易生語法錯誤的四件事**——照這樣避開:

- **標籤含特殊字元一律加引號**:括號 `()`、方括號 `[]`、冒號、`#`、`"`、`|` 出現在標籤文字裡時,必須包引號——**節點、邊標籤、subgraph 標題三處同規則**(實測 v11:邊標籤含括號不加引號直接 Syntax error):
  ```
  A["回傳 payload (含 token)"]
  B -->|"是 (通過)"| C
  subgraph sg1["前處理 (階段一)"]
  ```
  subgraph 比照節點:給英數 id,顯示文字放 `["..."]` 引號內。
- **`end` 不能當節點 id**(Mermaid 保留字,小寫尤其會壞):用 `End`、`stop`、`done` 之類代替。
- **節點 id 用英數**(`step1`、`checkAuth`),把中文/空白/符號放進**標籤**(`step1[驗證權限]`),別拿中文當 id。
- **中文標點在引號內沒問題**,但引號本身要用直引號 `"`,別用全形 `「」` 當語法引號(當文字內容則無妨)。

分組用 subgraph(有階段/泳道時):

```
flowchart TD
  subgraph pre[前處理]
    a[讀輸入] --> b{格式正確?}
  end
  b -->|否| err[報錯結束]
  b -->|是| c[進主流程]
```

## sequence / state 圖的語法要點

上面的引號與 id 規則是 flowchart 的;選了 sequenceDiagram / stateDiagram-v2 時,雷區換一套:

**sequenceDiagram**:

- **參與者先宣告、用 `as` 給顯示名**:`participant PSP as 金流商 (第三方)`——顯示名含括號直接寫,**不要包引號**(實測 v11:引號會被當成文字印在圖上,不是語法)。flowchart 的引號習慣別帶過來。
- **箭頭有語意,選對才不誤導**:`->>` 同步請求、`-->>` 回應(虛線)、`-)` 非同步 fire-and-forget——webhook 回呼、推播通知這種「發了不等回」的用 `-)`,別一律 `->>`。
- **區塊語法**:`alt 成功 ... else 失敗 ... end`、`opt`(可選)、`loop`(重複),每個區塊都要收 `end`(sequence 的 `end` 是合法關鍵字,跟 flowchart 禁拿 `end` 當節點 id 是兩回事)。
- **訊息文字放冒號後,不需引號**:`API->>PSP: 建立交易 (含 token)`——括號在這裡不會壞。

**stateDiagram-v2**:

- `[*]` 代表開始/結束;轉移標籤用冒號:`pending --> running: 開始執行`。
- 狀態顯示名含空白/特殊字元時先取別名:`state "等待中 (排隊)" as pending`。

## 範例

**輸入**:使用者說「登入流程:輸入帳密 → 驗證,失敗回登入頁,成功且有雙因素就要驗 OTP,沒有就直接進首頁」

**輸出**:

```mermaid
flowchart TD
  start([開始]) --> input[輸入帳密]
  input --> verify{帳密正確?}
  verify -->|否| input
  verify -->|是| has2fa{啟用雙因素?}
  has2fa -->|是| otp[驗證 OTP]
  has2fa -->|否| home([進入首頁])
  otp --> otpok{OTP 正確?}
  otpok -->|否| otp
  otpok -->|是| home
```

## 邊界

- 每個判斷節點的**每一條分支都要有去向**(包含失敗/否的路徑)——漏掉分支是最常見的錯,輸出前自查一遍。
- 圖太大(超過 ~25 節點)時,先問使用者要不要拆成數張(主流程一張、子流程各一張),別硬塞成一張看不懂的圖。
- 這個 skill 只**產生**圖,不負責把圖嵌進特定專案的文件結構——那由使用者或當下情境決定放哪。
