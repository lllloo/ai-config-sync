'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAP_ROOT = path.join(__dirname, '..', 'agents', 'skills', 'map');

function readMapFile(...parts) {
  return fs.readFileSync(path.join(MAP_ROOT, ...parts), 'utf8');
}

test('map skill：自包含，沒有不存在的繪圖 provider 或舊 adapter', () => {
  const skill = readMapFile('SKILL.md');

  assert.doesNotMatch(skill, /diagram-design|artifact-diagramming|provider/);
  assert.equal(fs.existsSync(path.join(MAP_ROOT, 'references', 'providers')), false);
  assert.equal(fs.existsSync(path.join(MAP_ROOT, 'references', 'diagram-brief.md')), true);
});

test('map skill：多內容時以頁面隔離讀者問題，而非縮放成單張大圖', () => {
  const skill = readMapFile('SKILL.md');
  const brief = readMapFile('references', 'diagram-brief.md');

  assert.match(skill, /「總覽」與「核心路徑」兩頁/);
  assert.match(skill, /1–2 張聚焦頁/);
  assert.match(skill, /每頁只回答一個問題/);
  assert.match(skill, /6–12 個節點、最多 14 條邊/);
  assert.match(skill, /拆頁，不縮字/);
  assert.match(brief, /每一頁/);
  assert.match(brief, /tab/);
});

test('map skill：流程圖具有可追蹤的主路徑與分支規則', () => {
  const skill = readMapFile('SKILL.md');

  for (const expected of ['明確起點與終點', '固定的時間方向', '主路徑編號', '判斷菱形', '例外路徑']) {
    assert.match(skill, new RegExp(expected));
  }
  assert.match(skill, /移到另一頁/);
});

test('map skill：產物無外部 runtime，並保有可存取的 HTML/SVG contract', () => {
  const skill = readMapFile('SKILL.md');
  const brief = readMapFile('references', 'diagram-brief.md');

  for (const expected of ['<!doctype html>', 'lang="zh-Hant"', 'inline CSS/JS', 'inline SVG', '<title>', '<desc>', 'viewBox']) {
    assert.match(skill, new RegExp(expected.replace(/[<>]/g, '\\$&')));
  }
  for (const forbidden of ['<script src>', '<link href="http', 'fetch\\(', 'localStorage']) {
    assert.match(brief, new RegExp(forbidden));
  }
});

test('map skill：反證式品質閘同時防止清單化、流程歧義與無依據關係', () => {
  const skill = readMapFile('SKILL.md');

  for (const expected of ['只是檔案清單', '走完主路徑', '不能推測', '無外部 runtime']) {
    assert.match(skill, new RegExp(expected));
  }
});
