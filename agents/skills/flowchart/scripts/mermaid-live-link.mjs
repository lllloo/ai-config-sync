#!/usr/bin/env node
// 讀 stdin 的 Mermaid 原始碼,輸出 mermaid.live 連結(供沒有原生渲染環境的人檢視/線上編輯)。
// 純 Node 內建(node:zlib),零外部相依。編碼格式對齊 mermaid-live-editor 的 `pako` serde:
//   JSON state → zlib deflate(pako.deflate 相容)→ URL-safe base64(無 padding)→ 拼進 #pako:
// 用法:
//   node mermaid-live-link.mjs        # 預設 view(唯讀檢視)
//   node mermaid-live-link.mjs edit   # edit(線上可編輯)
// 例:  cat diagram.mmd | node mermaid-live-link.mjs
import { deflateSync } from 'node:zlib';

const mode = process.argv[2] === 'edit' ? 'edit' : 'view';
const code = await readStdin();
if (!code.trim()) {
  process.stderr.write('錯誤:stdin 沒有 Mermaid 內容\n');
  process.exit(1);
}

// mermaid.live 的 state 物件;`mermaid` 欄位是「設定的 JSON 字串」(非物件),照其格式給。
const state = { code, mermaid: '{"theme":"default"}', autoSync: true, updateDiagram: true };
const b64 = deflateSync(Buffer.from(JSON.stringify(state), 'utf8'), { level: 9 })
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

process.stdout.write(`https://mermaid.live/${mode}#pako:${b64}\n`);

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
