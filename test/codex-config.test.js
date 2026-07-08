'use strict';

// =============================================================================
// Codex config.toml 純函式單元測試
// 鎖定 section 級黑名單混合制過濾（預設同步 + 黑名單排除 + plugins/top-level
// carve-out）、穩定序列化與 to-local 合併行為
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
  isDeviceCodexSection,
} = require('../sync.js');
const { withTmpDir } = require('./helpers');

// 本機 config.toml 樣本，涵蓋：top-level 可攜/裝置 key、未列黑名單的一般 section
// （tui/features/memories）、未知新 section（experimental）、plugins carve-out、
// 各類黑名單 section（model_providers/mcp_servers/projects/tui.model_availability_nux）
const LOCAL_CONFIG = `model = "gpt-5.5"
model_reasoning_effort = "medium"
personality = "pragmatic"
web_search = "live"

[plugins."browser-use@openai-bundled"]
enabled = true
api_key = "sk-should-not-sync"

[plugins."github@openai-curated"]
enabled = true

[projects.'d:\\code\\sync-ai']
trust_level = "trusted"

[tui]
status_line = ["model-with-reasoning", "project-name"]
theme = "dark"

[tui.model_availability_nux]
"gpt-5.5" = 4

[model_providers.openai]
api_key = "sk-secret"

[mcp_servers.foo]
command = "bar"

[features]
memories = true
goals = true

[memories]
generate_memories = true
use_memories = true

[experimental]
new_flag = true
`;

// 依黑名單混合制過濾後、依插入順序序列化的預期輸出：top-level 只留 personality/
// web_search；plugins 只留 enabled；tui/features/memories/experimental 整段同步；
// projects/model_providers/mcp_servers/tui.model_availability_nux 整段排除。
const PORTABLE_CONFIG = `personality = "pragmatic"
web_search = "live"

[plugins."browser-use@openai-bundled"]
enabled = true

[plugins."github@openai-curated"]
enabled = true

[tui]
status_line = ["model-with-reasoning", "project-name"]
theme = "dark"

[features]
memories = true
goals = true

[memories]
generate_memories = true
use_memories = true

[experimental]
new_flag = true
`;

test('parsePortableCodexConfig：一般 section 整段同步、黑名單 section 整段排除', () => {
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(LOCAL_CONFIG));
  assert.equal(serialized, PORTABLE_CONFIG);
  // top-level carve-out：裝置 key 排除
  assert.ok(!serialized.includes('model ='));
  assert.ok(!serialized.includes('model_reasoning_effort'));
  // 黑名單 section 整段排除
  assert.ok(!serialized.includes('projects.'));
  assert.ok(!serialized.includes('model_providers'));
  assert.ok(!serialized.includes('mcp_servers'));
  assert.ok(!serialized.includes('model_availability_nux'));
});

test('未知新 section 預設同步（experimental 進 repo）', () => {
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(LOCAL_CONFIG));
  assert.ok(serialized.includes('[experimental]'));
  assert.ok(serialized.includes('new_flag = true'));
});

test('未列黑名單的一般 section 整段同步（含 tui 非 status_line 的 key）', () => {
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(LOCAL_CONFIG));
  assert.ok(serialized.includes('[tui]'));
  assert.ok(serialized.includes('status_line = ["model-with-reasoning", "project-name"]'));
  // 舊白名單制只放行 tui.status_line；黑名單制下 tui 整段同步，theme 也進 repo
  assert.ok(serialized.includes('theme = "dark"'));
});

test('carve-out：plugins.* 只同步 enabled，其他 key 排除', () => {
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(LOCAL_CONFIG));
  assert.ok(serialized.includes('[plugins."browser-use@openai-bundled"]\nenabled = true'));
  // plugin section 內的其他 key（含假想憑證）不同步
  assert.ok(!serialized.includes('api_key'));
  assert.ok(!serialized.includes('sk-should-not-sync'));
});

test('carve-out：top-level 只同步窄允許清單，裝置 key 排除', () => {
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(
    `personality = "x"\nweb_search = "y"\nmodel = "gpt-5"\napproval_policy = "on"\n`,
  ));
  assert.ok(serialized.includes('personality = "x"'));
  assert.ok(serialized.includes('web_search = "y"'));
  assert.ok(!serialized.includes('model ='));
  assert.ok(!serialized.includes('approval_policy'));
});

test('serializePortableCodexConfig：輸出順序穩定且含結尾換行', () => {
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(LOCAL_CONFIG));
  assert.ok(serialized.endsWith('\n'));
  assert.equal(serialized, PORTABLE_CONFIG);
});

test('isDeviceCodexSection：黑名單 section 前綴與子 section 命中、一般 section 不命中', () => {
  assert.equal(isDeviceCodexSection('model_providers'), true);
  assert.equal(isDeviceCodexSection('model_providers.openai'), true);
  assert.equal(isDeviceCodexSection('mcp_servers.foo'), true);
  assert.equal(isDeviceCodexSection('projects.\'d:\\code\''), true);
  assert.equal(isDeviceCodexSection('tui.model_availability_nux'), true);
  assert.equal(isDeviceCodexSection('tui'), false);
  assert.equal(isDeviceCodexSection('features'), false);
  assert.equal(isDeviceCodexSection(''), false);
  // 前綴須為完整 section 段，不可誤命中同字首的不相關 section
  assert.equal(isDeviceCodexSection('historyx'), false);
});

test('mergePortableCodexConfig：to-local 保留本機黑名單 section 與未受管理欄位', () => {
  const repo = parsePortableCodexConfig(`personality = "focused"
web_search = "cached"

[tui]
status_line = ["project-name"]

[plugins."github@openai-curated"]
enabled = false
`);
  const merged = mergePortableCodexConfig(LOCAL_CONFIG, repo);
  // top-level 裝置 key 保留
  assert.ok(merged.includes('model = "gpt-5.5"'));
  assert.ok(merged.includes('model_reasoning_effort = "medium"'));
  // 黑名單 section 整段保留本機內容
  assert.ok(merged.includes("[projects.'d:\\code\\sync-ai']"));
  assert.ok(merged.includes('trust_level = "trusted"'));
  assert.ok(merged.includes('[model_providers.openai]'));
  assert.ok(merged.includes('api_key = "sk-secret"'));
  assert.ok(merged.includes('[tui.model_availability_nux]'));
  // plugin section 內的未受管理 key（api_key）保留本機值
  assert.ok(merged.includes('api_key = "sk-should-not-sync"'));
  // repo 可攜值套入
  assert.ok(merged.includes('personality = "focused"'));
  assert.ok(merged.includes('web_search = "cached"'));
  assert.ok(merged.includes('status_line = ["project-name"]'));
  assert.ok(merged.includes('[plugins."github@openai-curated"]\nenabled = false'));
});

test('mergePortableCodexConfig：本機檔不存在時建立可攜內容', () => {
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

// -----------------------------------------------------------------------------
// 跨行 TOML 語法：逐行掃描器不得截斷多行陣列／三引號字串，array-of-tables 不得誤掛
// -----------------------------------------------------------------------------

test('parse/serialize：多行陣列完整保留（不截斷成無效 TOML）', () => {
  const input = `[tui]
notifications = [
  "agent-turn-complete",
  "approval-requested",
]
theme = "dark"
`;
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(input));
  assert.equal(serialized, input);
  assert.ok(serialized.includes('agent-turn-complete'));
  assert.ok(serialized.includes('approval-requested'));
});

test('parse/serialize：多行三引號字串完整保留', () => {
  const input = `[features]
note = """
line1
line2
"""
enabled = true
`;
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(input));
  assert.equal(serialized, input);
});

test('parse：array-of-tables（[[x]]）其下 key 不外洩、不誤掛前一 section', () => {
  const input = `[features]
enabled = true

[[model_providers]]
api_key = "sk-secret-leak"
`;
  const serialized = serializePortableCodexConfig(parsePortableCodexConfig(input));
  // api_key 不得被誤判為 features 的可攜 key 而同步進 repo
  assert.ok(!serialized.includes('api_key'));
  assert.ok(!serialized.includes('sk-secret-leak'));
  // features.enabled 正常同步
  assert.ok(serialized.includes('[features]\nenabled = true'));
});

test('merge：to-local 更新多行陣列並保留本機 array-of-tables 機密 section', () => {
  const repo = parsePortableCodexConfig(`[tui]
notifications = [
  "agent-turn-complete",
]
`);
  const local = `[tui]
notifications = [
  "old-value",
]

[[model_providers]]
api_key = "sk-local-secret"
`;
  const merged = mergePortableCodexConfig(local, repo);
  assert.ok(merged.includes('agent-turn-complete'));
  assert.ok(!merged.includes('old-value'));
  // 本機 array-of-tables 機密 section 原樣保留
  assert.ok(merged.includes('[[model_providers]]'));
  assert.ok(merged.includes('api_key = "sk-local-secret"'));
});
