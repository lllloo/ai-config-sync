'use strict';

// =============================================================================
// skills.js -- Skills 管理指令（skills:diff／skills:add／skills:remove）
//
// 由 sync.js 以 createSkillsHandler(deps) DI 建立、經 runCommand 分派呼叫。
// 只讀 repo 的 skills-lock.json 與本機 ~/.agents/.skill-lock.json 做集合比對並
// 輸出建議指令，不參與 file／dir／settings 同步核心，也不掃 agents/skills/ 目錄。
//
// 反向 require 禁令：本檔 **不** require('./sync.js')。共用常數與工具（REPO_ROOT、
// LOCAL_SKILL_LOCK、exit code、SyncError／ERR、readJson／writeJsonSafe、
// printSectionDivider／printStatusLine、col）一律由 deps 注入，對稱 safety-check.js
// 的 createSafetyChecker。fs／path 為 Node 內建、由本檔自 require。
//
// 對外契約：createSkillsHandler(deps) 回傳的 { runSkillsDiff, runSkillsAdd,
// runSkillsRemove } 三個方法供 runCommand 分派。其餘 deps-bound helper
// （loadSkillsFromLock／validateSkillName／validateSkillSource／parseSkillSource）
// 一併附在回傳物件上，僅作 sync.js re-export 與單元測試的 seam，不由 runCommand 使用。
// 純函式 computeSkillsDiff／sanitizeForTerminal 無注入需求，於模組層直接匯出。
// =============================================================================

const fs = require('fs');
const path = require('path');

/**
 * 計算 repo 與本機 skills 的三向集合差（純函式）
 * @param {Record<string, unknown>} repoSkills
 * @param {Record<string, unknown>} localSkills
 * @returns {{onlyInRepo: string[], onlyInLocal: string[], inBoth: string[]}}
 */
function computeSkillsDiff(repoSkills, localSkills) {
  return {
    onlyInRepo:  Object.keys(repoSkills).filter(n => !localSkills[n]),
    onlyInLocal: Object.keys(localSkills).filter(n => !repoSkills[n]),
    inBoth:      Object.keys(repoSkills).filter(n =>  localSkills[n]),
  };
}

/**
 * 清除字串中的控制字元（含 ANSI escape、換行），避免 lock 檔的 source 值
 * 被原樣 echo 進終端造成 log injection。未驗證來源的縱深防禦。
 * @param {string} s
 * @returns {string}
 */
function sanitizeForTerminal(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * 建立 skills 指令 handler：以 dependency injection 接收 sync.js 的共用工具，
 * 內部函式閉包捕捉 deps，避免逐一穿參或反向 require。
 * @param {{
 *   REPO_ROOT: string,
 *   LOCAL_SKILL_LOCK: string,
 *   EXIT_OK: number, EXIT_DIFF: number,
 *   SyncError: typeof Error,
 *   ERR: Record<string, string>,
 *   readJson: (filePath: string) => object,
 *   writeJsonSafe: (filePath: string, data: object) => void,
 *   printSectionDivider: () => void,
 *   printStatusLine: (type: string, label: string, desc?: string) => void,
 *   col: Record<string, (s: string) => string>,
 * }} deps
 * @returns {{
 *   runSkillsDiff: () => number,
 *   runSkillsAdd: (opts: object) => number,
 *   runSkillsRemove: (opts: object) => number,
 *   loadSkillsFromLock: (lockPath: string) => object,
 *   validateSkillName: (name: string) => void,
 *   validateSkillSource: (source: string) => void,
 *   parseSkillSource: (opts: object) => {name: string, source: string},
 * }}
 */
function createSkillsHandler(deps) {
  const {
    REPO_ROOT, LOCAL_SKILL_LOCK, EXIT_OK, EXIT_DIFF,
    SyncError, ERR, readJson, writeJsonSafe,
    printSectionDivider, printStatusLine, col,
  } = deps;

  /**
   * 從 skills-lock.json 載入 skills 物件
   * 不存在時回傳空物件；存在但格式異常（缺 skills 物件）時拋 SyncError，避免誤判為無差異
   * @param {string} lockPath
   * @returns {Object<string, {source?: string}>}
   * @throws {SyncError} JSON_PARSE 若 skills 欄位缺失或型別錯誤
   */
  function loadSkillsFromLock(lockPath) {
    if (!fs.existsSync(lockPath)) return {};
    const data = readJson(lockPath);
    if (!data || typeof data.skills !== 'object' || data.skills === null || Array.isArray(data.skills)) {
      throw new SyncError(
        `skills-lock.json 格式異常：缺少 skills 物件`,
        ERR.JSON_PARSE,
        { path: lockPath }
      );
    }
    return data.skills;
  }

  /**
   * skills:diff 指令：比對本機與 repo 的 skills 差異
   * @returns {number} exit code
   */
  function runSkillsDiff() {
    console.log('');
    printSectionDivider();
    console.log(col.bold('  Skills 差異比對'));
    printSectionDivider();
    console.log('');

    const repoSkills = loadSkillsFromLock(path.join(REPO_ROOT, 'skills-lock.json'));
    const localSkills = loadSkillsFromLock(LOCAL_SKILL_LOCK);
    const { onlyInRepo, onlyInLocal, inBoth } = computeSkillsDiff(repoSkills, localSkills);

    if (inBoth.length === 0 && onlyInRepo.length === 0 && onlyInLocal.length === 0) {
      console.log(col.green('  本機與 repo 完全一致\n'));
      return EXIT_OK;
    }

    for (const name of inBoth)      printStatusLine('ok', name);
    for (const name of onlyInRepo)  printStatusLine('down', name, 'repo 有、本機未安裝');
    for (const name of onlyInLocal) printStatusLine('up', name, '本機有、repo 未記錄');

    if (onlyInRepo.length > 0) {
      console.log(col.bold('\n  -- 安裝缺少的 skills --'));
      for (const name of onlyInRepo) {
        const skill = repoSkills[name];
        // 缺 source 時仍印建議、以 <source> 佔位（同 onlyInLocal 分支）：出現在狀態行的
        // skill 都要有下一步，否則使用者看得到差異卻無從行動。
        const source = skill && skill.source ? sanitizeForTerminal(skill.source) : '<source>';
        console.log(`    npx skills add ${source} -g -y --skill ${sanitizeForTerminal(name)}`);
      }
    }

    if (onlyInLocal.length > 0) {
      console.log(col.bold('\n  -- 本機多裝的 skills --'));
      console.log(col.dim('    （A）加入 repo 紀錄：'));
      for (const name of onlyInLocal) {
        const skill = localSkills[name];
        if (skill && skill.source) {
          console.log(`      npm run skills:add -- ${sanitizeForTerminal(name)} ${sanitizeForTerminal(skill.source)}`);
        } else {
          console.log(`      npm run skills:add -- ${sanitizeForTerminal(name)} <source>`);
        }
      }
      console.log(col.dim('    （B）從本機移除：'));
      for (const name of onlyInLocal) {
        console.log(`      npx skills remove ${sanitizeForTerminal(name)} -g -y`);
      }
    }

    console.log('');
    return (onlyInRepo.length > 0 || onlyInLocal.length > 0) ? EXIT_DIFF : EXIT_OK;
  }

  /**
   * 驗證 skill name 格式：只允許英數、底線、點、連字號
   * 防止換行、ANSI escape、控制字元造成 terminal log injection
   * @param {string} name
   * @throws {SyncError}
   */
  function validateSkillName(name) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new SyncError(
        'skill name 含非法字元（僅允許英數、底線、點、連字號）',
        ERR.INVALID_ARGS,
        { name },
      );
    }
  }

  /**
   * 驗證 skill source 格式：禁止控制字元、空白、ANSI escape
   * 防止 terminal log injection 與誤導性建議指令
   * @param {string} source
   * @throws {SyncError}
   */
  function validateSkillSource(source) {
    // \x00-\x1f 涵蓋 \n \r \t \x1b（ESC）等控制字元；空白與 \x7f（DEL）一併禁止
    if (/[\x00-\x20\x7f]/.test(source)) {
      throw new SyncError(
        'skill source 含非法字元（控制字元或空白）',
        ERR.INVALID_ARGS,
        { source },
      );
    }
  }

  /**
   * 解析 skill 來源引數，回傳 name 與 source
   * @param {ParsedArgs} opts - CLI 引數
   * @returns {{name: string, source: string}}
   * @throws {SyncError} 引數不足或格式錯誤時
   */
  function parseSkillSource(opts) {
    const arg1 = opts.extraArgs[0];
    const arg2 = opts.extraArgs[1];
    const usageHint =
      '  用法 1：node sync.js skills:add https://skills.sh/<org>/<repo>/<skill>\n' +
      '  用法 2：node sync.js skills:add <name> <source>';

    if (!arg1) {
      throw new SyncError(`請提供 skill 來源\n${usageHint}`, ERR.INVALID_ARGS);
    }

    if (arg1.startsWith('https://skills.sh/')) {
      const parts = arg1.replace('https://skills.sh/', '').split('/').filter(Boolean);
      if (parts.length < 3) {
        throw new SyncError(
          '無法解析 skills.sh URL，格式應為 https://skills.sh/<org>/<repo>/<skill>',
          ERR.INVALID_ARGS,
          { url: arg1 },
        );
      }
      const name = parts[2];
      const source = `${parts[0]}/${parts[1]}`;
      validateSkillName(name);
      validateSkillSource(source);
      return { name, source };
    }

    if (arg1 && arg2) {
      validateSkillName(arg1);
      validateSkillSource(arg2);
      return { name: arg1, source: arg2 };
    }

    throw new SyncError(`參數不足\n${usageHint}`, ERR.INVALID_ARGS);
  }

  /**
   * skills:add 指令：新增 skill 到 skills-lock.json
   * @param {ParsedArgs} opts - CLI 引數
   * @returns {number} exit code
   */
  function runSkillsAdd(opts) {
    const { name, source } = parseSkillSource(opts);

    const repoLockPath = path.join(REPO_ROOT, 'skills-lock.json');
    let lock;
    if (fs.existsSync(repoLockPath)) {
      lock = readJson(repoLockPath);
    } else {
      lock = { version: 1, skills: {} };
    }

    if (!lock.skills || typeof lock.skills !== 'object' || Array.isArray(lock.skills)) lock.skills = {};

    if (lock.skills[name]) {
      console.log(col.yellow(`\n  [!] ${name} 已存在於 skills-lock.json（source: ${lock.skills[name].source}）`));
      console.log(col.dim('  若要更新來源，請手動編輯 skills-lock.json\n'));
      return EXIT_OK;
    }

    lock.skills[name] = { source, sourceType: 'github' };
    writeJsonSafe(repoLockPath, lock);

    console.log(col.bold(`\n  已加入 ${col.cyan(name)}`));
    console.log(col.dim(`  source: ${source}\n`));
    console.log(col.bold('  安裝指令：'));
    console.log(`    npx skills add ${source} -g -y --skill ${name}\n`);
    return EXIT_OK;
  }

  /**
   * skills:remove 指令：從 skills-lock.json 移除 skill
   * @param {ParsedArgs} opts - CLI 引數
   * @returns {number} exit code
   */
  function runSkillsRemove(opts) {
    const name = opts.extraArgs[0];
    if (!name) {
      throw new SyncError(
        '請提供 skill 名稱\n  用法：node sync.js skills:remove <name>',
        ERR.INVALID_ARGS,
      );
    }
    // 與 skills:add 一致：驗證 name 格式，防 terminal log injection（name 會輸出到建議指令）
    validateSkillName(name);

    const repoLockPath = path.join(REPO_ROOT, 'skills-lock.json');
    if (!fs.existsSync(repoLockPath)) {
      throw new SyncError('找不到 skills-lock.json', ERR.FILE_NOT_FOUND);
    }

    const lock = readJson(repoLockPath);
    if (!lock.skills || !lock.skills[name]) {
      console.log(col.yellow(`\n  [!] ${name} 不在 skills-lock.json 中\n`));
      return EXIT_OK;
    }

    delete lock.skills[name];
    writeJsonSafe(repoLockPath, lock);

    console.log(col.bold(`\n  已移除 ${col.cyan(name)}`));
    console.log(col.dim('  若本機已安裝，請執行：'));
    console.log(`    npx skills remove ${name} -g -y\n`);
    return EXIT_OK;
  }

  return {
    // runCommand 分派用的對外三方法
    runSkillsDiff, runSkillsAdd, runSkillsRemove,
    // deps-bound helper：僅供 sync.js re-export 與單元測試，不由 runCommand 使用
    loadSkillsFromLock, validateSkillName, validateSkillSource, parseSkillSource,
  };
}

module.exports = {
  createSkillsHandler,
  computeSkillsDiff,
  sanitizeForTerminal,
};
