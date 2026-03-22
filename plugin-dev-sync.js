#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const config = require('./plugin-dev.config.js');

// 获取命令行参数
const pluginName = process.argv[2] || config.defaultPlugin;
const forceDirection = process.argv[3]; // 可选: --to-addon 或 --to-dev 强制单向

if (!pluginName) {
  console.error('❌ 请指定插件名称: npm run sync <plugin-name> [--to-addon|--to-dev]');
  process.exit(1);
}

console.log(`🔄 开始双向同步插件: ${pluginName}`);
if (forceDirection) {
  console.log(`⚡ 强制方向: ${forceDirection === '--to-addon' ? '开发 → 插件目录' : '插件目录 → 开发'}`);
}

const biConfig = config.bidirectional || {};
const TOLERANCE_MS = biConfig.toleranceMs || 1000;
const CONFLICT_STRATEGY = biConfig.conflictStrategy || 'newer';

class PluginBiSyncer {
  constructor(pluginName) {
    this.pluginName = pluginName;
    this.rootPath = process.cwd();
    this.pluginPath = path.join(this.rootPath, 'addons', this.pluginName);
    this.paths = this.generatePluginPaths(pluginName);

    this.stats = { sourceToTarget: 0, targetToSource: 0, skipped: 0, created: 0, errors: 0 };

    this.syncAll();
  }

  generatePluginPaths(pluginName) {
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

  syncAll() {
    Object.keys(this.paths).forEach(key => {
      const sourceDir = path.join(this.rootPath, this.paths[key].source);
      const targetDir = path.join(this.pluginPath, this.paths[key].target);

      console.log(`\n📂 [${key}]`);
      console.log(`   开发位置: ${this.paths[key].source}`);
      console.log(`   插件位置: addons/${this.pluginName}/${this.paths[key].target}`);

      this.syncDirectoryBidirectional(sourceDir, targetDir);
    });

    console.log('\n' + '='.repeat(60));
    console.log('🎉 双向同步完成!');
    console.log(`   开发 → 插件: ${this.stats.sourceToTarget} 个文件`);
    console.log(`   插件 → 开发: ${this.stats.targetToSource} 个文件`);
    console.log(`   新建复制:    ${this.stats.created} 个文件`);
    console.log(`   已是最新:    ${this.stats.skipped} 个文件`);
    if (this.stats.errors > 0) {
      console.log(`   ❌ 错误:     ${this.stats.errors} 个文件`);
    }
  }

  syncDirectoryBidirectional(sourceDir, targetDir) {
    const sourceExists = fs.existsSync(sourceDir);
    const targetExists = fs.existsSync(targetDir);

    if (!sourceExists && !targetExists) {
      console.log('   ⚠️  两侧目录均不存在，跳过');
      return;
    }

    // 收集两侧文件的相对路径
    const sourceFiles = sourceExists ? this.getAllFiles(sourceDir) : [];
    const targetFiles = targetExists ? this.getAllFiles(targetDir) : [];

    const sourceRelMap = new Map();
    sourceFiles.forEach(f => sourceRelMap.set(path.relative(sourceDir, f), f));

    const targetRelMap = new Map();
    targetFiles.forEach(f => targetRelMap.set(path.relative(targetDir, f), f));

    // 合并所有相对路径
    const allRelPaths = new Set([...sourceRelMap.keys(), ...targetRelMap.keys()]);

    allRelPaths.forEach(relPath => {
      const inSource = sourceRelMap.has(relPath);
      const inTarget = targetRelMap.has(relPath);

      const srcFile = path.join(sourceDir, relPath);
      const tgtFile = path.join(targetDir, relPath);

      try {
        if (inSource && inTarget) {
          // 两边都存在 → 比较时间戳
          this.syncByTimestamp(srcFile, tgtFile, relPath);
        } else if (inSource && !inTarget) {
          // 仅开发位置存在
          if (forceDirection === '--to-dev') {
            // 强制方向为 插件→开发，说明插件端没有此文件，跳过
            console.log(`   ⏭️  跳过(仅开发端): ${relPath}`);
            this.stats.skipped++;
          } else {
            fs.ensureDirSync(path.dirname(tgtFile));
            fs.copySync(srcFile, tgtFile, { preserveTimestamps: true });
            console.log(`   📥 新建(→插件): ${relPath}`);
            this.stats.created++;
          }
        } else if (!inSource && inTarget) {
          // 仅插件位置存在
          if (forceDirection === '--to-addon') {
            console.log(`   ⏭️  跳过(仅插件端): ${relPath}`);
            this.stats.skipped++;
          } else {
            fs.ensureDirSync(path.dirname(srcFile));
            fs.copySync(tgtFile, srcFile, { preserveTimestamps: true });
            console.log(`   📤 新建(→开发): ${relPath}`);
            this.stats.created++;
          }
        }
      } catch (error) {
        console.error(`   ❌ 同步失败: ${relPath} -> ${error.message}`);
        this.stats.errors++;
      }
    });
  }

  syncByTimestamp(srcFile, tgtFile, relPath) {
    const srcStat = fs.statSync(srcFile);
    const tgtStat = fs.statSync(tgtFile);

    const srcMtime = srcStat.mtimeMs;
    const tgtMtime = tgtStat.mtimeMs;
    const diff = srcMtime - tgtMtime;

    // 在容差范围内视为相同
    if (Math.abs(diff) <= TOLERANCE_MS) {
      this.stats.skipped++;
      return;
    }

    let copyDirection; // 'to-target' or 'to-source'

    if (forceDirection === '--to-addon') {
      copyDirection = 'to-target';
    } else if (forceDirection === '--to-dev') {
      copyDirection = 'to-source';
    } else {
      // 根据策略决定
      switch (CONFLICT_STRATEGY) {
        case 'source':
          copyDirection = 'to-target';
          break;
        case 'target':
          copyDirection = 'to-source';
          break;
        case 'newer':
        default:
          copyDirection = diff > 0 ? 'to-target' : 'to-source';
          break;
      }
    }

    if (copyDirection === 'to-target') {
      fs.copySync(srcFile, tgtFile, { preserveTimestamps: true });
      const age = this.formatTimeDiff(Math.abs(diff));
      console.log(`   → 插件 (新${age}): ${relPath}`);
      this.stats.sourceToTarget++;
    } else {
      fs.copySync(tgtFile, srcFile, { preserveTimestamps: true });
      const age = this.formatTimeDiff(Math.abs(diff));
      console.log(`   ← 开发 (新${age}): ${relPath}`);
      this.stats.targetToSource++;
    }
  }

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

// 执行同步
new PluginBiSyncer(pluginName);