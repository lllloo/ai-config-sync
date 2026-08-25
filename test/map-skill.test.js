'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAP_ROOT = path.join(__dirname, '..', 'agents', 'skills', 'map');

function readMapFile(...parts) {
  return fs.readFileSync(path.join(MAP_ROOT, ...parts), 'utf8');
}

test('map skill：diagram-design 是唯一繪圖 provider', () => {
  const skill = readMapFile('SKILL.md');
  const removedAdapter = path.join(MAP_ROOT, 'references', 'providers', 'artifact-diagramming.md');

  assert.match(skill, /唯一[^\n]*`diagram-design`/);
  assert.doesNotMatch(skill, /artifact-diagramming/);
  assert.equal(fs.existsSync(removedAdapter), false);
});

test('map skill：四表只承載語意，圖面決策由 diagram-design 獨占', () => {
  const tables = readMapFile('references', 'intermediate-tables.md');
  const skill = readMapFile('SKILL.md');
  const adapter = readMapFile('references', 'providers', 'diagram-design.md');

  assert.match(tables, /四表只承載語意/);
  assert.match(tables, /不得包含[^\n]*(?:座標|viewBox)[^\n]*(?:尺寸|字型|配色|模板)/);
  // 責任邊界的正典在 SKILL.md「繪圖 provider」節；adapter 不重述，只鎖 caller 不得繞過 provider 動圖面
  assert.match(skill, /`diagram-design`[^\n]*(?:擁有|獨占)[^\n]*(?:座標|尺寸)/);
  // 多圖頁骨架歸 map（多圖組頁），但每張圖的 SVG 內部仍不得由 caller 修補
  assert.match(skill, /不[^\n]*(?:修補|改寫)[^\n]*SVG 內容/);
  assert.match(skill, /SVG 內部[^\n]*歸 provider/);
  assert.match(adapter, /不得[^\n]*(?:先翻譯成座標|caller 直接 patch)/);
});

test('map skill：provider 載入成功以實際讀到檔案為判準', () => {
  const adapter = readMapFile('references', 'providers', 'diagram-design.md');

  assert.match(adapter, /載入成功以實際讀到檔案為判準/);
  assert.match(adapter, /SKILL\.md[^\n]*type-\*\.md[^\n]*template-dark\.html/);
  assert.match(adapter, /任一讀不到[^\n]*載入失敗[^\n]*晚停/);
});

test('map skill：快圖定調——不設驗證欄、不逐邊查證', () => {
  const tables = readMapFile('references', 'intermediate-tables.md');
  const skill = readMapFile('SKILL.md');
  const adapter = readMapFile('references', 'providers', 'diagram-design.md');

  assert.match(skill, /不逐邊查證/);
  assert.match(tables, /不得反推/);
  // 驗證欄整套（已驗證／文件主張）已移除，不得復活
  assert.doesNotMatch(skill, /文件主張/);
  assert.doesNotMatch(tables, /文件主張|已驗證/);
  assert.doesNotMatch(adapter, /文件主張/);
});

test('map skill：detail 預設 balanced，明說要詳細才升 faithful', () => {
  const adapter = readMapFile('references', 'providers', 'diagram-design.md');
  const skill = readMapFile('SKILL.md');

  // 預設 balanced、明說才升 faithful：判準是使用者要求，不是執行者現場感覺
  assert.match(adapter, /預設 `balanced`[^\n]*明說要詳細[^\n]*`faithful`/);
  // 第 3 步與 adapter 同源：預設壓到 9，放寬到 24 需使用者明說
  assert.match(skill, /預設壓到 9 以內/);
  assert.match(skill, /明說[^\n]*詳細[^\n]*放寬到 24/);
  assert.doesNotMatch(skill, /節點超過 9 個時先畫頂層/);
});

test('map skill：adapter 固定預設 render profile', () => {
  const adapter = readMapFile('references', 'providers', 'diagram-design.md');

  for (const expected of ['html', '1200', 'presentation', 'faithful', 'balanced', 'engineer', 'template-dark.html', 'none']) {
    const pattern = expected.replace('.', '\\.');
    assert.match(adapter, new RegExp(`\\b${pattern}\\b`));
  }
});
