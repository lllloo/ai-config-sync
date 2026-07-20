'use strict';

// =============================================================================
// mcp.js -- MCP 可攜來源 schema、憑證判準，與 Codex 端的唯讀比對
//
// 本檔對本機端「只讀不寫」：不再重寫 `~/.codex/config.toml`。隨之消失的是一整組
// 只為「安全改寫本機活檔」而存在的機制——TOML 文字重組（removeRanges／
// appendManagedSections）、受管 state 檔，以及本機 http_headers.Authorization 的
// surgical preservation。最後一項的存在理由字面上就是「我們要重寫這個檔案但不能
// 弄丟使用者的憑證」；不再重寫，需求即消失（見 design D6）。
//
// 保留的是有價值的唯讀半部：section 解析、集合比對、以及讀回 repo 的投影。
// 寫入只發生在 repo 端（`codex/mcp.json`），由 deps.writeFileSafe 負責。
// 不反向 require sync.js；共用 IO／錯誤類型由 createMcpHandler(deps) 注入。
// =============================================================================

const fs = require('fs');
const { readTomlStatements, splitTomlKey } = require('./toml-reader.js');

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const SERVER_FIELDS = new Set(['transport', 'url', 'enabled']);

class McpValidationError extends Error {
  constructor(paths) {
    super('MCP manifest 驗證失敗');
    this.name = 'McpValidationError';
    this.paths = [...new Set(paths)].sort();
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidServerName(name) {
  return SERVER_NAME_PATTERN.test(name) && !/[\x00-\x1f\x7f]/.test(name);
}

function isHttpsUrl(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && url.username === '' && url.password === '';
  } catch (_) {
    return false;
  }
}

// -----------------------------------------------------------------------------
// 憑證判準（fail closed）
// url 的 pathname／query 與 stdio args 皆須通過。判準為「無法判定為安全即拒絕」，
// 不是比對已知 secret pattern——Zapier／Composio 類 opaque token（純 base64、無
// vendor 前綴）對黑名單完全免疫，只能靠「這段東西看起來不像人寫的路徑」來擋。
// 誤擋合法長路徑是刻意的代價，不提供繞過旗標（見 design D3）。
// -----------------------------------------------------------------------------

const SUSPICIOUS_CHUNK_LENGTH = 12;

// 判準：看「最長的連續英數字塊」。人寫的路徑與 npm specifier 會被 `-`／`.`／`@`／`/`
// 切成可讀短塊（`mcp-remote@latest` → mcp／remote／latest）；token 則是一整段無分隔
// 的隨機字元。夠長又含數字的塊即視為憑證。
// 已知漏接：純字母無數字的長 token。收緊到「長塊即可疑」會誤擋 `documentation`
// 這類正常路徑段，取捨後選擇保留數字條件。
function isSuspiciousToken(value) {
  if (typeof value !== 'string') return true;
  for (const chunk of value.split(/[^A-Za-z0-9]+/)) {
    if (chunk.length >= SUSPICIOUS_CHUNK_LENGTH && /[0-9]/.test(chunk)) return true;
  }
  return false;
}

function findUrlCredentialPaths(value, base) {
  let url;
  try { url = new URL(value); } catch (_) { return [base]; }
  for (const segment of url.pathname.split('/')) {
    if (!segment) continue;
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch (_) { return [base]; }
    if (isSuspiciousToken(decoded)) return [base];
  }
  for (const [, paramValue] of url.searchParams) {
    if (isSuspiciousToken(paramValue)) return [base];
  }
  return [];
}

function findArgsCredentialPaths(args, base) {
  const paths = [];
  args.forEach((arg, index) => {
    const argPath = `${base}.args[${index}]`;
    if (typeof arg !== 'string') { paths.push(argPath); return; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) {
      if (findUrlCredentialPaths(arg, argPath).length) paths.push(argPath);
      return;
    }
    if (isSuspiciousToken(arg)) paths.push(argPath);
  });
  return paths;
}

// -----------------------------------------------------------------------------
// Repo 來源 schema
// -----------------------------------------------------------------------------

function validateServer(name, server, paths) {
  const base = `servers.${name}`;
  if (!isValidServerName(name)) paths.push(base);
  if (!isPlainObject(server)) { paths.push(base); return null; }
  for (const key of Object.keys(server)) {
    if (!SERVER_FIELDS.has(key)) paths.push(`${base}.${key}`);
  }
  if (server.transport !== 'streamable-http') paths.push(`${base}.transport`);
  if (!isHttpsUrl(server.url)) paths.push(`${base}.url`);
  else paths.push(...findUrlCredentialPaths(server.url, `${base}.url`));
  if (typeof server.enabled !== 'boolean') paths.push(`${base}.enabled`);
  return { transport: 'streamable-http', url: server.url, enabled: server.enabled };
}

function validateMcpManifest(input) {
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

function serializeMcpManifest(input) {
  return JSON.stringify(validateMcpManifest(input), null, 2) + '\n';
}

// -----------------------------------------------------------------------------
// config.toml 唯讀解析
// -----------------------------------------------------------------------------

function decodeTomlBasicString(value) {
  const trimmed = value.trim();
  if (!/^"(?:[^"\\\x00-\x1f]|\\["\\bfnrt])*"(?:\s*#.*)?$/.test(trimmed)) return null;
  const literal = trimmed.replace(/\s*#.*$/, '');
  try { return JSON.parse(literal); } catch (_) { return null; }
}

// 本機 Authorization 是使用者自己填的 overlay。唯讀模式下它既不會被覆寫也不會被
// 讀出值，但仍要能辨識「這一行是單一 Authorization header」——否則無法區分它與
// 其他未知 header，只能整段 fail closed。
function isLocalAuthorizationHeaders(value) {
  const basic = '"(?:[^"\\\\\\x00-\\x1f]|\\\\["\\\\bfnrt])*"';
  const pattern = new RegExp(`^\\s*\\{\\s*(?:Authorization|"Authorization")\\s*=\\s*${basic}\\s*\\}\\s*(?:#.*)?$`);
  return pattern.test(value);
}

function lineOffsets(content) {
  const offsets = [0];
  for (let i = 0; i < content.length; i += 1) if (content[i] === '\n') offsets.push(i + 1);
  return offsets;
}

function sectionName(statement) {
  if (statement.name === null) return { malformed: true };
  const parts = splitTomlKey(statement.name);
  if (parts[0] !== 'mcp_servers') return null;
  if (statement.arrayTable || parts.length < 2 || !isValidServerName(parts[1])) return { malformed: true };
  return { name: parts[1], nested: parts.length > 2 };
}

function collectSectionRanges(content) {
  const statements = readTomlStatements(content);
  const headers = statements.filter(st => st.type === 'section');
  const offsets = lineOffsets(content);
  const ranges = [];
  const nestedNames = new Set();
  for (let i = 0; i < headers.length; i += 1) {
    const info = sectionName(headers[i]);
    if (headers[i].name === null || info?.malformed) throw new McpValidationError([`config.toml:line ${headers[i].line}`]);
    if (!info) continue;
    if (info.nested) { nestedNames.add(info.name); continue; }
    let nextIndex = i + 1;
    while (nextIndex < headers.length) {
      const nextInfo = sectionName(headers[nextIndex]);
      if (!nextInfo?.nested || nextInfo.name !== info.name) break;
      nextIndex += 1;
    }
    const next = headers[nextIndex];
    ranges.push({
      name: info.name,
      start: offsets[headers[i].line - 1],
      end: next ? offsets[next.line - 1] : content.length,
      startLine: headers[i].line,
      endLine: next ? next.line : Number.MAX_SAFE_INTEGER,
    });
  }
  const seen = new Set();
  for (const range of ranges) {
    if (seen.has(range.name)) throw new McpValidationError([`mcp_servers.${range.name}`]);
    seen.add(range.name);
  }
  return { statements, ranges, nestedNames };
}

function parseEnabled(value) {
  const bare = value.replace(/\s*#.*$/, '').trim();
  if (bare === 'true') return true;
  if (bare === 'false') return false;
  return null;
}

// 受管 section 出現看不懂的 key 仍 fail closed。理由已從「我們要重寫它」改為
// 「比對結論不可信」——寧可報錯讓人工檢視，也不要輸出一份可能錯誤的 add 指令。
function parseMcpRange(range, statements) {
  const values = {};
  let sawAuthHeader = false;
  for (const st of statements) {
    if (st.line <= range.startLine || st.line >= range.endLine) continue;
    if (st.type === 'other') {
      if (st.raw.trim() && !st.raw.trim().startsWith('#')) throw new McpValidationError([`mcp_servers.${range.name}:line ${st.line}`]);
      continue;
    }
    if (st.type !== 'kv') continue;
    const parts = splitTomlKey(st.key);
    const key = parts.length === 1 ? parts[0] : '';
    if (key === 'http_headers') {
      if (sawAuthHeader || !isLocalAuthorizationHeaders(st.value)) {
        throw new McpValidationError([`mcp_servers.${range.name}.http_headers`]);
      }
      sawAuthHeader = true;
      continue;
    }
    if (!['url', 'enabled'].includes(key) || Object.prototype.hasOwnProperty.call(values, key)) {
      throw new McpValidationError([`mcp_servers.${range.name}.${key || st.key}`]);
    }
    values[key] = key === 'url' ? decodeTomlBasicString(st.value) : parseEnabled(st.value);
    if (values[key] === null) throw new McpValidationError([`mcp_servers.${range.name}.${key}`]);
  }
  if (!isHttpsUrl(values.url)) throw new McpValidationError([`mcp_servers.${range.name}.url`]);
  return { transport: 'streamable-http', url: values.url, enabled: values.enabled ?? true };
}

function parseMcpConfig(content, managedNames = null) {
  const { statements, ranges, nestedNames } = collectSectionRanges(content);
  const selected = managedNames ? new Set(managedNames) : null;
  const sections = {};
  for (const range of ranges) {
    if (selected && !selected.has(range.name)) continue;
    if (nestedNames.has(range.name)) throw new McpValidationError([`mcp_servers.${range.name}`]);
    sections[range.name] = { ...parseMcpRange(range, statements), range };
  }
  return { sections, ranges, nestedNames };
}

function sameServer(a, b) {
  return Boolean(a && b && a.url === b.url && a.enabled === b.enabled);
}

function normalizeNames(names) {
  return [...new Set(names)].sort();
}

// 受管範圍 = repo manifest 登記的名字。移除 state 後不再有「上次寫過的名字」，
// 故本機新增的 Server 不會被自動吸入 repo；它會在 diff 以 local-only 現身，
// 由使用者決定是否手動登記（與 skills:diff 同模式）。
function projectToRepo(content, manifest) {
  const managed = normalizeNames(Object.keys(manifest.servers));
  const parsed = parseMcpConfig(content, managed);
  const servers = {};
  for (const name of managed) {
    if (!parsed.sections[name]) continue;
    const { url, enabled } = parsed.sections[name];
    servers[name] = { transport: 'streamable-http', url, enabled };
  }
  return validateMcpManifest({ version: 1, servers });
}

// advisory 從不刪除，故本機額外只標示為 local-only（design D4）。
function diffServerSets(localServers, repoServers, direction, localOnlyNames = []) {
  const results = [];
  const names = normalizeNames([...Object.keys(repoServers), ...Object.keys(localServers), ...localOnlyNames]);
  for (const name of names) {
    const local = localServers[name];
    const repo = repoServers[name];
    let status = null;
    if (direction === 'to-local') {
      if (repo && !local) status = 'new';
      else if (repo && !sameServer(local, repo)) status = 'changed';
      else if (!repo) status = 'local-only';
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
  return `codex mcp add ${shellQuote(name)} --url ${shellQuote(server.url)}`;
}

function buildAdvice(name, server, status) {
  if (status === 'local-only') {
    return { name, status, command: null, note: '本機額外，未登記於 repo（如需納入請手動加進 codex/mcp.json）' };
  }
  const notes = [`加入後執行 codex mcp login ${name} 完成認證`];
  // CLI 沒有對應旗標，停用狀態只能提示人工處理，不能假裝指令能表達它
  if (server && server.enabled === false) notes.push('repo 標記為停用，需自行於 config.toml 設 enabled = false');
  return { name, status, command: buildAddCommand(name, server), note: notes.join('；') };
}

// -----------------------------------------------------------------------------
// Handler（DI）
// -----------------------------------------------------------------------------

function wrapValidation(err, deps, filePath) {
  if (!(err instanceof McpValidationError)) throw err;
  const context = { path: filePath, fields: err.paths.join('、') };
  // 憑證判準是 fail closed 且無繞過旗標，誤擋時使用者需要知道替代路徑
  if (err.paths.some(p => p.endsWith('.url') || p.includes('.args['))) {
    context.hint = '若確認該欄位不含憑證，請改用 envKeys 或於本機手動維護；本工具不提供繞過旗標';
  }
  throw new deps.SyncError('Codex MCP 設定驗證失敗', deps.ERR.INVALID_ARGS, context);
}

function createMcpHandler(deps) {
  const { readJson, readFileSafe, writeFileSafe } = deps;

  function loadManifest(filePath) {
    if (!fs.existsSync(filePath)) return { version: 1, servers: {} };
    try { return validateMcpManifest(readJson(filePath)); }
    catch (err) { wrapValidation(err, deps, filePath); }
  }

  function loadConfig(filePath) {
    if (!fs.existsSync(filePath)) return '';
    return String(readFileSafe(filePath, '讀取 Codex MCP 設定', 'utf8'));
  }

  function makeEntries(item, changes) {
    return changes.map(change => ({
      ...change,
      label: `${item.prefix || 'codex/'}${item.label}/${change.name}`,
      src: item.src, dest: item.dest, verboseSrc: item.src, verboseDest: item.dest, itemType: 'advisory',
    }));
  }

  function inspect(item, direction) {
    const manifest = loadManifest(item.dest);
    const content = loadConfig(item.src);
    let parsed;
    try { parsed = parseMcpConfig(content, Object.keys(manifest.servers)); }
    catch (err) { wrapValidation(err, deps, item.src); }
    const localOnly = parsed.ranges.map(r => r.name).filter(name => !manifest.servers[name]);
    const changes = diffServerSets(parsed.sections, manifest.servers, direction, localOnly);
    return { manifest, content, parsed, changes };
  }

  function diffItem(item, direction) {
    return makeEntries(item, inspect(item, direction).changes);
  }

  // to-local 只產生建議，永不觸碰 item.src。
  function adviseLocal(item, data) {
    return data.changes.map(change => ({
      action: 'advice',
      label: `${item.prefix || 'codex/'}${item.label}/${change.name}`,
      ...buildAdvice(change.name, data.manifest.servers[change.name], change.status),
    }));
  }

  function writeRepoProjection(item, data, dryRun) {
    let projected;
    try { projected = projectToRepo(data.content, data.manifest); }
    catch (err) { wrapValidation(err, deps, item.src); }
    const next = serializeMcpManifest(projected);
    const current = serializeMcpManifest(data.manifest);
    if (!dryRun && next !== current) writeFileSafe(item.dest, next, '寫入 Codex MCP manifest');
    return data.changes
      .filter(change => change.status !== 'local-only')
      .map(change => ({ action: statusAction(change.status), label: `${item.prefix || 'codex/'}${item.label}/${change.name}` }));
  }

  function applyItem(item, direction, dryRun) {
    const data = inspect(item, direction);
    return direction === 'to-local' ? adviseLocal(item, data) : writeRepoProjection(item, data, dryRun);
  }

  return { diffItem, applyItem, loadManifest };
}

function statusAction(status) {
  if (status === 'new') return 'added';
  if (status === 'deleted') return 'deleted';
  return 'updated';
}

module.exports = {
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
  sameServer,
  buildAddCommand,
  buildAdvice,
};
