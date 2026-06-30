# LLM 文件權威來源

下列技術都提供 LLM-friendly 全文文件（`llms.txt` 類）。**提到該技術且需查可查證細節（具體 API、composables、指令名、設定鍵、流程步驟、agent 角色、目錄結構、版本相依行為等）時，先 WebFetch 對應 URL，不憑印象作答。** 純概念／方向性問答不必每次抓；同對話內已抓過同一來源不重抓。

| 技術 | 觸發語 | 權威來源 |
|------|--------|----------|
| BMAD Method | bmad／BMAD Method | https://docs.bmad-method.org/llms-full.txt |
| Nuxt 4 | Nuxt 4／Nuxt 4.x（Nuxt 3 見細則） | 索引 https://nuxt.com/llms.txt ；單章節 https://nuxt.com/raw/docs/4.x/&lt;section&gt;/&lt;name&gt;.md ；全文 https://nuxt.com/llms-full.txt（~4MB，含 v3+v4，僅需全文檢索時抓） |

## 各來源細則

- **Nuxt 4**：不確定章節時先抓 `llms.txt` 索引，再抓對應的 `4.x/*.md` 單檔。Nuxt 3 相關內容走 v3 章節（`raw/docs/3.x/...`），勿與 v4 混用。
