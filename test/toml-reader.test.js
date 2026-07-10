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
