'use strict';

// =============================================================================
// claude-mcp.js -- Claude MCP 可攜來源與諮詢式（advisory）比對
//
// 本檔對本機端「只讀不寫」，且刻意沒有任何寫入 `~/.claude.json` 的路徑存在。
// 這不是紀律問題而是架構選擇：該檔是 76 KB 的活檔（OAuth token、projects 歷史、
// 各式 cache），且 Claude Code 執行期持續寫入。對它做部分改寫的所有已知缺陷
// （靜默覆寫、prototype 名稱、transport 被吞）都源於「我們要寫它」；不寫，缺陷
// 就不存在（見 design D1／D2）。
//
// 唯讀不需要保留原始 bytes，故 `JSON.parse` 整檔解析即可，不需字元級掃描器。
// 寫入只發生在 repo 端（`claude/mcp.json`），由 deps.writeFileSafe 負責。
// 不反向 require sync.js；憑證判準與共用驗證自 mcp.js 取得（純函式、零 IO）。
// =============================================================================

const fs = require('fs');
const {
  McpValidationError,
  isValidServerName,
  isHttpsUrl,
  findUrlCredentialPaths,
  findArgsCredentialPaths,
} = require('./mcp.js');

const REMOTE_TYPES = new Set(['http', 'sse']);
const SERVER_TYPES = new Set(['http', 'sse', 'stdio']);
const SERVER_FIELDS = new Set(['type', 'url', 'command', 'args', 'envKeys']);
// stdio 只允許已知的 runner。任意 command 等同讓 repo 決定本機執行什麼。
const COMMAND_ALLOWLIST = new Set(['npx', 'node', 'bunx', 'uvx', 'deno', 'python', 'python3']);
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// Schema 驗證（fail closed）
// -----------------------------------------------------------------------------

function validateEnvKeys(value, base, paths) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string' || !ENV_KEY_PATTERN.test(key))) {
    paths.push(`${base}.envKeys`);
    return undefined;
  }
  return [...value].sort();
}

function validateRemoteServer(server, base, paths) {
  if (!isHttpsUrl(server.url)) paths.push(`${base}.url`);
  else paths.push(...findUrlCredentialPaths(server.url, `${base}.url`));
  for (const key of ['command', 'args']) {
    if (server[key] !== undefined) paths.push(`${base}.${key}`);
  }
  return { url: server.url };
}

function validateStdioServer(server, base, paths) {
  if (typeof server.command !== 'string' || !COMMAND_ALLOWLIST.has(server.command)) {
    paths.push(`${base}.command`);
  }
  const args = server.args === undefined ? [] : server.args;
  if (!Array.isArray(args)) paths.push(`${base}.args`);
  else paths.push(...findArgsCredentialPaths(args, base));
  if (server.url !== undefined) paths.push(`${base}.url`);
  return { command: server.command, args: Array.isArray(args) ? [...args] : [] };
}

function validateServer(name, server, paths) {
  const base = `servers.${name}`;
  if (!isValidServerName(name)) paths.push(base);
  if (!isPlainObject(server)) { paths.push(base); return null; }
  for (const key of Object.keys(server)) {
    if (!SERVER_FIELDS.has(key)) paths.push(`${base}.${key}`);
  }
  // 未知 type 一律 fail closed。靜默丟棄會讓 repo 變空，下一輪 diff 報「無差異」
  // 而 Server 其實已從來源消失（design D5）。
  if (!SERVER_TYPES.has(server.type)) { paths.push(`${base}.type`); return null; }
  const shape = REMOTE_TYPES.has(server.type)
    ? validateRemoteServer(server, base, paths)
    : validateStdioServer(server, base, paths);
  const envKeys = validateEnvKeys(server.envKeys, base, paths);
  return { type: server.type, ...shape, ...(envKeys && envKeys.length ? { envKeys } : {}) };
}

function validateClaudeMcpManifest(input) {
  const paths = [];
  if (!isPlainObject(input)) throw new McpValidationError(['$']);
  for (const key of Object.keys(input)) {
    if (key !== 'version' && key !== 'servers') paths.push(key);
  }
  if (input.version !== 1) paths.push('version');
  if (!isPlainObject(input.servers)) paths.push('servers');
  const servers = {};
  if (isPlainObject(input.servers)) {
    for (const name of Object.keys(input.servers).sort()) {
      const normalized = validateServer(name, input.servers[name], paths);
      if (normalized) servers[name] = normalized;
    }
  }
  if (paths.length) throw new McpValidationError(paths);
  return { version: 1, servers };
}

function serializeClaudeMcpManifest(input) {
  return JSON.stringify(validateClaudeMcpManifest(input), null, 2) + '\n';
}

// -----------------------------------------------------------------------------
// 唯讀 inspect：只取 top-level mcpServers
// -----------------------------------------------------------------------------

// 本機 member 轉為可攜身分欄位。`headers`／`env` 值等憑證載體在此就被丟棄，
// 不是稍後才過濾——讓它們連進入記憶體中的比較對象都不會。
function toPortableServer(member) {
  if (!isPlainObject(member)) return null;
  const type = typeof member.type === 'string' ? member.type : (member.command ? 'stdio' : null);
  if (!SERVER_TYPES.has(type)) return null;
  if (REMOTE_TYPES.has(type)) {
    return typeof member.url === 'string' ? { type, url: member.url } : null;
  }
  if (typeof member.command !== 'string') return null;
  const envKeys = isPlainObject(member.env) ? Object.keys(member.env).sort() : [];
  return {
    type,
    command: member.command,
    args: Array.isArray(member.args) ? member.args.map(String) : [],
    ...(envKeys.length ? { envKeys } : {}),
  };
}

function readLocalServers(content) {
  let parsed;
  try { parsed = JSON.parse(content); }
  catch (_) { throw new McpValidationError(['.claude.json']); }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.mcpServers)) return {};
  const servers = {};
  for (const name of Object.keys(parsed.mcpServers).sort()) {
    if (!isValidServerName(name)) continue;
    const portable = toPortableServer(parsed.mcpServers[name]);
    if (portable) servers[name] = portable;
  }
  return servers;
}

function sameServer(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (REMOTE_TYPES.has(a.type)) return a.url === b.url;
  return a.command === b.command && JSON.stringify(a.args || []) === JSON.stringify(b.args || []);
}

// advisory 從不刪除，故「本機額外」只回報、不產生任何指令（design D4）。
function diffClaudeServers(localServers, repoServers, direction) {
  const names = [...new Set([...Object.keys(repoServers), ...Object.keys(localServers)])].sort();
  const results = [];
  for (const name of names) {
    const local = localServers[name];
    const repo = repoServers[name];
    let status = null;
    if (direction === 'to-local') {
      if (repo && !local) status = 'new';
      else if (repo && !sameServer(local, repo)) status = 'changed';
      else if (!repo && local) status = 'local-only';
    } else if (local && !repo) status = 'new';
    else if (local && repo && !sameServer(local, repo)) status = 'changed';
    else if (!local && repo) status = 'deleted';
    if (status) results.push({ name, status });
  }
  return results;
}

// -----------------------------------------------------------------------------
// 建議指令產生
// -----------------------------------------------------------------------------

function shellQuote(value) {
  return /^[A-Za-z0-9_@./:=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildAddCommand(name, server) {
  const parts = ['claude', 'mcp', 'add'];
  if (REMOTE_TYPES.has(server.type)) parts.push('--transport', server.type);
  parts.push('--scope', 'user');
  for (const key of server.envKeys || []) parts.push('-e', `${key}=<值>`);
  parts.push(shellQuote(name));
  if (REMOTE_TYPES.has(server.type)) parts.push(shellQuote(server.url));
  else parts.push('--', shellQuote(server.command), ...(server.args || []).map(shellQuote));
  return parts.join(' ');
}

function buildAdvice(name, server, status) {
  if (status === 'local-only') {
    return { name, status, command: null, note: '本機額外，未登記於 repo（如需納入請執行 to-repo）' };
  }
  const command = buildAddCommand(name, server);
  const note = (server.envKeys || []).length
    ? `需自行填入 ${server.envKeys.join('、')} 的值`
    : (REMOTE_TYPES.has(server.type) ? '加入後於 Claude Code 執行 /mcp 完成認證' : null);
  return { name, status, command, note };
}

// -----------------------------------------------------------------------------
// Handler（DI）
// -----------------------------------------------------------------------------

function wrapValidation(err, deps, filePath) {
  if (!(err instanceof McpValidationError)) throw err;
  const context = { path: filePath, fields: err.paths.join('、') };
  if (err.paths.some(p => p.endsWith('.url') || p.includes('.args['))) {
    context.hint = '若確認該欄位不含憑證，請改用 envKeys 或於本機手動維護；本工具不提供繞過旗標';
  }
  throw new deps.SyncError('Claude MCP 設定驗證失敗', deps.ERR.INVALID_ARGS, context);
}

function createClaudeMcpHandler(deps) {
  const { readJson, readFileSafe, writeFileSafe } = deps;

  function loadManifest(filePath) {
    if (!fs.existsSync(filePath)) return { version: 1, servers: {} };
    try { return validateClaudeMcpManifest(readJson(filePath)); }
    catch (err) { wrapValidation(err, deps, filePath); }
  }

  // 檔不存在 = 這台機器還沒有任何 MCP，是正常狀態而非錯誤。
  function loadLocal(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const content = String(readFileSafe(filePath, '讀取 Claude MCP 設定', 'utf8'));
    try { return readLocalServers(content); }
    catch (err) { wrapValidation(err, deps, filePath); }
  }

  function inspect(item, direction) {
    const manifest = loadManifest(item.dest);
    const local = loadLocal(item.src);
    return { manifest, local, changes: diffClaudeServers(local, manifest.servers, direction) };
  }

  function makeEntries(item, changes) {
    return changes.map(change => ({
      ...change,
      label: `${item.prefix || 'claude/'}${item.label}/${change.name}`,
      src: item.src, dest: item.dest, verboseSrc: item.src, verboseDest: item.dest, itemType: 'advisory',
    }));
  }

  function diffItem(item, direction) {
    return makeEntries(item, inspect(item, direction).changes);
  }

  // to-local 只產生建議，永不觸碰 item.src。
  function adviseLocal(item, data) {
    return data.changes.map(change => ({
      action: 'advice',
      label: `${item.prefix || 'claude/'}${item.label}/${change.name}`,
      ...buildAdvice(change.name, data.manifest.servers[change.name] || data.local[change.name], change.status),
    }));
  }

  function writeRepo(item, data, dryRun) {
    const next = serializeClaudeMcpManifest({ version: 1, servers: data.local });
    const current = serializeClaudeMcpManifest(data.manifest);
    if (!dryRun && next !== current) writeFileSafe(item.dest, next, '寫入 Claude MCP manifest');
    return data.changes.map(change => ({
      action: change.status === 'new' ? 'added' : change.status === 'deleted' ? 'deleted' : 'updated',
      label: `${item.prefix || 'claude/'}${item.label}/${change.name}`,
    }));
  }

  function applyItem(item, direction, dryRun) {
    const data = inspect(item, direction);
    return direction === 'to-local' ? adviseLocal(item, data) : writeRepo(item, data, dryRun);
  }

  return { diffItem, applyItem, loadManifest };
}

module.exports = {
  createClaudeMcpHandler,
  validateClaudeMcpManifest,
  serializeClaudeMcpManifest,
  readLocalServers,
  toPortableServer,
  diffClaudeServers,
  sameServer,
  buildAddCommand,
  buildAdvice,
  COMMAND_ALLOWLIST,
};
