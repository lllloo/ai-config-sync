'use strict';

// =============================================================================
// toml-reader.js 純函式單元測試
//
// 這組測試是 safety:check TOML 掃描的回歸網：readTomlStatements 的 section 歸屬
// 正確性直接決定 hard block（機密 section）與 warning 的判斷。原本這些跨行語法
// 案例是透過 codex-config 的 parse/serialize 間接覆蓋；config.toml 同步移除後，
// 改為直接針對讀取器斷言，避免解析器失去回歸保護。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readTomlStatements,
  matchTomlHeader,
  splitTomlKey,
  isIncompleteTomlValue,
} = require('../toml-reader.js');

/**
 * 取出 statement 串流中的 kv，附上其所屬 section（鏡射 safety-check 的歸屬邏輯：
 * malformed header（name === null）清空 section，不沿用前一個）
 */
function kvsWithSection(content) {
  const result = [];
  let section = '';
  for (const st of readTomlStatements(content)) {
    if (st.type === 'section') { section = st.name === null ? '' : st.name; continue; }
    if (st.type === 'kv') result.push({ section, key: st.key, value: st.value });
  }
  return result;
}

// -----------------------------------------------------------------------------
// matchTomlHeader：table / array-of-tables / 合法變體
// -----------------------------------------------------------------------------
test('matchTomlHeader：一般 table 與 array-of-tables 分別辨識', () => {
  assert.deepEqual(matchTomlHeader('[features]'), { type: 'section', name: 'features', arrayTable: false });
  assert.deepEqual(matchTomlHeader('[[model_providers]]'), { type: 'section', name: 'model_providers', arrayTable: true });
});

test('matchTomlHeader：尾註解與內部空白等合法變體', () => {
  assert.equal(matchTomlHeader('[tui] # 註解').name, 'tui');
  assert.equal(matchTomlHeader('[ tui ]').name, 'tui');
  assert.equal(matchTomlHeader('[mcp_servers.myserver]').name, 'mcp_servers.myserver');
});

test('matchTomlHeader：非 header 行回傳 null', () => {
  assert.equal(matchTomlHeader('theme = "dark"'), null);
  assert.equal(matchTomlHeader('# [features]'), null);
});

// 回歸（F2）：section 名含 ] 的引號 key。舊 regex `[^\]]+` 會在引號內的 ] 提前
// 截斷、整行判為非 header，使其下的 key 誤掛前一 section——safety:check 的機密
// section hard block 因此靜默降級成 warning（exit 2 → exit 1）。
test('matchTomlHeader：引號 section 名內含 ] 不提前截斷', () => {
  assert.deepEqual(matchTomlHeader('[mcp_servers."weird]name"]'),
    { type: 'section', name: 'mcp_servers."weird]name"', arrayTable: false });
  assert.deepEqual(matchTomlHeader('[projects."/home/a]b"]'),
    { type: 'section', name: 'projects."/home/a]b"', arrayTable: false });
  assert.deepEqual(matchTomlHeader('[[model_providers."x]y"]]'),
    { type: 'section', name: 'model_providers."x]y"', arrayTable: true });
});

test('matchTomlHeader：引號 section 名內含跳脫引號', () => {
  assert.equal(matchTomlHeader('[a."b\\"c]d"]').name, 'a."b\\"c]d"');
  assert.equal(matchTomlHeader("[a.'b]c']").name, "a.'b]c'");
});

test('matchTomlHeader：malformed header 一律回 null', () => {
  assert.equal(matchTomlHeader('[mcp_servers'), null, '未閉合');
  assert.equal(matchTomlHeader('[[x]'), null, 'array-of-tables 缺一個閉合');
  assert.equal(matchTomlHeader('[x]]'), null, 'table 多一個閉合');
  assert.equal(matchTomlHeader('[]'), null, '空 section 名');
  assert.equal(matchTomlHeader('[a."unterminated]'), null, '引號未閉合');
  assert.equal(matchTomlHeader('[x] junk'), null, '尾端有非註解內容');
});

// -----------------------------------------------------------------------------
// splitTomlKey：引號感知的 dotted 片段切段 + 去引號
// safety-check 以此正規化 section 名，杜絕 `["mcp_servers"]` 繞過 hard block（見 A 修正）。
// -----------------------------------------------------------------------------
test('splitTomlKey：純識別字與 dotted section 名', () => {
  assert.deepEqual(splitTomlKey('mcp_servers'), ['mcp_servers']);
  assert.deepEqual(splitTomlKey('mcp_servers.openai'), ['mcp_servers', 'openai']);
});

test('splitTomlKey：包夾引號的片段被去引號（等同未引號語意）', () => {
  assert.deepEqual(splitTomlKey('"mcp_servers"'), ['mcp_servers'], '基本字串 section 名');
  assert.deepEqual(splitTomlKey("'model_providers'"), ['model_providers'], '字面字串 section 名');
  assert.deepEqual(splitTomlKey('"mcp_servers".openai'), ['mcp_servers', 'openai'], '引號首段 + 子表');
});

test('splitTomlKey：引號內的 . 不視為分隔', () => {
  assert.deepEqual(splitTomlKey('mcp_servers."a.b"'), ['mcp_servers', 'a.b']);
  assert.deepEqual(splitTomlKey('projects."/home/a.b"'), ['projects', '/home/a.b']);
});

test('splitTomlKey：header 內部空白不影響片段', () => {
  assert.deepEqual(splitTomlKey('mcp_servers . openai'), ['mcp_servers', 'openai']);
});

// -----------------------------------------------------------------------------
// isIncompleteTomlValue：跨行續行偵測
// -----------------------------------------------------------------------------
test('isIncompleteTomlValue：未閉合陣列與三引號字串判為未完結', () => {
  assert.equal(isIncompleteTomlValue('['), true);
  assert.equal(isIncompleteTomlValue('"""'), true);
  assert.equal(isIncompleteTomlValue('[1, 2]'), false);
  assert.equal(isIncompleteTomlValue('"dark"'), false);
});

test('isIncompleteTomlValue：字串／註解內的 ] 不計入括號深度', () => {
  assert.equal(isIncompleteTomlValue('["a]b"]'), false, '引號內的 ] 不得減少深度');
  assert.equal(isIncompleteTomlValue('[ # 註解含 ]'), true, '註解內的 ] 不得閉合陣列');
});

// -----------------------------------------------------------------------------
// readTomlStatements：跨行語法完整保留 + section 歸屬正確
// -----------------------------------------------------------------------------
test('readTomlStatements：多行陣列併入續行，其後 key 仍歸屬同 section', () => {
  const kvs = kvsWithSection(`[tui]
notifications = [
  "agent-turn-complete",
  "approval-requested",
]
theme = "dark"
`);
  assert.equal(kvs.length, 2);
  assert.equal(kvs[0].key, 'notifications');
  assert.ok(kvs[0].value.includes('agent-turn-complete'));
  assert.ok(kvs[0].value.includes('approval-requested'));
  assert.deepEqual(kvs[1], { section: 'tui', key: 'theme', value: '"dark"' },
    '陣列後的 key 不得掉出 section');
});

test('readTomlStatements：多行三引號字串併入續行', () => {
  const kvs = kvsWithSection(`[features]
note = """
line1
line2
"""
enabled = true
`);
  assert.equal(kvs.length, 2);
  assert.ok(kvs[0].value.includes('line1') && kvs[0].value.includes('line2'));
  assert.deepEqual(kvs[1], { section: 'features', key: 'enabled', value: 'true' });
});

test('readTomlStatements：陣列元素字串內含 ] 與 # 不提前截斷', () => {
  const kvs = kvsWithSection(`[tui]
notifications = [
  "a]b#c",
  "plain",
]
theme = "x"
`);
  assert.ok(kvs[0].value.includes('a]b#c'), '含 ]/# 的字串元素須完整保留');
  assert.deepEqual(kvs[1], { section: 'tui', key: 'theme', value: '"x"' });
});

test('readTomlStatements：陣列中含 ] 的整行註解不誤閉合陣列', () => {
  const kvs = kvsWithSection(`[tui]
notifications = [
  # 這行註解含 ] 不應閉合陣列
  "a",
]
theme = "x"
`);
  assert.equal(kvs.length, 2);
  assert.deepEqual(kvs[1], { section: 'tui', key: 'theme', value: '"x"' },
    '註解內的 ] 不得使 theme 掉出 section');
});

test('readTomlStatements：跳脫引號與巢狀多行陣列完整保留', () => {
  const kvs = kvsWithSection(`[tui]
label = [
  "a\\"]b",
]
matrix = [
  [1, 2],
  [3, 4],
]
theme = "x"
`);
  assert.equal(kvs.length, 3);
  assert.deepEqual(kvs[2], { section: 'tui', key: 'theme', value: '"x"' });
});

test('readTomlStatements：array-of-tables 以 arrayTable 標記，section 名不含中括號', () => {
  const sections = readTomlStatements(`[features]
enabled = true

[[model_providers]]
api_key = "sk-x"
`).filter(st => st.type === 'section');
  assert.deepEqual(sections.map(s => [s.name, s.arrayTable]),
    [['features', false], ['model_providers', true]]);
});

// -----------------------------------------------------------------------------
// 安全關鍵：字串內的 [x] 樣式不得被誤判為 section header
// （誤判會讓 safety:check 的 hard block／warning 判在錯的 section 上）
// -----------------------------------------------------------------------------
test('readTomlStatements：多行陣列內看似 header 的字串不被當成 section', () => {
  const content = `[tui]
items = [
  "[mcp_servers]",
]
theme = "x"
`;
  const sections = readTomlStatements(content).filter(st => st.type === 'section');
  assert.deepEqual(sections.map(s => s.name), ['tui'],
    '陣列元素中的 "[mcp_servers]" 不得被辨識為 section header');
  assert.deepEqual(kvsWithSection(content).map(k => k.section), ['tui', 'tui']);
});

// 回歸（F2）：malformed header 必須成為 section 邊界，不得退回 other 讓其下的
// key 沿用前一個 section——否則機密 section 的判斷會落在錯的 section 名上。
test('readTomlStatements：malformed header 標為 section(name=null)，不沿用前一 section', () => {
  const sts = readTomlStatements(`[features]
enabled = true

[mcp_servers
api_key = "sk-x"
`);
  const malformed = sts.filter(st => st.type === 'section' && st.name === null);
  assert.equal(malformed.length, 1, 'malformed header 應標為 section');
  assert.equal(malformed[0].line, 4, '應帶正確行號');

  const kvs = kvsWithSection(`[features]
enabled = true

[mcp_servers
api_key = "sk-x"
`);
  assert.equal(kvs[1].section, '', 'malformed 之後的 key 不得掛到 features');
});

test('readTomlStatements：含 ] 的引號 section 名，其下 key 正確歸屬', () => {
  const kvs = kvsWithSection(`[features]
enabled = true

[mcp_servers."weird]name"]
api_key = "sk-x"
`);
  assert.equal(kvs[1].section, 'mcp_servers."weird]name"',
    'key 須歸屬引號 section，而非誤掛 features');
});

// -----------------------------------------------------------------------------
// 回歸（#4）：未閉合 value 不得吞掉後續 section header（fail-open → fail-closed）
//
// 舊實作在括號未平衡時無條件併吞後續每一行直到平衡或 EOF。`notify = [` 之下的
// `[mcp_servers.acme]` 因此永不 emit 成 section，safety-check 的 isCodexSecretSection
// 從未被呼叫，機密 section 的 hard block 靜默消失（實測退回 exit 1）。
// -----------------------------------------------------------------------------
test('readTomlStatements：未閉合陣列不吞掉其後的 section header', () => {
  const content = `[tui]
notify = [
[mcp_servers.acme]
bearer_token = "x"
`;
  const sts = readTomlStatements(content);
  const sections = sts.filter(st => st.type === 'section');
  assert.deepEqual(sections.map(s => s.name), ['tui', null, 'mcp_servers.acme'],
    'header 必須仍被 emit 成 section，不得被吞進 value');
  assert.equal(sections[1].reason, 'unterminated-value', '未閉合 value 應標明 reason');
  assert.equal(sections[1].line, 2, 'malformed 標記帶未閉合 value 的行號');
  assert.deepEqual(kvsWithSection(content).map(k => `${k.section}.${k.key}`),
    ['mcp_servers.acme.bearer_token'], 'key 須正確歸屬機密 section');
});

test('readTomlStatements：未閉合陣列直到 EOF → fail closed（不得靜默 emit kv）', () => {
  const sts = readTomlStatements('[tui]\nnotify = [\n  "a",\n');
  const last = sts[sts.length - 1];
  assert.equal(last.type, 'section', 'EOF 仍未平衡應標為不可信 section 邊界');
  assert.equal(last.name, null);
  assert.equal(last.reason, 'unterminated-value');
  assert.equal(sts.filter(st => st.type === 'kv').length, 0, '不得 emit 半截 kv');
});

// 反向：header 中斷判斷不得誤傷合法多行陣列。`[3, 4]` 這種續行以 `[` 開頭、
// 尾端亦無雜訊，若只用 matchTomlHeader 判斷會誤判為 header 而把合法檔報成 malformed。
test('readTomlStatements：巢狀陣列續行（[3, 4]）不被誤判為 section header', () => {
  const content = `[tui]
matrix = [
  [1, 2],
  [3, 4]
]
theme = "x"
`;
  const sts = readTomlStatements(content);
  assert.equal(sts.filter(st => st.type === 'section' && st.name === null).length, 0,
    '合法巢狀陣列不得產生 malformed 標記');
  assert.deepEqual(kvsWithSection(content).map(k => k.key), ['matrix', 'theme']);
});

// 反向：三引號字串內容對 TOML 不透明，其中的 `[x]` 樣式合法，不得中斷併吞
test('readTomlStatements：三引號字串內的 header 樣式仍併吞，不報 malformed', () => {
  const content = '[tui]\ndescription = """\n[mcp_servers]\n"""\napi_token = "x"\n';
  const sts = readTomlStatements(content);
  assert.equal(sts.filter(st => st.type === 'section' && st.name === null).length, 0);
  assert.deepEqual(kvsWithSection(content).map(k => `${k.section}.${k.key}`),
    ['tui.description', 'tui.api_token']);
});

// -----------------------------------------------------------------------------
// 回歸（#15）：basic string 跳脫序列須解碼，否則 \uXXXX 可繞過 hard block
// -----------------------------------------------------------------------------
test('splitTomlKey：basic string 的 \\uXXXX 跳脫被解碼（不得成為繞過破口）', () => {
  assert.deepEqual(splitTomlKey('"mcp\\u005Fservers"'), ['mcp_servers'],
    '\\u005F 為底線，解碼後應等同 mcp_servers');
  assert.deepEqual(splitTomlKey('"model\\u005Fproviders".openai'), ['model_providers', 'openai']);
  assert.deepEqual(splitTomlKey('"a\\U0001F600b"'), ['a\u{1F600}b'], '\\U 八位形式亦解碼');
});

test('splitTomlKey：basic string 的單字元跳脫被解碼', () => {
  assert.deepEqual(splitTomlKey('"a\\tb"'), ['a\tb']);
  assert.deepEqual(splitTomlKey('"a\\\\b"'), ['a\\b']);
  assert.deepEqual(splitTomlKey('"a\\"b"'), ['a"b']);
});

test('splitTomlKey：無法解碼的跳脫序列回 null（fail closed）', () => {
  assert.equal(splitTomlKey('"mcp\\q_servers"'), null, '非標準跳脫');
  assert.equal(splitTomlKey('"a\\u12"'), null, '\\u 位數不足');
  assert.equal(splitTomlKey('"a\\uZZZZ"'), null, '\\u 非十六進位');
  assert.equal(splitTomlKey('"a\\uD800"'), null, 'surrogate 非合法 scalar value');
});

test('splitTomlKey：字面字串（單引號）不解碼跳脫（TOML 語意）', () => {
  assert.deepEqual(splitTomlKey("'a\\tb'"), ['a\\tb'], "字面字串的 \\t 是兩個字元");
});

test('readTomlStatements：statement 帶 1-indexed 行號', () => {
  const sts = readTomlStatements('[a]\nk = 1\n');
  assert.equal(sts[0].line, 1);
  assert.equal(sts[1].line, 2);
});

test('readTomlStatements：key 正確歸屬各自 section（safety:check 的 key path 前提）', () => {
  const kvs = kvsWithSection(`personality = "pragmatic"

[mcp_servers.myserver]
access_password = "x"

[features]
memories = true
`);
  assert.deepEqual(kvs.map(k => `${k.section ? `${k.section}.` : ''}${k.key}`),
    ['personality', 'mcp_servers.myserver.access_password', 'features.memories']);
});
