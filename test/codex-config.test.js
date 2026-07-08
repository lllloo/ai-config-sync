'use strict';

// =============================================================================
// Codex config.toml 純函式單元測試
// 鎖定可攜欄位 allowlist、穩定序列化與 to-local 合併行為
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parsePortableCodexConfig,
  serializePortableCodexConfig,
  mergePortableCodexConfig,
  loadPortableCodexConfig,
  isKnownDeviceCodexSection,
  collectUnclassifiedCodexKeys,
} = require('../sync.js');
const { withTmpDir } = require('./helpers');

const LOCAL_CONFIG = `model = "gpt-5.5"
model_reasoning_effort = "medium"
personality = "pragmatic"
web_search = "live"

[marketplaces.openai-bundled]
last_updated = "2026-05-05T01:18:43Z"
source = "C:\\Users\\Roy\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled"

[plugins."browser-use@openai-bundled"]
enabled = true

[plugins."github@openai-curated"]
enabled = true

[projects.'d:\\code\\sync-ai']
trust_level = "trusted"

[tui]
status_line = ["model-with-reasoning", "project-name"]

[tui.model_availability_nux]
"gpt-5.5" = 4

[windows]
sandbox = "unelevated"

[features]
memories = true
goals = true

[memories]
generate_memories = true
use_memories = true
`;

const PORTABLE_CONFIG = `personality = "pragmatic"
web_search = "live"

[tui]
status_line = ["model-with-reasoning", "project-name"]

[features]
memories = true
goals = true

[memories]
generate_memories = true
use_memories = true

[plugins."browser-use@openai-bundled"]
enabled = true

[plugins."github@openai-curated"]
enabled = true
`;

test('parsePortableCodexConfig：只保留 allowlist 欄位', () => {
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(LOCAL_CONFIG));
  assert.equal(serialized, PORTABLE_CONFIG);
  assert.ok(!serialized.includes('model ='));
  assert.ok(!serialized.includes('model_reasoning_effort'));
  assert.ok(!serialized.includes('marketplaces'));
  assert.ok(!serialized.includes('projects.'));
  assert.ok(!serialized.includes('[windows]'));
  assert.ok(!serialized.includes('model_availability_nux'));
});

test('serializePortableCodexConfig：輸出順序穩定且含結尾換行', () => {
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(LOCAL_CONFIG));
  assert.ok(serialized.endsWith('\n'));
  assert.equal(serialized, PORTABLE_CONFIG);
});

test('mergePortableCodexConfig：to-local 保留本機 device 與未知欄位', () => {
  const repo = parsePortableCodexConfig(`personality = "focused"
web_search = "cached"

[tui]
status_line = ["project-name"]

[plugins."github@openai-curated"]
enabled = false
`);
  const merged = mergePortableCodexConfig(LOCAL_CONFIG, repo);
  assert.ok(merged.includes('model = "gpt-5.5"'));
  assert.ok(merged.includes('model_reasoning_effort = "medium"'));
  assert.ok(merged.includes("[projects.'d:\\code\\sync-ai']"));
  assert.ok(merged.includes('trust_level = "trusted"'));
  assert.ok(merged.includes('personality = "focused"'));
  assert.ok(merged.includes('web_search = "cached"'));
  assert.ok(merged.includes('status_line = ["project-name"]'));
  assert.ok(merged.includes('[plugins."github@openai-curated"]\nenabled = false'));
});

test('mergePortableCodexConfig：本機檔不存在時建立 allowlist 內容', () => {
  const portable = parsePortableCodexConfig(PORTABLE_CONFIG);
  assert.equal(mergePortableCodexConfig('', portable), PORTABLE_CONFIG);
});

test('loadPortableCodexConfig：repo 與本機萃取內容相同時序列化相等', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'config.toml');
    fs.writeFileSync(localPath, LOCAL_CONFIG);
    const portable = loadPortableCodexConfig(localPath);
    assert.equal(portable.serialized, PORTABLE_CONFIG);
  });
});

test('isKnownDeviceCodexSection：device section 前綴與子 section 命中、白名單 section 不命中', () => {
  assert.equal(isKnownDeviceCodexSection('model_providers'), true);
  assert.equal(isKnownDeviceCodexSection('model_providers.openai'), true);
  assert.equal(isKnownDeviceCodexSection('mcp_servers.foo'), true);
  assert.equal(isKnownDeviceCodexSection('projects.\'d:\\code\''), true);
  assert.equal(isKnownDeviceCodexSection('tui'), false);
  assert.equal(isKnownDeviceCodexSection(''), false);
  // 前綴須為完整 section 段，不可誤命中同字首的不相關 section
  assert.equal(isKnownDeviceCodexSection('historyx'), false);
});

test('collectUnclassifiedCodexKeys：白名單與 device section 排除，其餘回報且去重保序', () => {
  const content = `personality = "x"
model = "gpt-5"
model_reasoning_effort = "high"

[tui]
status_line = true
notifications = true

[model_providers.openai]
api_key = "sk-secret"

[mcp_servers.foo]
command = "bar"

[experimental]
new_flag = true
new_flag = true
`;
  assert.deepEqual(
    collectUnclassifiedCodexKeys(content),
    ['model', 'model_reasoning_effort', 'tui.notifications', 'experimental.new_flag'],
  );
});

test('collectUnclassifiedCodexKeys：全部為白名單或 device 時回空陣列', () => {
  assert.deepEqual(collectUnclassifiedCodexKeys(PORTABLE_CONFIG), []);
});
