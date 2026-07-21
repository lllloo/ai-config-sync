'use strict';

// =============================================================================
// xtool-skills.js -- 跨工具全域 skill 同步型別（xtool-skills）的專屬邏輯
//
// 由 sync.js 以 createXtoolSkills(deps) DI 建立，經 diffSyncItem／applySyncItem 的
// type switch 分派轉接。承載「~/.agents/skills 正典 + ~/.claude/skills symlink 橋」
// 這一型的全部行為：受管名字集合、npx 撞名判準（D6）、非 prune upsert、
// Claude 探索點橋接與其安全閘門（D5）、以及部分變更的併入。
//
// 與 dir 型的關鍵差異：對 ~/.agents/skills **非 prune**（與 npx skills 共管，不得
// 列舉 dest 全體刪差集），只認 repo agents/skills 登記的「受管名字」。
//
// 反向 require 禁令：本檔 **不** require('./sync.js')。共用常數（三個 skill 根、
// LOCAL_SKILL_LOCK、GLOBAL_EXCLUDE、BRIDGE_CONFLICT_LIST_MAX）與共用工具
// （getFiles／diffDir／mirrorDir／lstatSyncSafe／ensureSymlink／itemLabel／
// toSyncFsError／loadSkillsFromLock／SyncError／col）一律由 deps 注入，對稱
// safety-check.js 的 createSafetyChecker 與 skills.js 的 createSkillsHandler。
// fs／path 為 Node 內建、由本檔自 require。
//
// 注入邊界的取捨：symlink 工具層（ensureSymlink／createSymlinkAtomic／
// symlinkWithFallback／lstatSyncSafe）刻意**留在 sync.js**——它們是通用 FS 能力，
// 只是目前僅有 xtool 一個消費者；把它們搬進來會讓「通用工具」與「型別專屬邏輯」
// 再度糾纏。同理 mirrorDir／getFiles／diffDir／itemLabel 皆以 deps 注入而非搬移。
//
// 對外契約：createXtoolSkills(deps) 回傳的 { diffXtoolItems, applyXtoolItem } 供
// diffSyncItem／applySyncItem 分派。其餘 deps-bound helper（findUnmirroredFiles／
// bridgeUnsafeReason／listSkillNames／managedSkillNames／isNpxManagedSkill／
// upsertOneSkill／bridgeSkillLink）一併附在回傳物件上，作 sync.js re-export 與
// 單元測試的 seam。純函式 mergeXtoolPartialChanges 無注入需求，於模組層直接匯出。
// =============================================================================

const fs = require('fs');
const path = require('path');

/**
 * 併入 xtool apply 的部分變更，供 applySyncItems 補印。
 *
 * 兩邊都要保住：`done` 是先前已完成 skill 的變更，`err.context.partialChanges` 是
 * mirrorDir 附掛的「當前 skill 內部」已完成變更。直接指派會抹掉其中一邊，讓已寫入
 * 磁碟的檔案零可見度（違反「部分寫入不得零可見度」）。
 * mirrorDir 的 rel 是 skill 內部相對路徑（缺 `<name>/` 前綴），需補齊才能對上
 * itemLabel 的顯示格式。
 * @param {SyncError} err
 * @param {Array<{rel: string, action: string}>} done - 先前已完成 skill 的變更
 * @param {string|null} currentName - 失敗當下處理中的 skill 名
 * @returns {void}
 */
function mergeXtoolPartialChanges(err, done, currentName) {
  const inner = (err.context.partialChanges || []).map(c => ({
    ...c,
    rel: currentName ? `${currentName}/${c.rel}` : c.rel,
  }));
  const all = [...done, ...inner];
  if (all.length) err.context.partialChanges = all;
}

/**
 * 建立 xtool-skills 型 handler：以 dependency injection 接收 sync.js 的共用常數與
 * 工具，內部函式閉包捕捉 deps，避免逐一穿參或反向 require。
 * @param {{
 *   AGENTS_SKILLS_HOME: string,
 *   CLAUDE_SKILLS_HOME: string,
 *   REPO_AGENTS_SKILLS: string,
 *   LOCAL_SKILL_LOCK: string,
 *   GLOBAL_EXCLUDE: string[],
 *   BRIDGE_CONFLICT_LIST_MAX: number,
 *   SyncError: typeof Error,
 *   col: Record<string, (s: string) => string>,
 *   getFiles: (dir: string) => string[],
 *   diffDir: (src: string, dest: string, excludePatterns?: string[]) => Array<{rel: string, status: string}>,
 *   mirrorDir: (src: string, dest: string, excludePatterns?: string[], dryRun?: boolean) => Array<{rel: string, action: string}>,
 *   lstatSyncSafe: (p: string) => (import('fs').Stats|null),
 *   ensureSymlink: (target: string, linkPath: string, dryRun?: boolean) => ({action: string}|null),
 *   itemLabel: (item: object, rel?: string) => string,
 *   toSyncFsError: (e: NodeJS.ErrnoException, filePath: string, op: string) => Error,
 *   loadSkillsFromLock: (lockPath: string) => object,
 * }} deps
 * @returns {{
 *   diffXtoolItems: (item: object, direction: string) => object[],
 *   applyXtoolItem: (item: object, direction: string, dryRun: boolean) => Array<{action: string, label: string}>,
 *   findUnmirroredFiles: (dir: string, srcDir: string) => string[],
 *   bridgeUnsafeReason: (srcDir: string, name: string) => ({reason: string, files: string[]}|null),
 *   listSkillNames: (dir: string) => string[],
 *   managedSkillNames: () => string[],
 *   isNpxManagedSkill: (name: string) => boolean,
 *   upsertOneSkill: (item: object, name: string, dryRun: boolean) => Array<{rel: string, action: string}>,
 *   bridgeSkillLink: (srcDir: string, name: string, dryRun: boolean) => ({rel: string, action: string}|null),
 * }}
 */
function createXtoolSkills(deps) {
  const {
    AGENTS_SKILLS_HOME, CLAUDE_SKILLS_HOME, REPO_AGENTS_SKILLS, LOCAL_SKILL_LOCK,
    GLOBAL_EXCLUDE, BRIDGE_CONFLICT_LIST_MAX,
    SyncError, col,
    getFiles, diffDir, mirrorDir, lstatSyncSafe, ensureSymlink,
    itemLabel, toSyncFsError, loadSkillsFromLock,
  } = deps;

  // ---------------------------------------------------------------------------
  // D5 安全閘門：真實目錄→symlink 轉換前，確認不會刪掉 repo 從未有過的內容
  // ---------------------------------------------------------------------------

  /**
   * 列出 dir 內「repo 沒有對應來源」的檔案相對路徑。
   *
   * 用於 D5 真實目錄→symlink 轉換前的安全閘門。ensureSymlink 會遞迴 rm 掉 dir，
   * 其 doc 要求「呼叫端須先確認正典內容已落在 target」——但 upsertOneSkill 只保證
   * 「repo 有的檔案已落在正典」，不保證「dir 裡的每個檔案都在正典裡」。
   * 使用者自寫、repo 從未有過的檔案落在這個差集內，靜默 rm 會永久遺失且無備援。
   *
   * 判準刻意是**路徑存在性、不比對內容**：本機同名檔內容較舊（repo 已更新該 skill）
   * 是 D5 遷移的常態，覆蓋它就是 to-local 的正常語意，與 mirrorDir 對其他同步項的
   * 處理一致；改用內容比對會把每次 skill 更新都誤報成衝突。真正無法復原的只有
   * 「repo 從未有過的路徑」。
   * @param {string} dir - 待檢查的真實目錄
   * @param {string} srcDir - repo 端的來源目錄
   * @returns {string[]} repo 無對應來源的相對路徑（空陣列代表 dir 可安全刪除）
   */
  function findUnmirroredFiles(dir, srcDir) {
    return getFiles(dir).filter(rel => !fs.existsSync(path.join(srcDir, rel)));
  }

  /**
   * Claude 探索點被真實檔案／目錄佔用時，判斷轉成 symlink 是否會損失內容。
   * diff 與 apply 共用此判斷，確保「預覽說會跳過」與「實際跳過」不會分歧。
   *
   * 比對基準刻意用 **repo 來源目錄**而非當下的 ~/.agents 正典：to-local 會先由
   * upsertOneSkill（prune 型 mirrorDir）把 repo 內容寫成正典，故兩者在 apply 後等價；
   * 但 diff 跑在 upsert 之前，此時正典可能還是空的，用它比對會把正常的 D5 遷移
   * 全部誤判成衝突。
   * @param {string} srcDir - repo 端的 skill 來源目錄（agents/skills/<name>）
   * @param {string} name - skill 名稱
   * @returns {{reason: string, files: string[]}|null} 不安全回原因，安全（或非真實目錄）回 null
   */
  function bridgeUnsafeReason(srcDir, name) {
    const link = path.join(CLAUDE_SKILLS_HOME, name);
    const cur = lstatSyncSafe(link);
    if (!cur || cur.isSymbolicLink()) return null;
    // 一般檔案佔用：正典為目錄，該檔不可能是鏡射產物，一律視為未鏡射
    if (!cur.isDirectory()) return { reason: '本機同名檔案非本工具產物', files: [name] };
    const files = findUnmirroredFiles(link, srcDir);
    if (!files.length) return null;
    return { reason: `本機目錄有 ${files.length} 個檔案不在 repo 正典內`, files };
  }

  // ---------------------------------------------------------------------------
  // 受管名字集合與 npx 撞名判準
  // ---------------------------------------------------------------------------

  /**
   * 列出目錄下第一層的 skill 名（僅目錄項，排除 GLOBAL_EXCLUDE）。
   * @param {string} dir
   * @returns {string[]}
   */
  function listSkillNames(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw toSyncFsError(e, dir, '讀取 skill 目錄');
    }
    return entries
      .filter(e => e.isDirectory() && !GLOBAL_EXCLUDE.includes(e.name))
      .map(e => e.name);
  }

  /**
   * 受管 skill 名字集合：一律以 repo agents/skills 為準（兩方向皆同），確保 to-repo
   * 不掃描整個 ~/.agents/skills 而吸入非受管（npx 安裝）skill。
   * @returns {string[]}
   */
  function managedSkillNames() {
    return listSkillNames(REPO_AGENTS_SKILLS);
  }

  /**
   * 碰撞判準（D6）：<name> 是否登記於 ~/.agents/.skill-lock.json（npx 安裝必登記，
   * 本機制永不登記）。「claude 側 symlink 存在」不得作為訊號——與本機制自身產物
   * 無法區分，會讓第二次 apply 起誤判、破壞幂等。lock 讀取失敗時保守回 false
   * （視為非 npx 住戶，正常同步），不因無關檔案異常中止整個 apply。
   * @param {string} name
   * @returns {boolean}
   */
  function isNpxManagedSkill(name) {
    let skills;
    try { skills = loadSkillsFromLock(LOCAL_SKILL_LOCK); }
    catch (_) { return false; }
    return Object.prototype.hasOwnProperty.call(skills, name);
  }

  // ---------------------------------------------------------------------------
  // Diff 側
  // ---------------------------------------------------------------------------

  /**
   * 產生 xtool-skills 型項目的 diff 結果 entries。只比對受管名字（不列 npx 住戶）：
   *   - 碰撞（npx lock 登記）→ 整個 skill 一筆 `conflict` 狀態行
   *   - 否則逐檔比對 src/<name> vs dest/<name>（如 dir）；src skill 缺時 deleted 標
   *     preserved（upsert 不刪 dest，避免預覽誤報「將刪除」）
   *   - to-local 另檢查 ~/.claude/skills/<name> symlink 橋是否就緒（缺／指錯即列出）
   * @param {SyncItem} item
   * @param {'to-repo'|'to-local'} direction
   * @returns {object[]}
   */
  function diffXtoolItems(item, direction) {
    const results = [];
    for (const name of managedSkillNames()) {
      if (isNpxManagedSkill(name)) {
        results.push(makeXtoolEntry(item, name, 'conflict'));
        continue;
      }
      const skillSrc = path.join(item.src, name);
      const srcMissing = !fs.existsSync(skillSrc);
      for (const d of diffDir(skillSrc, path.join(item.dest, name))) {
        results.push(makeXtoolFileEntry(item, name, d, srcMissing));
      }
      if (direction === 'to-local') {
        const bridge = diffBridgeLink(item, name);
        if (bridge) results.push(bridge);
      }
    }
    return results;
  }

  /**
   * xtool 整個 skill 層級的 diff entry（供 conflict 呈現）
   * @param {SyncItem} item
   * @param {string} name
   * @param {string} status
   * @returns {object}
   */
  function makeXtoolEntry(item, name, status) {
    const src = path.join(item.src, name);
    const dest = path.join(item.dest, name);
    return { label: itemLabel(item, name), status, src, dest, verboseSrc: src, verboseDest: dest, itemType: 'xtool-skills' };
  }

  /**
   * xtool 單檔 diff entry
   * @param {SyncItem} item
   * @param {string} name
   * @param {{rel: string, status: string}} d
   * @param {boolean} srcMissing
   * @returns {object}
   */
  function makeXtoolFileEntry(item, name, d, srcMissing) {
    const rel = `${name}/${d.rel}`;
    const src = path.join(item.src, rel);
    const dest = path.join(item.dest, rel);
    const entry = { label: itemLabel(item, rel), status: d.status, src, dest, verboseSrc: src, verboseDest: dest, itemType: 'xtool-skills' };
    if (d.status === 'deleted' && srcMissing) entry.preserved = true;
    return entry;
  }

  /**
   * to-local：檢查 ~/.claude/skills/<name> 是否已是指向 ~/.agents/skills/<name> 的
   * 正確 symlink；就緒回 null，否則回一筆 diff entry（不存在→new、真實目錄/指錯→changed）。
   * @param {SyncItem} item
   * @param {string} name
   * @returns {object|null}
   */
  function diffBridgeLink(item, name) {
    const target = path.join(AGENTS_SKILLS_HOME, name);
    const link = path.join(CLAUDE_SKILLS_HOME, name);
    const cur = lstatSyncSafe(link);
    let ok = false;
    if (cur && cur.isSymbolicLink()) {
      try { ok = fs.readlinkSync(link) === target; } catch (_) { ok = false; }
    }
    if (ok) return null;
    const label = `${itemLabel(item, name)} [claude 探索點]`;
    const entry = { label, src: target, dest: link, verboseSrc: target, verboseDest: link, itemType: 'xtool-skills' };
    // 真實目錄／檔案佔用且含未鏡射內容：轉 symlink 會遞迴刪掉那些內容，
    // 標為 conflict（拒寫、跳過）而非 changed（將更新），避免預覽把刪除說成更新
    const unsafe = bridgeUnsafeReason(path.join(item.src, name), name);
    if (unsafe) return { ...entry, status: 'conflict', conflictReason: `${unsafe.reason}，拒絕刪除、將跳過` };
    return { ...entry, status: cur ? 'changed' : 'new' };
  }

  // ---------------------------------------------------------------------------
  // Apply 側
  // ---------------------------------------------------------------------------

  /**
   * 單一受管 skill 的非 prune upsert：mirrorDir(src/<name> → dest/<name>)。
   * mirrorDir 只在該 skill 目錄「內部」prune 殘檔（不觸碰 sibling skill 目錄）；
   * src/<name> 不存在時 mirrorDir 提早返回、不刪 dest（非破壞）。
   * @param {SyncItem} item
   * @param {string} name
   * @param {boolean} dryRun
   * @returns {Array<{rel: string, action: string}>}
   */
  function upsertOneSkill(item, name, dryRun) {
    const skillSrc = path.join(item.src, name);
    const skillDest = path.join(item.dest, name);
    return mirrorDir(skillSrc, skillDest, [], dryRun)
      .map(c => ({ rel: `${name}/${c.rel}`, action: c.action }));
  }

  /**
   * to-local 的 Claude 探索點 symlink 橋：~/.claude/skills/<name> → ~/.agents/skills/<name>。
   * 幂等（正確 symlink 直接跳過）；含 D5 真實目錄→symlink 轉換（正典已先由 upsert 落在
   * ~/.agents，此處才 rm 舊真實目錄、建 link）。
   * @param {string} srcDir
   * @param {string} name
   * @param {boolean} dryRun
   * @returns {{rel: string, action: string}|null}
   */
  function bridgeSkillLink(srcDir, name, dryRun) {
    const unsafe = bridgeUnsafeReason(srcDir, name);
    if (unsafe) {
      console.warn(col.yellow(
        `  [warn] skill「${name}」的 claude 探索點含未鏡射內容（${unsafe.reason}），拒絕刪除、跳過`
      ));
      for (const f of unsafe.files.slice(0, BRIDGE_CONFLICT_LIST_MAX)) console.warn(col.yellow(`         - ${f}`));
      if (unsafe.files.length > BRIDGE_CONFLICT_LIST_MAX) {
        console.warn(col.yellow(`         …等 ${unsafe.files.length} 個檔案`));
      }
      return null;
    }
    const target = path.join(AGENTS_SKILLS_HOME, name);
    const link = path.join(CLAUDE_SKILLS_HOME, name);
    const res = ensureSymlink(target, link, dryRun);
    return res ? { rel: `${name} [claude 探索點]`, action: res.action } : null;
  }

  /**
   * apply：xtool-skills 型——非 prune upsert 受管 skill，再（to-local）建 symlink 橋。
   * 碰撞（npx lock 登記）者拒絕覆寫、印 warning、跳過。中途失敗把已完成變更附掛
   * partialChanges 供 applySyncItems 補印（部分寫入不得零可見度）。
   * @param {SyncItem} item
   * @param {'to-repo'|'to-local'} direction
   * @param {boolean} dryRun
   * @returns {Array<{action: string, label: string}>}
   */
  function applyXtoolItem(item, direction, dryRun) {
    const changed = [];
    let current = null;
    try {
      for (const name of managedSkillNames()) {
        current = name;
        if (isNpxManagedSkill(name)) {
          console.warn(col.yellow(`  [warn] skill「${name}」已由 npx skills 登記於 ~/.agents/.skill-lock.json，拒絕覆寫、跳過`));
          continue;
        }
        for (const c of upsertOneSkill(item, name, dryRun)) changed.push(c);
        if (direction === 'to-local') {
          const link = bridgeSkillLink(path.join(item.src, name), name, dryRun);
          if (link) changed.push(link);
        }
      }
    } catch (e) {
      if (e instanceof SyncError) mergeXtoolPartialChanges(e, changed, current);
      throw e;
    }
    return changed.map(c => ({ action: c.action, label: itemLabel(item, c.rel) }));
  }

  return {
    // type switch 分派用的對外兩方法
    diffXtoolItems, applyXtoolItem,
    // deps-bound helper：供 sync.js re-export 與單元測試，不由 type switch 使用
    findUnmirroredFiles, bridgeUnsafeReason,
    listSkillNames, managedSkillNames, isNpxManagedSkill,
    upsertOneSkill, bridgeSkillLink,
  };
}

module.exports = {
  createXtoolSkills,
  mergeXtoolPartialChanges,
};
