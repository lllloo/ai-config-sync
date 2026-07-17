#!/usr/bin/env node
// 讀 stdin 的 Mermaid 原始碼,輸出 mermaid.live 連結(供沒有原生渲染環境的人檢視/線上編輯)。
// 純 Node 內建(node:zlib),零外部相依。編碼格式對齊 mermaid-live-editor 的 `pako` serde:
//   JSON state → zlib deflate(pako.deflate 相容)→ URL-safe base64(無 padding)→ 拼進 #pako:
//
// 用法:
//   cat diagram.mmd | node mermaid-live-link.mjs          # 預設 view(唯讀檢視)
//   cat diagram.mmd | node mermaid-live-link.mjs edit      # edit(線上可編輯)
//   node mermaid-live-link.mjs decode "<url|pako>"         # 把連結解回 Mermaid 原始碼(argv 或 stdin)
//
// 連結不會錯的機制:
//   1) 編碼後「自我驗證」——立刻把剛產的連結解碼回來比對原始碼,不符即 exit 1(擋腳本層錯)。
//   2) decode 模式——貼出去的連結可再餵回來,與原始檔 `diff` 比對,手貼漏字當場現形(擋人為轉錄錯)。
import { deflateSync, inflateSync } from 'node:zlib';

const arg = process.argv[2];

if (arg === 'decode') {
  const input = process.argv[3] ?? (await readStdin());
  try {
    process.stdout.write(decodePako(input));
  } catch {
    process.stderr.write('錯誤:無法解碼此連結(base64/deflate 損毀或非 pako 連結)\n');
    process.exit(1);
  }
  process.exit(0);
}

const mode = arg === 'edit' ? 'edit' : 'view';
const code = await readStdin();
if (!code.trim()) {
  process.stderr.write('錯誤:stdin 沒有 Mermaid 內容\n');
  process.exit(1);
}

const url = encodeToUrl(code, mode);

// 自我驗證:解回自己產的連結,必須逐字等於輸入,否則腳本層編碼有問題,拒絕輸出。
const roundTripped = decodePako(url);
if (roundTripped !== code) {
  process.stderr.write('錯誤:self-check 失敗,編碼後解碼與原始碼不符,連結不可信\n');
  process.exit(1);
}

process.stdout.write(`${url}\n`);

// mermaid.live 的 state 物件;`mermaid` 欄位是「設定的 JSON 字串」(非物件),照其格式給。
function encodeToUrl(src, m) {
  const state = { code: src, mermaid: '{"theme":"default"}', autoSync: true, updateDiagram: true };
  const b64 = deflateSync(Buffer.from(JSON.stringify(state), 'utf8'), { level: 9 })
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `https://mermaid.live/${m}#pako:${b64}`;
}

// 反解:接受完整 URL 或裸 pako 字串,回傳其中的 Mermaid `code`。
function decodePako(input) {
  const trimmed = String(input).trim();
  const marker = 'pako:';
  const idx = trimmed.indexOf(marker);
  const b64url = (idx >= 0 ? trimmed.slice(idx + marker.length) : trimmed).trim();
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const json = inflateSync(Buffer.from(padded, 'base64')).toString('utf8');
  return JSON.parse(json).code;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
