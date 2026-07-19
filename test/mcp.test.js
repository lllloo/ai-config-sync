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
  encodeTomlBasicString,
  decodeTomlBasicString,
  isLocalAuthorizationHeaders,
  serializeMcpSection,
  collectSectionRanges,
  parseMcpConfig,
  validateMcpState,
  projectToLocal,
  projectToRepo,
  diffServerSets,
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

test('TOML basic string encode/decode：安全處理引號與反斜線', () => {
  const original = 'https://example.com/a\\b?x="y"';
  const encoded = encodeTomlBasicString(original);
  assert.equal(decodeTomlBasicString(encoded), original);
  assert.equal(decodeTomlBasicString('"unterminated'), null);
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

test('parseMcpConfig：受管 section 接受本機 Authorization 並只保存 raw line', () => {
  const marker = 'Bearer local-secret-marker';
  const line = `http_headers = { Authorization = "${marker}" } # device only`;
  const parsed = parseMcpConfig(`[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\n${line}\n`, ['supermemory']);
  assert.equal(parsed.sections.supermemory.localAuthLine, line);
  assert.equal(parsed.sections.supermemory.url, SUPERMEMORY.url);
});

test('parseMcpConfig：額外、重複或非 inline Authorization header 仍 fail closed', () => {
  const prefix = '[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\n';
  assert.throws(() => parseMcpConfig(`${prefix}http_headers = { Authorization = "Bearer x", X-Test = "bad" }\n`, ['supermemory']), McpValidationError);
  assert.throws(() => parseMcpConfig(`${prefix}http_headers = { Authorization = "Bearer x" }\nhttp_headers = { Authorization = "Bearer y" }\n`, ['supermemory']), McpValidationError);
  assert.throws(() => parseMcpConfig(`${prefix}[mcp_servers.supermemory.http_headers]\nAuthorization = "Bearer x"\n`, ['supermemory']), McpValidationError);
});

test('projectToLocal：upsert/stale 刪除且保留不受管與非 MCP 原文', () => {
  const original = [
    'personality = "friendly"',
    '',
    '[mcp_servers.keep_local]',
    'command = "node"',
    '',
    '[mcp_servers.old]',
    'url = "https://old.example/mcp"',
    '',
  ].join('\n');
  const state = validateMcpState({ version: 1, managedServers: ['old'] });
  const result = projectToLocal(original, manifest(), state);
  assert.match(result.content, /personality = "friendly"/);
  assert.match(result.content, /\[mcp_servers\.keep_local\][\s\S]*command = "node"/);
  assert.doesNotMatch(result.content, /mcp_servers\.old/);
  assert.match(result.content, /\[mcp_servers\."supermemory"\]/);
});

test('projectToLocal：語意一致時保留受管 section 原始格式', () => {
  const original = '[mcp_servers.supermemory]\nurl="https://mcp.supermemory.ai/mcp"\n# 保留註解\nenabled=true\n';
  const state = { version: 1, managedServers: ['supermemory'] };
  assert.equal(projectToLocal(original, manifest(), state).content, original);
});

test('projectToLocal：更新可攜欄位時原文保留本機 Authorization header', () => {
  const marker = 'Bearer local-secret-marker';
  const authLine = `http_headers = { Authorization = "${marker}" } # keep exact`;
  const original = `[mcp_servers.supermemory]\nurl = "https://old.example/mcp"\nenabled = false\n${authLine}\n`;
  const state = { version: 1, managedServers: ['supermemory'] };
  const result = projectToLocal(original, manifest(), state);
  assert.match(result.content, /url = "https:\/\/mcp\.supermemory\.ai\/mcp"/);
  assert.match(result.content, /enabled = true/);
  assert.ok(result.content.includes(authLine));
});

test('projectToRepo：只擷取 repo/state 受管名稱，不吸入未受管本機 MCP', () => {
  const local = [
    serializeMcpSection('supermemory', { ...SUPERMEMORY, enabled: false }),
    '[mcp_servers.unmanaged]',
    'url = "https://unmanaged.example/mcp"',
  ].join('\n');
  const result = projectToRepo(local, manifest(), { version: 1, managedServers: ['supermemory'] });
  assert.equal(result.servers.supermemory.enabled, false);
  assert.equal(result.servers.unmanaged, undefined);
});

test('projectToRepo：忽略本機 Authorization header 且不寫入 manifest', () => {
  const marker = 'local-secret-marker';
  const local = `[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nenabled = false\nhttp_headers = { Authorization = "Bearer ${marker}" }\n`;
  const result = projectToRepo(local, manifest(), { version: 1, managedServers: ['supermemory'] });
  const serialized = serializeMcpManifest(result);
  assert.equal(result.servers.supermemory.enabled, false);
  assert.doesNotMatch(serialized, new RegExp(marker));
  assert.doesNotMatch(serialized, /http_headers|Authorization/);
});

test('diffServerSets：to-local 回報新增、更新與 stale 刪除', () => {
  const local = { changed: { ...SUPERMEMORY, enabled: false }, stale: SUPERMEMORY };
  const repo = { added: SUPERMEMORY, changed: SUPERMEMORY };
  assert.deepEqual(diffServerSets(local, repo, 'to-local', ['changed', 'stale']), [
    { name: 'added', status: 'new' },
    { name: 'changed', status: 'changed' },
    { name: 'stale', status: 'deleted' },
  ]);
});

test('createMcpHandler：config 已寫後 state 失敗會附掛 partialChanges', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-partial-'));
  const configPath = path.join(root, 'config.toml');
  const manifestPath = path.join(root, 'mcp.json');
  const statePath = path.join(root, 'state.json');
  fs.writeFileSync(manifestPath, serializeMcpManifest(manifest()));
  class SyncError extends Error { constructor(message) { super(message); this.context = {}; } }
  const writes = [];
  const handler = createMcpHandler({
    readJson: file => JSON.parse(fs.readFileSync(file, 'utf8')),
    readFileSafe: file => fs.readFileSync(file, 'utf8'),
    writeFileSafe: (file, content) => {
      writes.push(file);
      if (file === statePath) throw new SyncError('state failed');
      fs.writeFileSync(file, content);
    },
    statePath,
    SyncError,
    ERR: { INVALID_ARGS: 'INVALID_ARGS' },
  });
  try {
    assert.throws(
      () => handler.applyMcpItem({ src: configPath, dest: manifestPath, label: 'mcp.json', prefix: 'codex/' }, 'to-local', false),
      err => err instanceof SyncError && err.context.partialChanges?.[0]?.rel === 'supermemory',
    );
    assert.deepEqual(writes, [configPath, statePath]);
    assert.match(fs.readFileSync(configPath, 'utf8'), /mcp_servers\."supermemory"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
