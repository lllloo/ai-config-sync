'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { McpValidationError } = require('../mcp.js');
const {
  createClaudeMcpHandler,
  validateClaudeMcpManifest,
  serializeClaudeMcpManifest,
  readLocalServers,
  toPortableServer,
  diffClaudeServers,
  buildAddCommand,
  buildAdvice,
} = require('../claude-mcp.js');

const SUPERMEMORY = { type: 'http', url: 'https://mcp.supermemory.ai/mcp' };

function manifest(servers = { supermemory: SUPERMEMORY }) {
  return { version: 1, servers };
}

function fieldsOf(fn) {
  try { fn(); }
  catch (err) {
    assert.ok(err instanceof McpValidationError);
    return err.paths;
  }
  throw new Error('預期拋出 McpValidationError');
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test('schema：合法來源正規化並依 Server 名排序', () => {
  const result = validateClaudeMcpManifest(manifest({ z: SUPERMEMORY, a: SUPERMEMORY }));
  assert.deepEqual(Object.keys(result.servers), ['a', 'z']);
});

test('schema：sse transport 被完整保留而非丟棄', () => {
  const sse = { type: 'sse', url: 'https://example.com/sse' };
  const result = validateClaudeMcpManifest(manifest({ s: sse }));
  assert.deepEqual(result.servers.s, { type: 'sse', url: 'https://example.com/sse' });
});

test('schema：未知 type fail closed 而非靜默丟棄', () => {
  assert.deepEqual(fieldsOf(() => validateClaudeMcpManifest(manifest({ x: { type: 'ws', url: 'https://e.com/x' } }))), ['servers.x.type']);
  // 靜默丟棄的具體後果：servers 變空、diff 報無差異
  assert.throws(() => validateClaudeMcpManifest(manifest({ x: { url: 'https://e.com/x' } })), McpValidationError);
});

test('schema：憑證載體欄位被拒絕且錯誤不含值', () => {
  const secret = 'never-print-this-value';
  const paths = fieldsOf(() => validateClaudeMcpManifest(manifest({
    s: { ...SUPERMEMORY, headers: { Authorization: secret } },
  })));
  assert.deepEqual(paths, ['servers.s.headers']);
  const envPaths = fieldsOf(() => validateClaudeMcpManifest(manifest({ s: { ...SUPERMEMORY, env: { K: secret } } })));
  assert.ok(!JSON.stringify(envPaths).includes(secret));
});

test('schema：URL pathname 挾帶憑證被拒絕', () => {
  const url = 'https://mcp.example.com/s/NjQ4MWZhZDgtY2YyMS00NDIz/mcp';
  assert.deepEqual(fieldsOf(() => validateClaudeMcpManifest(manifest({ leaky: { type: 'http', url } }))), ['servers.leaky.url']);
});

test('schema：stdio 只接受白名單 command，args 逐一檢查憑證', () => {
  const ok = { type: 'stdio', command: 'npx', args: ['-y', 'mcp-remote@latest'] };
  assert.deepEqual(validateClaudeMcpManifest(manifest({ s: ok })).servers.s, ok);
  assert.deepEqual(fieldsOf(() => validateClaudeMcpManifest(manifest({
    s: { type: 'stdio', command: '/bin/sh', args: [] },
  }))), ['servers.s.command']);
  assert.deepEqual(fieldsOf(() => validateClaudeMcpManifest(manifest({
    s: { type: 'stdio', command: 'npx', args: ['-y', 'AbCd1234EfGh5678IjKl'] },
  }))), ['servers.s.args[1]']);
});

test('schema：envKeys 只接受 key 名清單', () => {
  const withKeys = { type: 'stdio', command: 'npx', args: [], envKeys: ['B_TOKEN', 'A_KEY'] };
  assert.deepEqual(validateClaudeMcpManifest(manifest({ s: withKeys })).servers.s.envKeys, ['A_KEY', 'B_TOKEN']);
  assert.deepEqual(fieldsOf(() => validateClaudeMcpManifest(manifest({
    s: { ...withKeys, envKeys: [{ A_KEY: 'secret-value' }] },
  }))), ['servers.s.envKeys']);
});

test('schema：serialize 為 deterministic 排序', () => {
  const a = serializeClaudeMcpManifest(manifest({ z: SUPERMEMORY, a: SUPERMEMORY }));
  const b = serializeClaudeMcpManifest(manifest({ a: SUPERMEMORY, z: SUPERMEMORY }));
  assert.equal(a, b);
  assert.ok(a.endsWith('\n'));
});

// ---------------------------------------------------------------------------
// 唯讀 inspect
// ---------------------------------------------------------------------------

test('inspect：只取 top-level mcpServers，其餘欄位不外洩', () => {
  const content = JSON.stringify({
    oauthAccount: { accessToken: 'sk-should-never-appear' },
    projects: { '/x': { history: ['secret'] } },
    mcpServers: { supermemory: SUPERMEMORY },
  });
  const servers = readLocalServers(content);
  assert.deepEqual(Object.keys(servers), ['supermemory']);
  assert.ok(!JSON.stringify(servers).includes('sk-should-never-appear'));
});

test('inspect：本機 headers 與 env 值在轉換時就被丟棄', () => {
  const portable = toPortableServer({
    type: 'http', url: 'https://e.com/mcp', headers: { Authorization: 'Bearer secret-token' },
  });
  assert.deepEqual(portable, { type: 'http', url: 'https://e.com/mcp' });
  const stdio = toPortableServer({ command: 'npx', args: ['-y', 'x'], env: { API_KEY: 'secret-value' } });
  assert.deepEqual(stdio, { type: 'stdio', command: 'npx', args: ['-y', 'x'], envKeys: ['API_KEY'] });
  assert.ok(!JSON.stringify(stdio).includes('secret-value'));
});

test('inspect：無 mcpServers 或 malformed 的處理', () => {
  assert.deepEqual(readLocalServers('{}'), {});
  assert.deepEqual(readLocalServers(JSON.stringify({ mcpServers: {} })), {});
  assert.throws(() => readLocalServers('{ not json'), McpValidationError);
});

test('inspect：重複 top-level key 時以 JSON.parse 語意為準', () => {
  // 字元級掃描器取第一個、JSON.parse 取最後一個——唯讀解析不會有這個歧義
  const servers = readLocalServers('{"mcpServers":{"a":{"type":"http","url":"https://a.com/mcp"}},"mcpServers":{"b":{"type":"http","url":"https://b.com/mcp"}}}');
  assert.deepEqual(Object.keys(servers), ['b']);
});

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

test('diff：to-local 回報缺少與不一致，本機額外只標示不刪除', () => {
  const repo = { a: SUPERMEMORY, b: { type: 'http', url: 'https://b.com/mcp' } };
  const local = { b: { type: 'http', url: 'https://b-changed.com/mcp' }, extra: SUPERMEMORY };
  assert.deepEqual(diffClaudeServers(local, repo, 'to-local'), [
    { name: 'a', status: 'new' },
    { name: 'b', status: 'changed' },
    { name: 'extra', status: 'local-only' },
  ]);
});

test('diff：一致時無差異', () => {
  assert.deepEqual(diffClaudeServers({ a: SUPERMEMORY }, { a: SUPERMEMORY }, 'to-local'), []);
});

// ---------------------------------------------------------------------------
// 指令產生
// ---------------------------------------------------------------------------

test('指令：http／sse 產生可直接執行的單行', () => {
  assert.equal(
    buildAddCommand('supermemory', SUPERMEMORY),
    'claude mcp add --transport http --scope user supermemory https://mcp.supermemory.ai/mcp',
  );
  assert.equal(
    buildAddCommand('s', { type: 'sse', url: 'https://e.com/sse' }),
    'claude mcp add --transport sse --scope user s https://e.com/sse',
  );
});

test('指令：stdio 使用 -- 分隔且引號安全', () => {
  assert.equal(
    buildAddCommand('x', { type: 'stdio', command: 'npx', args: ['-y', 'mcp-remote@latest'] }),
    'claude mcp add --scope user x -- npx -y mcp-remote@latest',
  );
  const quoted = buildAddCommand('y', { type: 'stdio', command: 'node', args: ['a b; rm -rf /'] });
  assert.ok(quoted.includes(`'a b; rm -rf /'`));
});

test('指令：envKeys 以佔位表示，MUST NOT 填入真實值', () => {
  const server = { type: 'stdio', command: 'npx', args: [], envKeys: ['API_KEY'] };
  const command = buildAddCommand('x', server);
  assert.ok(command.includes('-e API_KEY=<值>'));
  assert.equal(buildAdvice('x', server, 'new').note, '需自行填入 API_KEY 的值');
});

test('指令：本機額外不產生任何指令', () => {
  const advice = buildAdvice('extra', SUPERMEMORY, 'local-only');
  assert.equal(advice.command, null);
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function makeDeps(writes) {
  return {
    readJson: p => JSON.parse(fs.readFileSync(p, 'utf8')),
    readFileSafe: p => fs.readFileSync(p, 'utf8'),
    writeFileSafe: (p, content) => { writes.push(p); fs.writeFileSync(p, content); },
    SyncError: class extends Error {
      constructor(message, code, context) { super(message); this.code = code; this.context = context; }
    },
    ERR: { INVALID_ARGS: 'INVALID_ARGS' },
  };
}

function withSandbox(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-mcp-test-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('handler：to-local 只產生建議且對本機零寫入', () => {
  withSandbox(dir => {
    const localPath = path.join(dir, '.claude.json');
    const repoPath = path.join(dir, 'mcp.json');
    fs.writeFileSync(localPath, JSON.stringify({ mcpServers: {}, keepMe: 1 }));
    fs.writeFileSync(repoPath, serializeClaudeMcpManifest(manifest()));
    const before = fs.readFileSync(localPath, 'utf8');
    const writes = [];
    const handler = createClaudeMcpHandler(makeDeps(writes));
    const item = { src: localPath, dest: repoPath, label: 'mcp.json', prefix: 'claude/' };

    const result = handler.applyItem(item, 'to-local', false);

    assert.deepEqual(writes, []);
    assert.equal(fs.readFileSync(localPath, 'utf8'), before);
    assert.equal(result.length, 1);
    assert.equal(result[0].action, 'advice');
    assert.ok(result[0].command.startsWith('claude mcp add --transport http --scope user supermemory'));
  });
});

test('handler：to-repo 由本機寫回 repo 並剝除憑證', () => {
  withSandbox(dir => {
    const localPath = path.join(dir, '.claude.json');
    const repoPath = path.join(dir, 'mcp.json');
    fs.writeFileSync(localPath, JSON.stringify({
      mcpServers: { supermemory: { ...SUPERMEMORY, headers: { Authorization: 'Bearer secret-token' } } },
    }));
    const writes = [];
    const handler = createClaudeMcpHandler(makeDeps(writes));
    const item = { src: localPath, dest: repoPath, label: 'mcp.json', prefix: 'claude/' };

    handler.applyItem(item, 'to-repo', false);

    assert.deepEqual(writes, [repoPath]);
    const written = fs.readFileSync(repoPath, 'utf8');
    assert.ok(!written.includes('secret-token'));
    assert.deepEqual(JSON.parse(written).servers.supermemory, SUPERMEMORY);
  });
});

test('handler：本機檔不存在視為無任何 MCP 而非錯誤', () => {
  withSandbox(dir => {
    const repoPath = path.join(dir, 'mcp.json');
    fs.writeFileSync(repoPath, serializeClaudeMcpManifest(manifest()));
    const handler = createClaudeMcpHandler(makeDeps([]));
    const item = { src: path.join(dir, 'missing.json'), dest: repoPath, label: 'mcp.json', prefix: 'claude/' };
    const entries = handler.diffItem(item, 'to-local');
    assert.deepEqual(entries.map(e => e.status), ['new']);
  });
});

test('handler：本機 malformed 包成 SyncError 並帶路徑 context', () => {
  withSandbox(dir => {
    const localPath = path.join(dir, '.claude.json');
    fs.writeFileSync(localPath, '{ not json');
    const deps = makeDeps([]);
    const handler = createClaudeMcpHandler(deps);
    const item = { src: localPath, dest: path.join(dir, 'mcp.json'), label: 'mcp.json', prefix: 'claude/' };
    assert.throws(() => handler.diffItem(item, 'to-local'), err => {
      assert.ok(err instanceof deps.SyncError);
      assert.equal(err.context.path, localPath);
      return true;
    });
  });
});
