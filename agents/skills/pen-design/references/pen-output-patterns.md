# Pencil `batch_get` 輸出實戰樣本

這份不是 schema 文件（schema 是 `get_editor_state({include_schema: true})` 的權威來源），而是「你從 `batch_get` 實際會看到的 JSON 長什麼樣」的註解樣本集。所有範例都來自真實 `.pen` 檔，不是編造。

**Agent 第一次讀 Pencil JSON 很容易卡住**，因為 schema 支援多種簡寫與 override 模式，實際輸出會長得和 schema 的「完整型別」不太一樣。看過這 6 個 pattern 後，大部分狀況就認得了。

---

## Pattern 1：頂層 frame（簡單容器）

```json
{
  "type": "frame",
  "id": "cOnQP",
  "name": "Step 1 Frame",
  "width": 1440,
  "height": 900,
  "x": 0,
  "y": -1565,
  "clip": true,
  "fill": "#F2F3F0",
  "children": [ ... ]
}
```

**要認得的點**：
- `fill` 是**單純字串** `"#F2F3F0"`，不是物件也不是陣列。schema 說 `Fill = ColorOrVariable | {...}`，實戰單色背景都用這種捷徑。別以為一定會看到 `[{"type": "color", "color": "..."}]`。
- `name` 是主要語意線索。**切版/核對開工前先看 `name` 對不對**（陷阱 4）。
- `x / y` 存在代表這個節點用的是絕對定位（parent 沒 layout 或 parent 是 document）。

---

## Pattern 2：有 layout 的容器 frame（flex 排版）

```json
{
  "type": "frame",
  "id": "jV147",
  "name": "Content",
  "layout": "vertical",
  "gap": 24,
  "padding": 24,
  "width": "fill_container",
  "height": 900,
  "clip": true,
  "children": [ ... ]
}
```

**要認得的點**：
- `layout: "vertical"` 代表子節點自動垂直排列；沒有 `layout` 屬性時 frame 預設是 `horizontal`。
- `width: "fill_container"` 是**字串**，不是數字。同類值還有 `"fit_content"` / `"fit_content(600)"`（帶 fallback）。Tailwind 對應：`fill_container` → `flex-1` 或 `w-full`，`fit_content` → `w-fit` / `w-auto`。
- `gap: 24` / `padding: 24` 是統一值；`padding` 也可能是 `[16, 24]`（水平/垂直）或 `[8, 16, 8, 16]`（上右下左），看到陣列要記得換算。
- 子節點**不會有 `x / y`**（flexbox 下會被忽略）。如果 flex 容器的子節點還有 `x / y`，那是 schema 錯誤或誤貼的值，可以忽略。

---

## Pattern 3：最小 `ref` instance（沒有 override）

```json
{
  "type": "ref",
  "id": "p1r72",
  "ref": "nIj3a",
  "width": "fill_container",
  "x": 24,
  "y": 88
}
```

**要認得的點**：
- 只有 `id / ref / type` 是必要的；其他都是 override。
- `ref: "nIj3a"` 指向 reusable component——**必須另外 `batch_get` `nIj3a`** 才能知道這個節點實際呈現什麼（按鈕？alert？input？）。看 `ref` 字串本身猜不出來。
- `x / y` 在這裡存在，代表 parent 沒有 flex layout（對照 pattern 2 的 flex 容器，子節點不會有 x/y）。

---

## Pattern 4：`descendants` 的 **property override** 模式

```json
{
  "type": "ref",
  "id": "EKcSr",
  "ref": "KbyBJ",
  "descendants": {
    "248ys": {
      "content": "Integrations",
      "x": 12,
      "y": 6
    }
  },
  "x": 4,
  "y": 4
}
```

**要認得的點**：
- `descendants` 的 key 是**子節點 ID**（不是路徑不是陣列）。
- value 是**部分屬性**——只列要改的欄位。這裡只改 `248ys` 的 `content / x / y`，其他屬性（fill、fontSize、width...）沿用 `KbyBJ` 本體中 `248ys` 的預設值。
- **這就是陷阱 3 講的情境**：不能把 `descendants` 的內容推論成「整個子節點都是這樣」。沒列出的欄位要去 `KbyBJ` 本體查預設值。
- 同一個 instance 可以 override 多個子節點：`descendants: { "248ys": {...}, "k8Lp3": {...} }`。

---

## Pattern 5：`descendants` 的 **整組 `children` 替換** 模式

```json
{
  "type": "ref",
  "id": "Ko6AF",
  "ref": "d5ZTS",
  "descendants": {
    "NvL81": {
      "children": [
        {"id": "eGOU8", "ref": "h12kK", "type": "ref"},
        {"id": "Ct09n", "ref": "dOLzc", "type": "ref"},
        {"id": "oUCen", "ref": "X6nwq", "type": "ref"},
        {"id": "NMbml", "ref": "X6nwq", "type": "ref"},
        {"id": "2u0Td", "ref": "X6nwq", "type": "ref"}
      ]
    }
  }
}
```

**🚨 與 pattern 4 截然不同**，這是另一種 override 模式：

- `NvL81` 是 `d5ZTS` 本體中的一個容器節點（例如 sidebar 的 content 區）。
- 這裡用 `children` 整組**替換**掉 `NvL81` 本體中的預設子節點——本體有什麼 children 不重要了，實際顯示的就是這 5 個 ref。
- 判斷依據：`descendants.NvL81` 裡面出現了 `children` 欄位（陣列）。出現 `children` 就是「替換模式」；只有屬性欄位（content / fill / x / y）就是「屬性 override 模式」。
- Schema 描述的另一個判斷依據：override value 裡如果有 `type` 欄位，代表整個子樹被新物件取代。本例 `NvL81` 沒寫 `type`，但有 `children`，仍然是整組替換。

**踩坑提醒**：如果 agent 把 `NvL81` 裡的 5 個子 ref 當成 property override 解析，會完全搞錯結構。看到 `descendants.X.children` 就要改用「本體的 X 被這些 children 替換」的心智模型。

---

## Pattern 6：複雜的深層 `descendants`（表格整組替換）

```json
{
  "type": "ref",
  "id": "GqMoS",
  "ref": "yLiVX",
  "width": "fill_container",
  "x": 24,
  "y": 196,
  "descendants": {
    "iC3n0": {
      "children": [
        {
          "id": "VZdSB",
          "ref": "T73Cd",
          "type": "ref",
          "children": [
            {"id": "AG4YD", "ref": "tbrR4", "type": "ref"},
            {"id": "GkMsj", "ref": "tbrR4", "type": "ref"}
          ]
        },
        {
          "id": "oLoRH",
          "ref": "T73Cd",
          "type": "ref",
          "children": [
            {"id": "9tiSi", "ref": "uKYIj", "type": "ref"},
            {"id": "a1KTQ", "ref": "uKYIj", "type": "ref"}
          ]
        }
      ]
    }
  }
}
```

**要認得的點**：
- 這是 data table 的實戰樣本。`yLiVX` 是 Data Table 組件；`iC3n0` 是本體中的 rows 容器。
- `iC3n0.children` 被整組替換成真實的 rows——每個 row 是 ref to `T73Cd`（Table Row 組件），row 裡面的 `children` 又是 ref to `tbrR4` / `uKYIj`（Column Header / Cell）。
- **多層 ref 巢狀**：要完整理解這張表要遞迴 `batch_get` `yLiVX` → `T73Cd` → `tbrR4` → `uKYIj`。每層都要查 `name` 確認語意。
- Schema 對應的官方講法：`descendants` 的 key 可以是**路徑**（用 `/` 分隔）指向多層子節點，例如 `"iC3n0/someChild/deeperChild"`。但本例用的是「每層 children 都塞在同一個 object tree」的寫法，兩者都合法。

---

## 快速判斷流程

拿到 `batch_get` 回傳時，按下面順序問自己：

1. **這個節點有 `ref` 嗎？**
   - 有 → 跳 2
   - 沒有 → 正常 frame / text / rectangle，看 `type` 決定怎麼讀
2. **這個 `ref` 有 `descendants` 嗎？**
   - 沒有 → 最小 instance，必須另外 `batch_get` `ref` 本體才知道長什麼樣
   - 有 → 跳 3
3. **`descendants.X` 裡有 `children` 或 `type` 欄位嗎？**
   - **有** → 整組替換模式（pattern 5/6），`X` 本體的結構被蓋掉，以 override 的內容為準
   - **沒有** → 屬性 override 模式（pattern 4），只改列出的欄位，其他要去 `ref` 本體查預設值
4. **`ref` 本體也有 `ref`？**（component 裡面用了另一個 component）
   - 遞迴 `batch_get` 到最底層，直到看到真正的 frame/text/rectangle 為止

---

## 不在這份文件的範圍（刻意省略）

- **完整 schema**：用 `get_editor_state({include_schema: true})`，那是權威來源而且會跟版本
- **所有 `type` 的欄位清單**：用 schema 查
- **`fill` 的所有物件變體**（gradient、image、mesh_gradient）：schema 有，等真的遇到再查
- **`stroke` 的各邊分別設定**：schema 有

這份文件的使命是「讓 agent 第一次看真實 JSON 不會愣住」，不是「取代 schema」。
