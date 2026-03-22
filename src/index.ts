#!/usr/bin/env node
/**
 * Grit CLI - Habit Tracker
 * 
 * Main entry point with comprehensive error handling and defensive programming.
 */

import assert from 'node:assert';
import { Command } from 'commander';
import { getConfig, promptForConfig, saveConfig, hasLegacyJsonFile, getLegacyJsonPath } from './config.js';
import { loadData, getTodayDateString, updateStats, saveData, getDbPath, closeDatabase, jsonPathToDbPath } from './storage.js';
import { runQuickCheckIn, showHistory, showStatistics } from './ui.js';
import color from 'picocolors';
import * as p from '@clack/prompts';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { statSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── ASSERTION: module path validation ──
assert(typeof __filename === 'string', '[INIT] __filename must be a string');
assert(typeof __dirname === 'string', '[INIT] __dirname must be a string');
assert(__filename.length > 0, '[INIT] __filename cannot be empty');
assert(__dirname.length > 0, '[INIT] __dirname cannot be empty');

// ── Load package.json ──
const pkgPath = join(__dirname, '..', 'package.json');
assert(existsSync(pkgPath), `[INIT] package.json not found at: ${pkgPath}`);

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
assert(typeof pkg === 'object' && pkg !== null, '[INIT] package.json must be a valid object');
assert(typeof pkg.version === 'string', '[INIT] package.json must have a version string');

// ═══════════════════════════════════════════════════════════════════════════════
// CLI SETUP
// ═══════════════════════════════════════════════════════════════════════════════

const program = new Command();

program
  .name('grit')
  .description('A fantastic CLI habit tracker with SQLite storage')
  .version(pkg.version)
  .addHelpText('after', `
Usage:
  grit              Daily check-in (asks all habit questions in order)
  grit status       Day-by-day activity history (last 30 days)
  grit status -a    Show all history
  grit graphs       Detailed overview (last 30 days)
  grit graphs -y    Last year graphs
  grit graphs -a    All time detailed overview
  grit import       Import existing .gritdata.json from another device
  grit config       Change data storage path
  grit clear        Clear history

Tips:
  - During check-in, answer "No" to skip any activity you didn't do today
  - Press Ctrl+C to cancel the current question
  - Data is stored in SQLite database (~/.gritdata.db by default)
`);

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('config')
  .description('Change grit configuration (e.g. data storage path)')
  .action(async () => {
    p.intro(color.bgCyan(color.black(' Grit Configuration ')));
    
    const config = await getConfig();
    const currentPath = config ? config.dataPath : join(homedir(), '.gritdata.db');
    
    // ── ASSERTION: path validation ──
    assert(typeof currentPath === 'string', '[CONFIG_CMD] currentPath must be a string');

    p.note(`Current database path: ${currentPath}`);

    const newPath = await p.text({
      message: 'Where would you like to store your habit database?',
      placeholder: currentPath,
      initialValue: currentPath,
      validate: (value) => {
        if (!value || !value.trim()) return 'Please enter a valid path';
        
        try {
          const stat = statSync(value as string);
          if (stat.isDirectory()) {
            return 'Path must be a file, not a directory';
          }
        } catch (e) {
          // ── Path doesn't exist yet, that's fine ──
        }
        return undefined;
      }
    });

    if (p.isCancel(newPath)) {
      p.cancel('Configuration cancelled.');
      process.exit(0);
    }

    // ── ASSERTION: user input validation ──
    assert(typeof newPath === 'string', '[CONFIG_CMD] newPath must be a string');
    
    // ── Ensure path ends with .db ──
    let finalPath = newPath as string;
    if (!finalPath.endsWith('.db')) {
      if (finalPath.endsWith('.json')) {
        finalPath = finalPath.replace(/\.json$/, '.db');
      } else {
        finalPath = finalPath + '.db';
      }
    }
    
    // ── ASSERTION: final path validation ──
    assert(finalPath.endsWith('.db'), `[CONFIG_CMD] finalPath must end with .db, got: ${finalPath}`);

    await saveConfig({ dataPath: finalPath });
    p.outro(`Database path updated to ${color.cyan(finalPath)}`);
  });

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('import [filepath]')
  .description('Import an existing .gritdata.json file (e.g. from another device)')
  .action(async (filepath?: string) => {
    p.intro(color.bgCyan(color.black(' Grit Import ')));

    let targetPath = filepath;

    if (!targetPath) {
      const input = await p.text({
        message: 'Enter the path to your existing .gritdata.json file:',
        placeholder: '/path/to/.gritdata.json',
        validate: (v) => {
          if (!v || !v.trim()) return 'Please enter a valid file path';
          return undefined;
        }
      });
      
      if (p.isCancel(input)) {
        p.cancel('Import cancelled.');
        process.exit(0);
      }
      targetPath = input as string;
    }

    // ── ASSERTION: target path validation ──
    assert(typeof targetPath === 'string', '[IMPORT_CMD] targetPath must be a string');
    assert(targetPath.length > 0, '[IMPORT_CMD] targetPath cannot be empty');

    // ── Resolve the path ──
    const resolved = resolve(targetPath);
    
    // ── ASSERTION: resolved path ──
    assert(typeof resolved === 'string', '[IMPORT_CMD] resolved path must be a string');

    // ── Check existence ──
    try {
      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        console.log(color.red('Error: That path is a directory, not a file.'));
        process.exit(1);
      }
    } catch {
      console.log(color.red(`Error: File not found at ${resolved}`));
      process.exit(1);
    }

    // ── Validate it's valid grit data ──
    let parsed: any;
    try {
      const content = readFileSync(resolved, 'utf-8');
      
      // ── ASSERTION: file content ──
      assert(typeof content === 'string', '[IMPORT_CMD] File content must be a string');
      
      parsed = JSON.parse(content);
      
      // ── ASSERTION: parsed content ──
      assert(typeof parsed === 'object' && parsed !== null, '[IMPORT_CMD] Parsed content must be a non-null object');
      
      if (!parsed.history || !Array.isArray(parsed.history)) {
        console.log(color.red('Error: This file does not look like a valid grit data file (missing history array).'));
        process.exit(1);
      }
      
      const entryCount = parsed.history.length;
      
      // ── ASSERTION: entry count ──
      assert(typeof entryCount === 'number', '[IMPORT_CMD] entryCount must be a number');
      assert(entryCount >= 0, '[IMPORT_CMD] entryCount cannot be negative');
      
      p.note(
        `Found valid grit data!\n` +
        `  Version: ${parsed.version || 1}\n` +
        `  History entries: ${entryCount}\n` +
        `  File path: ${resolved}`
      );
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.log(color.red('Error: Could not parse file as valid JSON.'));
      } else {
        console.log(color.red(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`));
      }
      process.exit(1);
    }

    // ── Determine database path ──
    const dbPath = jsonPathToDbPath(resolved);
    
    // ── ASSERTION: db path ──
    assert(dbPath.endsWith('.db'), `[IMPORT_CMD] dbPath must end with .db, got: ${dbPath}`);

    const confirm = await p.confirm({
      message: `Import data to ${color.cyan(dbPath)}?`,
      initialValue: true
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Import cancelled.');
      process.exit(0);
    }

    // ── Load data (which triggers migration) ──
    const data = await loadData(resolved);
    
    // ── ASSERTION: loaded data ──
    assert(typeof data === 'object' && data !== null, '[IMPORT_CMD] Loaded data must be a non-null object');
    assert(Array.isArray(data.history), '[IMPORT_CMD] data.history must be an array');
    
    // ── Update config to use the new database ──
    await saveConfig({ dataPath: dbPath, legacyJsonPath: resolved });
    
    p.outro(color.green(`✅ Imported! Grit will now use ${color.cyan(dbPath)} for all data.`));
  });

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('status')
  .description('Show day-by-day activity status (same as history)')
  .option('-a, --all', 'Show all history instead of just the last 30 days')
  .action(async (options) => {
    const config = await getConfig();
    
    if (!config) {
      console.log(color.red('No configuration found. Run grit first to set it up.'));
      process.exit(1);
    }
    
    // ── ASSERTION: config validation ──
    assert(typeof config.dataPath === 'string', '[STATUS_CMD] config.dataPath must be a string');
    
    const data = await loadData(config.dataPath);
    
    // ── ASSERTION: loaded data ──
    assert(typeof data === 'object' && data !== null, '[STATUS_CMD] Loaded data must be a non-null object');
    assert(Array.isArray(data.history), '[STATUS_CMD] data.history must be an array');
    
    await showHistory(data, options.all);
  });

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPHS COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('graphs')
  .description('Show detailed overview for your selected period')
  .option('-a, --all', 'Show all-time stats')
  .option('-y, --year', 'Show last year stats')
  .option('-d, --days <n>', 'Show last N days', '30')
  .action(async (options) => {
    const config = await getConfig();
    
    if (!config) {
      console.log(color.red('No configuration found. Run grit first to set it up.'));
      process.exit(1);
    }
    
    // ── ASSERTION: config validation ──
    assert(typeof config.dataPath === 'string', '[GRAPHS_CMD] config.dataPath must be a string');
    
    const data = await loadData(config.dataPath);
    
    // ── ASSERTION: loaded data ──
    assert(typeof data === 'object' && data !== null, '[GRAPHS_CMD] Loaded data must be a non-null object');
    
    let period = options.days || '30';
    if (options.all) period = 'all';
    else if (options.year) period = '365';
    
    // ── ASSERTION: period validation ──
    assert(typeof period === 'string', '[GRAPHS_CMD] period must be a string');
    
    showStatistics(data, period);
  });

// ═══════════════════════════════════════════════════════════════════════════════
// CLEAR COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('clear')
  .description('Clear tracker history')
  .option('--today', "Clear only today's habits")
  .option('--all', 'Clear all history')
  .action(async (options) => {
    const config = await getConfig();
    
    if (!config) {
      console.log(color.red('No configuration found. Run grit first to set it up.'));
      process.exit(1);
    }
    
    // ── ASSERTION: config validation ──
    assert(typeof config.dataPath === 'string', '[CLEAR_CMD] config.dataPath must be a string');
    
    const data = await loadData(config.dataPath);
    
    // ── ASSERTION: loaded data ──
    assert(typeof data === 'object' && data !== null, '[CLEAR_CMD] Loaded data must be a non-null object');
    assert(Array.isArray(data.history), '[CLEAR_CMD] data.history must be an array');

    if (options.all) {
      const confirm = await p.confirm({
        message: color.red('Are you sure you want to clear ALL history? This cannot be undone!'),
        initialValue: false
      });
      
      if (!p.isCancel(confirm) && confirm) {
        data.history = [];
        data.stats = { currentStreak: 0, highestStreak: 0 };
        await saveData(config.dataPath, data);
        
        // ── ASSERTION: data was cleared ──
        assert(data.history.length === 0, '[CLEAR_CMD] History should be empty after clear');
        
        p.outro(color.green('All history has been cleared.'));
      } else {
        p.outro('Operation cancelled.');
      }
    } else if (options.today) {
      const confirm = await p.confirm({
        message: "Are you sure you want to clear today's habits?",
        initialValue: false
      });
      
      if (!p.isCancel(confirm) && confirm) {
        const todayStr = getTodayDateString();
        
        // ── ASSERTION: date format ──
        assert(/^\d{4}-\d{2}-\d{2}$/.test(todayStr), `[CLEAR_CMD] todayStr must be YYYY-MM-DD, got: ${todayStr}`);
        
        const entry = data.history.find(e => e.date === todayStr);
        
        if (entry) {
          // ── ASSERTION: entry validation ──
          assert(typeof entry === 'object', '[CLEAR_CMD] entry must be an object');
          
          entry.problemSolving = [];
          entry.reading = [];
          entry.learning = [];
          entry.coding = [];
          entry.goodHabits = {};
          entry.badHabits = {};
          entry.score = 0;
          entry.success = false;

          updateStats(data);
          await saveData(config.dataPath, data);
          
          // ── ASSERTION: entry was cleared ──
          assert(entry.problemSolving.length === 0, '[CLEAR_CMD] problemSolving should be empty');
          assert(entry.reading.length === 0, '[CLEAR_CMD] reading should be empty');
          assert(entry.score === 0, '[CLEAR_CMD] score should be 0');
          
          p.outro(color.green("Today's habits have been cleared! You can now reload them."));
        } else {
          p.outro('No habits logged today yet.');
        }
      } else {
        p.outro('Operation cancelled.');
      }
    } else {
      console.log(color.yellow('Please specify what to clear:'));
      console.log("  grit clear --today    (Clear today's logged habits)");
      console.log('  grit clear --all      (Delete all history forever)');
    }
  });

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT ACTION (DASHBOARD)
// ═══════════════════════════════════════════════════════════════════════════════

program
  .action(async () => {
    let config = await getConfig();
    
    if (!config) {
      config = await promptForConfig();
    }
    
    // ── ASSERTION: config must exist now ──
    assert(config !== null, '[DEFAULT_CMD] Config must exist after prompt');
    assert(typeof config.dataPath === 'string', '[DEFAULT_CMD] config.dataPath must be a string');
    
    // ── Check for legacy JSON migration message ──
    if (hasLegacyJsonFile(config)) {
      const legacyPath = getLegacyJsonPath(config);
      if (legacyPath) {
        p.note(
          `Migrating data from ${color.cyan(legacyPath)} to SQLite database.\n` +
          `Your original JSON file will be preserved as a backup.`
        );
      }
    }

    const data = await loadData(config.dataPath);
    
    // ── ASSERTION: loaded data validation ──
    assert(typeof data === 'object' && data !== null, '[DEFAULT_CMD] Loaded data must be a non-null object');
    assert(typeof data.version === 'number', '[DEFAULT_CMD] data.version must be a number');
    assert(Array.isArray(data.history), '[DEFAULT_CMD] data.history must be an array');
    assert(typeof data.stats === 'object', '[DEFAULT_CMD] data.stats must be an object');
    assert(typeof data.categories === 'object', '[DEFAULT_CMD] data.categories must be an object');
    
    const todayStr = getTodayDateString();
    
    // ── ASSERTION: date format ──
    assert(/^\d{4}-\d{2}-\d{2}$/.test(todayStr), `[DEFAULT_CMD] todayStr must be YYYY-MM-DD, got: ${todayStr}`);

    const existingEntryIndex = data.history.findIndex(e => e.date === todayStr);
    
    // ── ASSERTION: index is valid ──
    assert(typeof existingEntryIndex === 'number', '[DEFAULT_CMD] existingEntryIndex must be a number');
    assert(existingEntryIndex >= -1, '[DEFAULT_CMD] existingEntryIndex cannot be less than -1');

    if (existingEntryIndex !== -1) {
      const existingEntry = data.history[existingEntryIndex];
      
      // ── ASSERTION: existing entry validation ──
      assert(existingEntry !== undefined, '[DEFAULT_CMD] existingEntry should exist at found index');
      assert(existingEntry.date === todayStr, '[DEFAULT_CMD] existingEntry date should match today');
      
      const wantToOverride = await p.confirm({
        message: 'You have already checked in today! Do you want to continue editing today\'s entry?',
        initialValue: true
      });

      if (p.isCancel(wantToOverride) || !wantToOverride) {
        p.outro('See you tomorrow! ✌️');
        process.exit(0);
      }
    }

    // ── Run the quick check-in flow ──
    await runQuickCheckIn(data, config.dataPath);
  });

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING AND EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

// ── Global error handler for uncaught errors ──
process.on('uncaughtException', (error) => {
  console.error(color.red('\n❌ Unexpected error occurred:'));
  
  if (error instanceof Error) {
    console.error(color.red(`   ${error.message}`));
    
    if (error.stack) {
      console.error(color.dim(error.stack.split('\n').slice(1).join('\n')));
    }
  } else {
    console.error(color.red(`   ${String(error)}`));
  }
  
  // ── Cleanup database connection ──
  try {
    closeDatabase();
  } catch {
    // ── Ignore cleanup errors ──
  }
  
  process.exit(1);
});

// ── Global handler for unhandled promise rejections ──
process.on('unhandledRejection', (reason, promise) => {
  console.error(color.red('\n❌ Unhandled promise rejection:'));
  console.error(color.red(`   ${reason instanceof Error ? reason.message : String(reason)}`));
  
  // ── Cleanup database connection ──
  try {
    closeDatabase();
  } catch {
    // ── Ignore cleanup errors ──
  }
  
  process.exit(1);
});

// ── Parse CLI arguments ──
program.parse();
