'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  McpValidationError,
  createMcpHandler,
  validateMcpManifest,
  serializeMcpManifest,
  isValidServerName,
  isHttpsUrl,
  isSuspiciousToken,
  findUrlCredentialPaths,
  findArgsCredentialPaths,
  decodeTomlBasicString,
  isLocalAuthorizationHeaders,
  collectSectionRanges,
  parseMcpConfig,
  projectToRepo,
  diffServerSets,
  buildAddCommand,
  buildAdvice,
} = require('../mcp.js');

const SUPERMEMORY = {
  transport: 'streamable-http',
  url: 'https://mcp.supermemory.ai/mcp',
  enabled: true,
};

function manifest(servers = { supermemory: SUPERMEMORY }) {
  return { version: 1, servers };
}

test('validateMcpManifest：合法來源正規化並依 Server 名排序', () => {
  const result = validateMcpManifest(manifest({ z: SUPERMEMORY, a: SUPERMEMORY }));
  assert.deepEqual(Object.keys(result.servers), ['a', 'z']);
});

test('憑證判準：path-embedded opaque token 被擋，正常路徑放行', () => {
  // Zapier／Composio 主流形式：無 vendor 前綴的 base64，黑名單完全免疫
  const zapier = 'https://mcp.zapier.com/api/mcp/s/NjQ4MWZhZDgtY2YyMS00/mcp';
  assert.deepEqual(findUrlCredentialPaths(zapier, 'servers.z.url'), ['servers.z.url']);
  assert.deepEqual(findUrlCredentialPaths('https://mcp.supermemory.ai/mcp', 'servers.s.url'), []);
  assert.deepEqual(findUrlCredentialPaths('https://example.com/api/v1/streamable-http', 'servers.e.url'), []);
});

test('憑證判準：UUID 與 query 挾帶憑證被擋', () => {
  const uuid = 'https://example.com/mcp/550e8400-e29b-41d4-a716-446655440000';
  assert.deepEqual(findUrlCredentialPaths(uuid, 'servers.u.url'), ['servers.u.url']);
  const query = 'https://example.com/mcp?api_key=AbCd1234EfGh5678IjKl';
  assert.deepEqual(findUrlCredentialPaths(query, 'servers.q.url'), ['servers.q.url']);
  assert.deepEqual(findUrlCredentialPaths('https://example.com/mcp?v=1', 'servers.v.url'), []);
});

test('憑證判準：無法解析的 URL fail closed', () => {
  assert.deepEqual(findUrlCredentialPaths('not a url', 'servers.x.url'), ['servers.x.url']);
});

test('憑證判準：args 逐元素檢查並指出索引', () => {
  const args = ['-y', 'mcp-remote@latest', 'https://h.example.com/x/NjQ4MWZhZDgtY2YyMS00', 'AbCd1234EfGh5678IjKl'];
  assert.deepEqual(findArgsCredentialPaths(args, 'servers.s'), ['servers.s.args[2]', 'servers.s.args[3]']);
  assert.deepEqual(findArgsCredentialPaths(['-y', 'mcp-remote@latest'], 'servers.s'), []);
});

test('憑證判準：短片段與純小寫詞組視為安全', () => {
  assert.equal(isSuspiciousToken('mcp'), false);
  assert.equal(isSuspiciousToken('streamable-http'), false);
  assert.equal(isSuspiciousToken('a'.repeat(40)), false);
  assert.equal(isSuspiciousToken('NjQ4MWZhZDgtY2YyMS00'), true);
});

test('憑證判準：manifest 驗證接上 URL 檢查且錯誤不含值', () => {
  const url = 'https://mcp.example.com/s/NjQ4MWZhZDgtY2YyMS00NDIz/mcp';
  assert.throws(
    () => validateMcpManifest(manifest({ leaky: { ...SUPERMEMORY, url } })),
    (err) => {
      assert.ok(err instanceof McpValidationError);
      assert.deepEqual(err.paths, ['servers.leaky.url']);
      assert.ok(!err.message.includes('NjQ4MWZhZDgt'));
      return true;
    },
  );
});

test('validateMcpManifest：拒絕未知敏感欄位且錯誤不含值', () => {
  const secret = 'never-print-this-value';
  assert.throws(
    () => validateMcpManifest(manifest({ supermemory: { ...SUPERMEMORY, Authorization: secret } })),
    err => err instanceof McpValidationError
      && err.paths.includes('servers.supermemory.Authorization')
      && !err.message.includes(secret),
  );
});

test('名稱與 URL 白名單：控制字元、空白、http、帳密 URL 均拒絕', () => {
  assert.equal(isValidServerName('alpha-1.test_ok'), true);
  assert.equal(isValidServerName('bad name'), false);
  assert.equal(isValidServerName('bad\nname'), false);
  assert.equal(isHttpsUrl('https://example.com/mcp'), true);
  assert.equal(isHttpsUrl('http://example.com/mcp'), false);
  assert.equal(isHttpsUrl('https://user:pass@example.com/mcp'), false);
});

test('serializeMcpManifest：deterministic 排序且保留結尾換行', () => {
  const text = serializeMcpManifest(manifest({ z: SUPERMEMORY, a: { ...SUPERMEMORY, enabled: false } }));
  assert.ok(text.indexOf('"a"') < text.indexOf('"z"'));
  assert.ok(text.endsWith('\n'));
  assert.equal(text, serializeMcpManifest(JSON.parse(text)));
});

test('TOML basic string decode：安全處理引號與反斜線', () => {
  assert.equal(decodeTomlBasicString('"https://example.com/a\\\\b"'), 'https://example.com/a\\b');
  assert.equal(decodeTomlBasicString('"https://e.com/mcp" # 註解'), 'https://e.com/mcp');
  assert.equal(decodeTomlBasicString('"unterminated'), null);
  assert.equal(decodeTomlBasicString(`'literal'`), null);
});

test('本機 Authorization header：只接受單一 inline basic-string 欄位', () => {
  assert.equal(isLocalAuthorizationHeaders('{ Authorization = "Bearer sm_local" }'), true);
  assert.equal(isLocalAuthorizationHeaders('{ "Authorization" = "Bearer sm_local" } # local'), true);
  assert.equal(isLocalAuthorizationHeaders('{ Authorization = "Bearer sm_local", X-Test = "bad" }'), false);
  assert.equal(isLocalAuthorizationHeaders('{ Authorization = \'Bearer sm_local\' }'), false);
});

test('parseMcpConfig：辨識普通與引號 section，enabled 缺省視為 true', () => {
  const content = [
    '[mcp_servers.alpha]',
    'url = "https://alpha.example/mcp"',
    '',
    '[mcp_servers."beta"]',
    'url = "https://beta.example/mcp"',
    'enabled = false',
    '',
  ].join('\n');
  const parsed = parseMcpConfig(content);
  assert.equal(parsed.sections.alpha.enabled, true);
  assert.equal(parsed.sections.beta.enabled, false);
});

test('collectSectionRanges：拒絕重複、malformed 與 MCP array-table', () => {
  assert.throws(() => collectSectionRanges('[mcp_servers.a]\nurl="https://a.test"\n[mcp_servers.a]\nurl="https://a.test"\n'), McpValidationError);
  assert.throws(() => collectSectionRanges('[mcp_servers.a\nurl="https://a.test"\n'), McpValidationError);
  assert.throws(() => collectSectionRanges('[[mcp_servers.a]]\nurl="https://a.test"\n'), McpValidationError);
});

test('parseMcpConfig：未受管 stdio 與巢狀 section 不阻擋受管 HTTP Server', () => {
  const content = [
    '[mcp_servers.local_stdio]',
    'command = "node"',
    '[mcp_servers.local_stdio.env]',
    'TOKEN = "local"',
    '[mcp_servers.supermemory]',
    'url = "https://mcp.supermemory.ai/mcp"',
    'enabled = true',
  ].join('\n');
  const parsed = parseMcpConfig(content, ['supermemory']);
  assert.deepEqual(Object.keys(parsed.sections), ['supermemory']);
});

test('parseMcpConfig：受管 section 未知或重複 key 時 fail closed', () => {
  assert.throws(() => parseMcpConfig('[mcp_servers.a]\nurl="https://a.test"\nheaders={}\n', ['a']), McpValidationError);
  assert.throws(() => parseMcpConfig('[mcp_servers.a]\nurl="https://a.test"\nurl="https://b.test"\n', ['a']), McpValidationError);
});

test('parseMcpConfig：受管 section 容忍本機 Authorization 但不保存其值', () => {
  const marker = 'Bearer local-secret-marker';
  const line = `http_headers = { Authorization = "${marker}" } # device only`;
  const parsed = parseMcpConfig(`[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\n${line}\n`, ['supermemory']);
  assert.equal(parsed.sections.supermemory.url, SUPERMEMORY.url);
  // 唯讀後不再需要 raw line 保存；值連進入解析結果都不該發生
  assert.ok(!JSON.stringify(parsed.sections.supermemory).includes('local-secret-marker'));
});

test('parseMcpConfig：額外、重複或非 inline Authorization header 仍 fail closed', () => {
  const prefix = '[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\n';
  assert.throws(() => parseMcpConfig(`${prefix}http_headers = { Authorization = "Bearer x", X-Test = "bad" }\n`, ['supermemory']), McpValidationError);
  assert.throws(() => parseMcpConfig(`${prefix}http_headers = { Authorization = "Bearer x" }\nhttp_headers = { Authorization = "Bearer y" }\n`, ['supermemory']), McpValidationError);
  assert.throws(() => parseMcpConfig(`${prefix}[mcp_servers.supermemory.http_headers]\nAuthorization = "Bearer x"\n`, ['supermemory']), McpValidationError);
});

test('projectToRepo：只擷取 repo 受管名稱，不吸入未受管本機 MCP', () => {
  const local = [
    '[mcp_servers."supermemory"]',
    'url = "https://mcp.supermemory.ai/mcp"',
    'enabled = false',
    '',
    '[mcp_servers.unmanaged]',
    'url = "https://unmanaged.example/mcp"',
  ].join('\n');
  const result = projectToRepo(local, manifest());
  assert.equal(result.servers.supermemory.enabled, false);
  assert.equal(result.servers.unmanaged, undefined);
});

test('projectToRepo：忽略本機 Authorization header 且不寫入 manifest', () => {
  const marker = 'local-secret-marker';
  const local = `[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nenabled = false\nhttp_headers = { Authorization = "Bearer ${marker}" }\n`;
  const result = projectToRepo(local, manifest());
  const serialized = serializeMcpManifest(result);
  assert.equal(result.servers.supermemory.enabled, false);
  assert.doesNotMatch(serialized, new RegExp(marker));
  assert.doesNotMatch(serialized, /http_headers|Authorization/);
});

test('diffServerSets：to-local 回報新增、更新，本機額外標為 local-only', () => {
  const local = { changed: { ...SUPERMEMORY, enabled: false } };
  const repo = { added: SUPERMEMORY, changed: SUPERMEMORY };
  assert.deepEqual(diffServerSets(local, repo, 'to-local', ['extra']), [
    { name: 'added', status: 'new' },
    { name: 'changed', status: 'changed' },
    { name: 'extra', status: 'local-only' },
  ]);
});

test('指令：codex mcp add 為可直接執行的單行，附登入步驟', () => {
  assert.equal(buildAddCommand('supermemory', SUPERMEMORY), 'codex mcp add supermemory --url https://mcp.supermemory.ai/mcp');
  const advice = buildAdvice('supermemory', SUPERMEMORY, 'new');
  assert.match(advice.note, /codex mcp login supermemory/);
});

test('指令：停用狀態無對應旗標時以提示表達而非假裝', () => {
  const advice = buildAdvice('s', { ...SUPERMEMORY, enabled: false }, 'new');
  assert.match(advice.note, /enabled = false/);
});

test('指令：本機額外不產生任何指令', () => {
  assert.equal(buildAdvice('extra', undefined, 'local-only').command, null);
});

function withCodexSandbox(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-advisory-'));
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function makeHandler(root, writes) {
  class SyncError extends Error { constructor(message, code, context) { super(message); this.context = context || {}; } }
  const handler = createMcpHandler({
    readJson: file => JSON.parse(fs.readFileSync(file, 'utf8')),
    readFileSafe: file => fs.readFileSync(file, 'utf8'),
    writeFileSafe: (file, content) => { writes.push(file); fs.writeFileSync(file, content); },
    SyncError,
    ERR: { INVALID_ARGS: 'INVALID_ARGS' },
  });
  return { handler, SyncError };
}

test('createMcpHandler：to-local 只產生建議且對 config.toml 零寫入', () => {
  withCodexSandbox(root => {
    const configPath = path.join(root, 'config.toml');
    const manifestPath = path.join(root, 'mcp.json');
    const original = 'personality = "friendly"\n\n[mcp_servers.other]\nurl = "https://other.example/mcp"\n';
    fs.writeFileSync(configPath, original);
    fs.writeFileSync(manifestPath, serializeMcpManifest(manifest()));
    const writes = [];
    const { handler } = makeHandler(root, writes);

    const result = handler.applyItem({ src: configPath, dest: manifestPath, label: 'mcp.json', prefix: 'codex/' }, 'to-local', false);

    assert.deepEqual(writes, []);
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    const added = result.find(entry => entry.name === 'supermemory');
    assert.equal(added.action, 'advice');
    assert.equal(added.command, 'codex mcp add supermemory --url https://mcp.supermemory.ai/mcp');
    // 未受管的本機 Server 只被標示，不產生任何指令
    assert.equal(result.find(entry => entry.name === 'other').command, null);
  });
});

test('createMcpHandler：to-repo 寫回 repo 且不含本機 Authorization', () => {
  withCodexSandbox(root => {
    const configPath = path.join(root, 'config.toml');
    const manifestPath = path.join(root, 'mcp.json');
    fs.writeFileSync(configPath, '[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nenabled = false\nhttp_headers = { Authorization = "Bearer local-secret-marker" }\n');
    fs.writeFileSync(manifestPath, serializeMcpManifest(manifest()));
    const writes = [];
    const { handler } = makeHandler(root, writes);

    handler.applyItem({ src: configPath, dest: manifestPath, label: 'mcp.json', prefix: 'codex/' }, 'to-repo', false);

    assert.deepEqual(writes, [manifestPath]);
    const written = fs.readFileSync(manifestPath, 'utf8');
    assert.ok(!written.includes('local-secret-marker'));
    assert.equal(JSON.parse(written).servers.supermemory.enabled, false);
  });
});

test('createMcpHandler：config.toml 不存在視為無任何 MCP', () => {
  withCodexSandbox(root => {
    const manifestPath = path.join(root, 'mcp.json');
    fs.writeFileSync(manifestPath, serializeMcpManifest(manifest()));
    const { handler } = makeHandler(root, []);
    const entries = handler.diffItem({ src: path.join(root, 'missing.toml'), dest: manifestPath, label: 'mcp.json', prefix: 'codex/' }, 'to-local');
    assert.deepEqual(entries.map(e => e.status), ['new']);
  });
});
