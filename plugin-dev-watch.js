#!/usr/bin/env node

const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const config = require('./plugin-dev.config.js');

// 获取命令行参数
const pluginName = process.argv[2] || config.defaultPlugin;

if (!pluginName) {
  console.error('❌ 请指定插件名称: npm run dev <plugin-name>');
  process.exit(1);
}

const biConfig = config.bidirectional || {};
const DEBOUNCE_MS = biConfig.debounceMs || 2000;
const TOLERANCE_MS = biConfig.toleranceMs || 1000;

console.log(`🎯 开始双向监听插件: ${pluginName}`);
console.log(`⚙️  防抖时间: ${DEBOUNCE_MS}ms | 时间戳容差: ${TOLERANCE_MS}ms`);

// 根据插件名生成实际的路径映射
function generatePluginPaths(pluginName) {
  const paths = {};

  Object.keys(config.pathTemplates).forEach(key => {
    const template = config.pathTemplates[key];
    paths[key] = {
      source: template.source.replace(/{plugin}/g, pluginName),
      target: template.target.replace(/{plugin}/g, pluginName)
    };
  });

  return paths;
}

class PluginBiWatcher {
  constructor(pluginName) {
    this.pluginName = pluginName;
    this.rootPath = process.cwd();
    this.pluginPath = path.join(this.rootPath, 'addons', this.pluginName);
    this.paths = generatePluginPaths(pluginName);

    // 防循环：记录最近被同步写入的文件绝对路径及写入时间
    // key: 文件绝对路径, value: 写入完成的时间戳
    this.recentlySynced = new Map();

    // 定期清理过期条目
    setInterval(() => this.cleanupRecentlySynced(), DEBOUNCE_MS * 5);

    // 异步初始化
    this.init().catch(err => {
      console.error('❌ 初始化失败:', err.message);
      process.exit(1);
    });
  }

  async init() {
    console.log(`\n📁 插件目录: ${path.relative(this.rootPath, this.pluginPath)}`);
    console.log('📋 双向监听路径配置:');

    // 创建插件目录结构
    this.createPluginDirs();

    // 启动前比较两侧文件差异
    const diffs = this.compareAllDirectories();

    if (diffs.length > 0) {
      this.displayDiffs(diffs);
      const action = await this.promptSyncAction();

      if (action === 'newer') {
        this.performInitialSync(diffs, 'newer');
      } else if (action === 'to-addon') {
        this.performInitialSync(diffs, 'to-addon');
      } else if (action === 'to-dev') {
        this.performInitialSync(diffs, 'to-dev');
      } else {
        console.log('⏭️  跳过初始同步，直接开始监听');
      }
    } else {
      console.log('\n✅ 两侧文件已完全一致，无需同步');
    }

    // 开始双向监听
    this.startBidirectionalWatching();
  }

  // ========================
  // 初始差异比较
  // ========================

  /**
   * 比较所有路径映射下 source 和 target 的文件差异
   * @returns {Array} 差异列表
   */
  compareAllDirectories() {
    const allDiffs = [];

    Object.keys(this.paths).forEach(key => {
      const sourceDir = path.join(this.rootPath, this.paths[key].source);
      const targetDir = path.join(this.pluginPath, this.paths[key].target);

      const sourceExists = fs.existsSync(sourceDir);
      const targetExists = fs.existsSync(targetDir);

      if (!sourceExists && !targetExists) return;

      const sourceFiles = sourceExists ? this.getAllFiles(sourceDir) : [];
      const targetFiles = targetExists ? this.getAllFiles(targetDir) : [];

      const sourceRelMap = new Map();
      sourceFiles.forEach(f => sourceRelMap.set(path.relative(sourceDir, f), f));

      const targetRelMap = new Map();
      targetFiles.forEach(f => targetRelMap.set(path.relative(targetDir, f), f));

      const allRelPaths = new Set([...sourceRelMap.keys(), ...targetRelMap.keys()]);

      allRelPaths.forEach(relPath => {
        const inSource = sourceRelMap.has(relPath);
        const inTarget = targetRelMap.has(relPath);
        const srcFile = path.join(sourceDir, relPath);
        const tgtFile = path.join(targetDir, relPath);

        if (inSource && inTarget) {
          const srcStat = fs.statSync(srcFile);
          const tgtStat = fs.statSync(tgtFile);
          const diff = srcStat.mtimeMs - tgtStat.mtimeMs;

          if (Math.abs(diff) > TOLERANCE_MS) {
            allDiffs.push({
              group: key,
              relPath,
              type: 'modified',
              srcFile,
              tgtFile,
              srcMtime: srcStat.mtimeMs,
              tgtMtime: tgtStat.mtimeMs,
              newerSide: diff > 0 ? 'source' : 'target'
            });
          }
        } else if (inSource && !inTarget) {
          allDiffs.push({
            group: key,
            relPath,
            type: 'source-only',
            srcFile,
            tgtFile
          });
        } else if (!inSource && inTarget) {
          allDiffs.push({
            group: key,
            relPath,
            type: 'target-only',
            srcFile,
            tgtFile
          });
        }
      });
    });

    return allDiffs;
  }

  /**
   * 展示文件差异列表
   */
  displayDiffs(diffs) {
    const modified = diffs.filter(d => d.type === 'modified');
    const sourceOnly = diffs.filter(d => d.type === 'source-only');
    const targetOnly = diffs.filter(d => d.type === 'target-only');

    console.log('\n' + '='.repeat(60));
    console.log(`⚠️  检测到 ${diffs.length} 个文件不一致:`);
    console.log('='.repeat(60));

    if (modified.length > 0) {
      console.log(`\n📝 内容不同 (${modified.length} 个):`);
      modified.forEach(d => {
        const age = this.formatTimeDiff(Math.abs(d.srcMtime - d.tgtMtime));
        const arrow = d.newerSide === 'source'
          ? `开发端较新 (+${age})`
          : `插件端较新 (+${age})`;
        console.log(`   [${d.group}] ${d.relPath}  ← ${arrow}`);
      });
    }

    if (sourceOnly.length > 0) {
      console.log(`\n📂 仅开发端存在 (${sourceOnly.length} 个):`);
      sourceOnly.forEach(d => {
        console.log(`   [${d.group}] ${d.relPath}`);
      });
    }

    if (targetOnly.length > 0) {
      console.log(`\n📦 仅插件端存在 (${targetOnly.length} 个):`);
      targetOnly.forEach(d => {
        console.log(`   [${d.group}] ${d.relPath}`);
      });
    }

    console.log('');
  }

  /**
   * 交互式提示用户选择同步方式
   * @returns {Promise<string>} 'newer' | 'to-addon' | 'to-dev' | 'skip'
   */
  promptSyncAction() {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log('请选择同步方式:');
      console.log('  [1] 按时间戳同步 (较新文件覆盖较旧文件，缺失文件补齐)');
      console.log('  [2] 开发端 → 插件端 (以开发位置为准)');
      console.log('  [3] 插件端 → 开发端 (以插件位置为准)');
      console.log('  [4] 跳过，直接开始监听');

      rl.question('\n请输入选项 [1/2/3/4] (默认1): ', (answer) => {
        rl.close();
        const choice = answer.trim() || '1';
        switch (choice) {
          case '1': resolve('newer'); break;
          case '2': resolve('to-addon'); break;
          case '3': resolve('to-dev'); break;
          case '4': resolve('skip'); break;
          default:
            console.log('无效选项，使用默认: 按时间戳同步');
            resolve('newer');
        }
      });
    });
  }

  /**
   * 执行初始同步
   * @param {Array} diffs 差异列表
   * @param {string} mode 'newer' | 'to-addon' | 'to-dev'
   */
  performInitialSync(diffs, mode) {
    console.log(`\n🔄 开始初始同步 (模式: ${mode})...`);
    let synced = 0;
    let skipped = 0;

    diffs.forEach(d => {
      try {
        if (d.type === 'modified') {
          let copyToTarget;
          switch (mode) {
            case 'to-addon': copyToTarget = true; break;
            case 'to-dev':   copyToTarget = false; break;
            case 'newer':
            default:         copyToTarget = d.newerSide === 'source'; break;
          }

          if (copyToTarget) {
            fs.ensureDirSync(path.dirname(d.tgtFile));
            fs.copySync(d.srcFile, d.tgtFile, { preserveTimestamps: true });
            console.log(`   → 插件: ${d.relPath}`);
          } else {
            fs.ensureDirSync(path.dirname(d.srcFile));
            fs.copySync(d.tgtFile, d.srcFile, { preserveTimestamps: true });
            console.log(`   ← 开发: ${d.relPath}`);
          }
          synced++;

        } else if (d.type === 'source-only') {
          if (mode === 'to-dev') {
            // 以插件端为准，插件端没有 → 跳过 (或可删除开发端)
            skipped++;
          } else {
            fs.ensureDirSync(path.dirname(d.tgtFile));
            fs.copySync(d.srcFile, d.tgtFile, { preserveTimestamps: true });
            console.log(`   → 插件(新): ${d.relPath}`);
            synced++;
          }

        } else if (d.type === 'target-only') {
          if (mode === 'to-addon') {
            // 以开发端为准，开发端没有 → 跳过 (或可删除插件端)
            skipped++;
          } else {
            fs.ensureDirSync(path.dirname(d.srcFile));
            fs.copySync(d.tgtFile, d.srcFile, { preserveTimestamps: true });
            console.log(`   ← 开发(新): ${d.relPath}`);
            synced++;
          }
        }
      } catch (error) {
        console.error(`   ❌ 同步失败: ${d.relPath} -> ${error.message}`);
      }
    });

    console.log(`\n✅ 初始同步完成! 同步: ${synced} 个, 跳过: ${skipped} 个`);
  }

  /**
   * 格式化时间差
   */
  formatTimeDiff(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${Math.round(sec)}s`;
    const min = sec / 60;
    if (min < 60) return `${Math.round(min)}m`;
    const hr = min / 60;
    if (hr < 24) return `${Math.round(hr * 10) / 10}h`;
    const day = hr / 24;
    return `${Math.round(day * 10) / 10}d`;
  }

  createPluginDirs() {
    Object.keys(this.paths).forEach(key => {
      const sourceDir = path.join(this.rootPath, this.paths[key].source);
      const targetDir = path.join(this.pluginPath, this.paths[key].target);

      [sourceDir, targetDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.ensureDirSync(dir);
          console.log(`  📁 创建目录: ${path.relative(this.rootPath, dir)}`);
        }
      });
    });
  }

  startBidirectionalWatching() {
    Object.keys(this.paths).forEach(key => {
      const sourceDir = path.join(this.rootPath, this.paths[key].source);
      const targetDir = path.join(this.pluginPath, this.paths[key].target);

      console.log(`\n  [${key}]`);
      console.log(`    开发: ${this.paths[key].source}`);
      console.log(`    插件: addons/${this.pluginName}/${this.paths[key].target}`);

      // 方向1: 开发位置 → 插件目录
      if (fs.existsSync(sourceDir)) {
        this.watchDirectory(sourceDir, targetDir, 'dev→addon');
        console.log(`    ✅ 监听开发位置`);
      } else {
        console.log(`    ⚠️  开发目录不存在，仅监听插件端`);
      }

      // 方向2: 插件目录 → 开发位置
      if (fs.existsSync(targetDir)) {
        this.watchDirectory(targetDir, sourceDir, 'addon→dev');
        console.log(`    ✅ 监听插件位置`);
      } else {
        console.log(`    ⚠️  插件目录不存在，仅监听开发端`);
      }
    });

    console.log('\n🚀 双向文件监听服务已启动...');
    console.log('📝 修改任一侧文件，将自动同步到另一侧');
    console.log('按 Ctrl+C 停止监听\n');
  }

  /**
   * 判断某个文件路径是否在防抖窗口内（刚被同步写入过）
   */
  isRecentlySynced(filePath) {
    const syncedTime = this.recentlySynced.get(filePath);
    if (!syncedTime) return false;

    const elapsed = Date.now() - syncedTime;
    if (elapsed < DEBOUNCE_MS) {
      return true;
    }

    // 过期，清除
    this.recentlySynced.delete(filePath);
    return false;
  }

  /**
   * 标记文件为"刚被同步写入"
   */
  markAsSynced(filePath) {
    this.recentlySynced.set(filePath, Date.now());
  }

  /**
   * 清理过期的防抖记录
   */
  cleanupRecentlySynced() {
    const now = Date.now();
    for (const [filePath, time] of this.recentlySynced) {
      if (now - time > DEBOUNCE_MS * 2) {
        this.recentlySynced.delete(filePath);
      }
    }
  }

  watchDirectory(watchDir, mirrorDir, label) {
    const watcher = chokidar.watch(watchDir, {
      persistent: true,
      ignoreInitial: true,   // 双向模式下忽略初始文件，避免启动时大量触发
      depth: 99,
      ignored: /(^|[/\\])\../, // 忽略隐藏文件
      awaitWriteFinish: {      // 等文件写入完成后再触发
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    watcher
      .on('add', filePath => this.onFileChange(filePath, watchDir, mirrorDir, label))
      .on('change', filePath => this.onFileChange(filePath, watchDir, mirrorDir, label))
      .on('unlink', filePath => this.onFileRemove(filePath, watchDir, mirrorDir, label))
      .on('addDir', dirPath => this.onDirAdd(dirPath, watchDir, mirrorDir, label))
      .on('unlinkDir', dirPath => this.onDirRemove(dirPath, watchDir, mirrorDir, label))
      .on('error', error => console.error(`[${label}] 监听错误: ${error}`));
  }

  onFileChange(filePath, watchDir, mirrorDir, label) {
    // 防循环检查：如果这个文件刚被同步写入过，则忽略此次变更
    if (this.isRecentlySynced(filePath)) {
      return;
    }

    const relativePath = path.relative(watchDir, filePath);
    const mirrorFile = path.join(mirrorDir, relativePath);

    try {
      // 如果镜像文件存在，比较时间戳确认确实需要同步
      if (fs.existsSync(mirrorFile)) {
        const srcStat = fs.statSync(filePath);
        const tgtStat = fs.statSync(mirrorFile);
        const diff = srcStat.mtimeMs - tgtStat.mtimeMs;

        // 源文件不比目标新（在容差范围内），跳过
        if (diff <= TOLERANCE_MS) {
          return;
        }
      }

      // 执行同步
      fs.ensureDirSync(path.dirname(mirrorFile));
      fs.copySync(filePath, mirrorFile, { preserveTimestamps: true });

      // 标记目标文件为"刚被同步"，防止对端 watcher 循环触发
      this.markAsSynced(mirrorFile);

      const time = new Date().toLocaleTimeString();
      const arrow = label.includes('→') ? label : '↔️';
      console.log(`✅ [${time}] [${arrow}] ${relativePath}`);
    } catch (error) {
      console.error(`❌ [${label}] 同步失败: ${relativePath} -> ${error.message}`);
    }
  }

  onFileRemove(filePath, watchDir, mirrorDir, label) {
    // 防循环
    if (this.isRecentlySynced(filePath)) {
      return;
    }

    const relativePath = path.relative(watchDir, filePath);
    const mirrorFile = path.join(mirrorDir, relativePath);

    try {
      if (fs.existsSync(mirrorFile)) {
        // 标记后删除
        this.markAsSynced(mirrorFile);
        fs.removeSync(mirrorFile);

        const time = new Date().toLocaleTimeString();
        console.log(`🗑️  [${time}] [${label}] 删除: ${relativePath}`);
      }
    } catch (error) {
      console.error(`❌ [${label}] 删除失败: ${relativePath} -> ${error.message}`);
    }
  }

  onDirAdd(dirPath, watchDir, mirrorDir, label) {
    if (this.isRecentlySynced(dirPath)) return;

    const relativePath = path.relative(watchDir, dirPath);
    if (!relativePath) return; // 根目录本身

    const mirrorDirPath = path.join(mirrorDir, relativePath);

    try {
      if (!fs.existsSync(mirrorDirPath)) {
        this.markAsSynced(mirrorDirPath);
        fs.ensureDirSync(mirrorDirPath);

        const time = new Date().toLocaleTimeString();
        console.log(`📁 [${time}] [${label}] 创建目录: ${relativePath}`);
      }
    } catch (error) {
      console.error(`❌ [${label}] 创建目录失败: ${relativePath} -> ${error.message}`);
    }
  }

  onDirRemove(dirPath, watchDir, mirrorDir, label) {
    if (this.isRecentlySynced(dirPath)) return;

    const relativePath = path.relative(watchDir, dirPath);
    if (!relativePath) return;

    const mirrorDirPath = path.join(mirrorDir, relativePath);

    try {
      if (fs.existsSync(mirrorDirPath)) {
        this.markAsSynced(mirrorDirPath);
        fs.removeSync(mirrorDirPath);

        const time = new Date().toLocaleTimeString();
        console.log(`📁 [${time}] [${label}] 删除目录: ${relativePath}`);
      }
    } catch (error) {
      console.error(`❌ [${label}] 删除目录失败: ${relativePath} -> ${error.message}`);
    }
  }

  /**
   * 递归获取目录下所有文件
   */
  getAllFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;

    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat && stat.isDirectory()) {
        results = results.concat(this.getAllFiles(filePath));
      } else {
        results.push(filePath);
      }
    });

    return results;
  }
}

// 启动双向监听
new PluginBiWatcher(pluginName);

// 处理退出信号
process.on('SIGINT', () => {
  console.log('\n👋 双向监听服务已停止');
  process.exit(0);
});