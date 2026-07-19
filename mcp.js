'use strict';

// =============================================================================
// mcp.js -- Codex MCP 可攜來源、TOML section 投影與本機受管 state
// 不反向 require sync.js；共用 IO／錯誤類型由 createMcpHandler(deps) 注入。
// =============================================================================

const fs = require('fs');
const { readTomlStatements, splitTomlKey } = require('./toml-reader.js');

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const SERVER_FIELDS = new Set(['transport', 'url', 'enabled']);
const STATE_VERSION = 1;

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

function validateServer(name, server, paths) {
  const base = `servers.${name}`;
  if (!isValidServerName(name)) paths.push(base);
  if (!isPlainObject(server)) { paths.push(base); return null; }
  for (const key of Object.keys(server)) {
    if (!SERVER_FIELDS.has(key)) paths.push(`${base}.${key}`);
  }
  if (server.transport !== 'streamable-http') paths.push(`${base}.transport`);
  if (!isHttpsUrl(server.url)) paths.push(`${base}.url`);
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

function encodeTomlBasicString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

function decodeTomlBasicString(value) {
  const trimmed = value.trim();
  if (!/^"(?:[^"\\\x00-\x1f]|\\["\\bfnrt])*"(?:\s*#.*)?$/.test(trimmed)) return null;
  const literal = trimmed.replace(/\s*#.*$/, '');
  try { return JSON.parse(literal); } catch (_) { return null; }
}

function isLocalAuthorizationHeaders(value) {
  const basic = '"(?:[^"\\\\\\x00-\\x1f]|\\\\["\\\\bfnrt])*"';
  const pattern = new RegExp(`^\\s*\\{\\s*(?:Authorization|"Authorization")\\s*=\\s*${basic}\\s*\\}\\s*(?:#.*)?$`);
  return pattern.test(value);
}

function serializeMcpSection(name, server, eol = '\n') {
  const lines = [
    `[mcp_servers.${encodeTomlBasicString(name)}]`,
    `url = ${encodeTomlBasicString(server.url)}`,
    `enabled = ${server.enabled ? 'true' : 'false'}`,
  ];
  if (server.localAuthLine) lines.push(server.localAuthLine);
  return lines.join(eol) + eol;
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

function parseMcpRange(range, statements) {
  const values = {};
  let localAuthLine = null;
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
      if (localAuthLine || !isLocalAuthorizationHeaders(st.value)) {
        throw new McpValidationError([`mcp_servers.${range.name}.http_headers`]);
      }
      localAuthLine = st.raw;
      continue;
    }
    if (!['url', 'enabled'].includes(key) || Object.prototype.hasOwnProperty.call(values, key)) {
      throw new McpValidationError([`mcp_servers.${range.name}.${key || st.key}`]);
    }
    values[key] = key === 'url' ? decodeTomlBasicString(st.value) : parseEnabled(st.value);
    if (values[key] === null) throw new McpValidationError([`mcp_servers.${range.name}.${key}`]);
  }
  if (!isHttpsUrl(values.url)) throw new McpValidationError([`mcp_servers.${range.name}.url`]);
  return { transport: 'streamable-http', url: values.url, enabled: values.enabled ?? true, localAuthLine };
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

function validateMcpState(input) {
  if (!isPlainObject(input) || input.version !== STATE_VERSION || !Array.isArray(input.managedServers)) {
    throw new McpValidationError(['managed state']);
  }
  if (input.managedServers.some(name => typeof name !== 'string' || !isValidServerName(name))) {
    throw new McpValidationError(['managed state.managedServers']);
  }
  return { version: STATE_VERSION, managedServers: normalizeNames(input.managedServers) };
}

function serializeMcpState(names) {
  return JSON.stringify({ version: STATE_VERSION, managedServers: normalizeNames(names) }, null, 2) + '\n';
}

function removeRanges(content, ranges) {
  let result = content;
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, range.start) + result.slice(range.end);
  }
  return result;
}

function appendManagedSections(content, servers, localSections = {}) {
  const names = Object.keys(servers).sort();
  if (!names.length) return content;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  let result = content;
  if (result && !result.endsWith(eol)) result += eol;
  if (result && !result.endsWith(eol + eol)) result += eol;
  return result + names.map(name => serializeMcpSection(name, {
    ...servers[name], localAuthLine: localSections[name]?.localAuthLine || null,
  }, eol)).join(eol);
}

function projectToLocal(content, manifest, state) {
  const repoNames = Object.keys(manifest.servers).sort();
  const staleNames = state.managedServers.filter(name => !manifest.servers[name]);
  const parsed = parseMcpConfig(content, [...repoNames, ...staleNames]);
  const repoChanged = repoNames.some(name => !sameServer(parsed.sections[name], manifest.servers[name]));
  const stalePresent = staleNames.some(name => Boolean(parsed.sections[name]));
  const removeNames = new Set([...repoNames, ...staleNames]);
  const remove = parsed.ranges.filter(range => removeNames.has(range.name));
  const nextContent = repoChanged || stalePresent
    ? appendManagedSections(removeRanges(content, remove), manifest.servers, parsed.sections)
    : content;
  return { content: nextContent, managedServers: repoNames, parsed, staleNames };
}

function projectToRepo(content, manifest, state) {
  const managed = normalizeNames([...Object.keys(manifest.servers), ...state.managedServers]);
  const parsed = parseMcpConfig(content, managed);
  const servers = {};
  for (const name of managed) {
    if (!parsed.sections[name]) continue;
    const { url, enabled } = parsed.sections[name];
    servers[name] = { transport: 'streamable-http', url, enabled };
  }
  return validateMcpManifest({ version: 1, servers });
}

function diffServerSets(localServers, repoServers, direction, stateNames = []) {
  const results = [];
  const names = normalizeNames([...Object.keys(repoServers), ...stateNames]);
  for (const name of names) {
    const local = localServers[name];
    const repo = repoServers[name];
    let status = null;
    if (direction === 'to-local') {
      if (repo && !local) status = 'new';
      else if (repo && (!sameServer(local, repo) || !stateNames.includes(name))) status = 'changed';
      else if (!repo && stateNames.includes(name)) status = 'deleted';
    } else if (local && !repo) status = 'new';
    else if (local && repo && !sameServer(local, repo)) status = 'changed';
    else if (!local && repo) status = 'deleted';
    if (status) results.push({ name, status });
  }
  return results;
}

function wrapValidation(err, deps, filePath) {
  if (!(err instanceof McpValidationError)) throw err;
  throw new deps.SyncError('Codex MCP 設定驗證失敗', deps.ERR.INVALID_ARGS, {
    path: filePath, fields: err.paths.join('、'),
  });
}

function createMcpHandler(deps) {
  const { readJson, readFileSafe, writeFileSafe, statePath } = deps;

  function loadManifest(filePath) {
    if (!fs.existsSync(filePath)) return { version: 1, servers: {} };
    try { return validateMcpManifest(readJson(filePath)); }
    catch (err) { wrapValidation(err, deps, filePath); }
  }

  function loadState() {
    if (!fs.existsSync(statePath)) return { version: STATE_VERSION, managedServers: [] };
    try { return validateMcpState(readJson(statePath)); }
    catch (err) { wrapValidation(err, deps, statePath); }
  }

  function loadConfig(filePath) {
    if (!fs.existsSync(filePath)) return '';
    return String(readFileSafe(filePath, '讀取 Codex MCP 設定', 'utf8'));
  }

  function makeEntries(item, changes) {
    return changes.map(change => ({
      ...change,
      label: `${item.prefix || 'codex/'}${item.label}/${change.name}`,
      src: item.src, dest: item.dest, verboseSrc: item.src, verboseDest: item.dest, itemType: 'mcp',
    }));
  }

  function inspect(item, direction) {
    const manifest = loadManifest(item.dest);
    const state = loadState();
    const content = loadConfig(item.src);
    const managed = normalizeNames([...Object.keys(manifest.servers), ...state.managedServers]);
    let parsed;
    try { parsed = parseMcpConfig(content, managed); }
    catch (err) { wrapValidation(err, deps, item.src); }
    const local = Object.fromEntries(Object.entries(parsed.sections).map(([name, value]) => [name, value]));
    return { manifest, state, content, parsed, changes: diffServerSets(local, manifest.servers, direction, state.managedServers) };
  }

  function diffMcpItem(item, direction) {
    const data = inspect(item, direction);
    return makeEntries(item, data.changes);
  }

  function writeLocalProjection(item, data, dryRun) {
    let projected;
    try { projected = projectToLocal(data.content, data.manifest, data.state); }
    catch (err) { wrapValidation(err, deps, item.src); }
    const stateText = serializeMcpState(projected.managedServers);
    const currentStateText = fs.existsSync(statePath)
      ? String(readFileSafe(statePath, '讀取 Codex MCP 受管狀態', 'utf8')) : '';
    const configChanged = projected.content !== data.content;
    const stateChanged = stateText !== currentStateText;
    if (!dryRun && configChanged) writeFileSafe(item.src, projected.content, '寫入 Codex MCP 設定');
    if (!dryRun && stateChanged) {
      try { writeFileSafe(statePath, stateText, '寫入 Codex MCP 受管狀態'); }
      catch (err) {
        if (configChanged && err instanceof deps.SyncError) {
          err.context.partialChanges = data.changes.map(c => ({ action: statusAction(c.status), rel: c.name }));
        }
        throw err;
      }
    }
    return data.changes;
  }

  function writeRepoProjection(item, data, dryRun) {
    let projected;
    try { projected = projectToRepo(data.content, data.manifest, data.state); }
    catch (err) { wrapValidation(err, deps, item.src); }
    const next = serializeMcpManifest(projected);
    const current = serializeMcpManifest(data.manifest);
    if (!dryRun && next !== current) writeFileSafe(item.dest, next, '寫入 Codex MCP manifest');
    return data.changes;
  }

  function applyMcpItem(item, direction, dryRun) {
    const data = inspect(item, direction);
    const changes = direction === 'to-local'
      ? writeLocalProjection(item, data, dryRun)
      : writeRepoProjection(item, data, dryRun);
    return makeEntries(item, changes).map(entry => ({ action: statusAction(entry.status), label: entry.label }));
  }

  return { diffMcpItem, applyMcpItem, loadManifest, loadState };
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
  encodeTomlBasicString,
  decodeTomlBasicString,
  isLocalAuthorizationHeaders,
  serializeMcpSection,
  collectSectionRanges,
  parseMcpConfig,
  validateMcpState,
  serializeMcpState,
  projectToLocal,
  projectToRepo,
  diffServerSets,
};
