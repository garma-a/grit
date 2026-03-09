#!/usr/bin/env bun
import { Command } from 'commander';
import { getConfig, promptForConfig, saveConfig } from './config.js';
import { loadData, getTodayDateString, updateStats, saveData } from './storage.js';
import { runDashboard, showHistory, showStatistics } from './ui.js';
import color from 'picocolors';
import * as p from '@clack/prompts';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { statSync } from 'node:fs';

const program = new Command();

program
  .name('grit')
  .description('A fantastic CLI habit tracker')
  .version('1.0.0')
  .addHelpText('after', `
Keyboard Shortcuts for Dashboard:
  p - Log Problem Solving
  r - Log Reading
  l - Log Learning
  c - Log Coding
  s - View Statistics (Graphs + Summaries)
  t - Clear Today's Habits
  a - Clear All History
  h - Show Keyboard Shortcuts
  e - Exit Dashboard

CLI Commands:
  grit              Open the interactive dashboard
  grit status       Day-by-day activity history (last 30 days)
  grit status -a    Show all history
  grit graphs       Combined graphs & summaries (last 30 days)
  grit graphs -y    Last year graphs
  grit graphs -a    All time graphs
  grit import       Import existing .gritdata.json from another device
  grit config       Change data storage path
  grit clear        Clear history
`);

program
  .command('config')
  .description('Change grit configuration (e.g. data storage path)')
  .action(async () => {
    p.intro(color.bgCyan(color.black(' Grit Configuration ')));
    const config = await getConfig();
    const currentPath = config ? config.dataPath : join(homedir(), '.gritdata.json');

    p.note(`Current data path: ${currentPath}`);

    const newPath = await p.text({
      message: 'Where would you like to store your habit data?',
      placeholder: currentPath,
      initialValue: currentPath,
      validate: (value) => {
        if (!value) return 'Please enter a valid path';
        try {
          const stat = statSync(value as string);
          if (stat.isDirectory()) {
            return 'Path must be a file, not a directory';
          }
        } catch (e) { }
      }
    });

    if (p.isCancel(newPath)) {
      p.cancel('Configuration cancelled.');
      process.exit(0);
    }

    await saveConfig({ dataPath: newPath as string });
    p.outro(`Data path updated to ${color.cyan(newPath as string)}`);
  });

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
        }
      });
      if (p.isCancel(input)) {
        p.cancel('Import cancelled.');
        process.exit(0);
      }
      targetPath = input as string;
    }

    // Resolve the path
    const resolved = require('node:path').resolve(targetPath);

    // Check existence
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

    // Validate it's valid grit data
    try {
      const content = require('node:fs').readFileSync(resolved, 'utf-8');
      const parsed = JSON.parse(content);
      if (!parsed.history || !Array.isArray(parsed.history)) {
        console.log(color.red('Error: This file does not look like a valid grit data file (missing history array).'));
        process.exit(1);
      }
      const entryCount = parsed.history.length;
      p.note(
        `Found valid grit data!\n` +
        `  Version: ${parsed.version || 1}\n` +
        `  History entries: ${entryCount}\n` +
        `  File path: ${resolved}`
      );
    } catch (e) {
      console.log(color.red('Error: Could not parse file as valid JSON.'));
      process.exit(1);
    }

    const confirm = await p.confirm({
      message: `Use ${color.cyan(resolved)} as your grit data file?`,
      initialValue: true
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Import cancelled.');
      process.exit(0);
    }

    await saveConfig({ dataPath: resolved });
    p.outro(color.green(`✅ Imported! Grit will now use ${color.cyan(resolved)} for all data.`));
  });

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
    const data = await loadData(config.dataPath);
    await showHistory(data, options.all);
  });

program
  .command('graphs')
  .description('Show combined statistics: graphs + summaries')
  .option('-a, --all', 'Show all-time stats')
  .option('-y, --year', 'Show last year stats')
  .option('-d, --days <n>', 'Show last N days', '30')
  .action(async (options) => {
    const config = await getConfig();
    if (!config) {
      console.log(color.red('No configuration found. Run grit first to set it up.'));
      process.exit(1);
    }
    const data = await loadData(config.dataPath);
    let period = options.days || '30';
    if (options.all) period = 'all';
    else if (options.year) period = '365';
    showStatistics(data, period);
  });

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
    const data = await loadData(config.dataPath);

    if (options.all) {
      const confirm = await p.confirm({
        message: color.red('Are you sure you want to clear ALL history? This cannot be undone!'),
        initialValue: false
      });
      if (!p.isCancel(confirm) && confirm) {
        data.history = [];
        data.stats = { currentStreak: 0, highestStreak: 0 };
        await saveData(config.dataPath, data);
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
        const entry = data.history.find(e => e.date === getTodayDateString());
        if (entry) {
          entry.problemSolving = [];
          entry.reading = [];
          entry.learning = [];
          entry.coding = [];
          entry.score = 0;
          entry.success = false;

          updateStats(data);
          await saveData(config.dataPath, data);
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

program
  .action(async () => {
    let config = await getConfig();
    if (!config) {
      config = await promptForConfig();
    }

    const data = await loadData(config.dataPath);
    const todayStr = getTodayDateString();

    const existingEntryIndex = data.history.findIndex(e => e.date === todayStr);

    if (existingEntryIndex !== -1) {
      const wantToOverride = await p.confirm({
        message: 'You have already checked in today! Do you want to overwrite today\'s entry?',
        initialValue: false
      });

      if (p.isCancel(wantToOverride) || !wantToOverride) {
        p.outro('See you tomorrow! ✌️');
        process.exit(0);
      }
    }

    // The new logic: just open the dashboard!
    await runDashboard(data, config.dataPath);
  });

program.parse();
