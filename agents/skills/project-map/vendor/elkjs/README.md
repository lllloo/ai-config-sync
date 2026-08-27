# elkjs（vendored）

- **版本**：0.12.0
- **來源**：`npm pack elkjs@0.12.0`，取 `lib/` 下 Node 端執行所需的檔案
- **授權**：EPL-2.0 OR GPL-3.0-or-later（全文見 `LICENSE.md`）
- **上游**：https://github.com/kieler/elkjs

## 為什麼 vendor 而不是 npm install

此 skill 需獨立運作、不假設安裝環境，且本 repo 禁止新增 npm 相依。
佈局只在產生階段跑，產出的 HTML 完全不含 ELK。

## 只保留這些檔案

| 檔案 | 用途 |
|---|---|
| `main.js` | Node 入口，`require` 另外兩個檔 |
| `elk-api.js` | API 層 |
| `elk-worker.min.js` | 佈局引擎本體（1.6 MB） |

上游另有 `elk.bundled.js`（瀏覽器用）與未壓縮的 `elk-worker.js`，共約 6 MB，
Node 端用不到，刻意不收。`main.js` 對 `web-worker` 的 require 只在指定
`workerUrl` 時才會走到，此處不使用。

## 更新方式

```sh
npm pack elkjs@<版本>
tar xzf elkjs-<版本>.tgz
cp package/lib/{main.js,elk-api.js,elk-worker.min.js} package/LICENSE.md <此目錄>
```
