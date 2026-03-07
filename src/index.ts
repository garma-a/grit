#!/usr/bin/env bun
import { Command } from 'commander';
import { getConfig, promptForConfig, saveConfig } from './config.js';
import { loadData, getTodayDateString } from './storage.js';
import { runDashboard } from './ui.js';
import color from 'picocolors';
import * as p from '@clack/prompts';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { statSync } from 'node:fs';
import { showHistory } from './ui.js';

const program = new Command();

program
  .name('grit')
  .description('A fantastic CLI habit tracker')
  .version('1.0.0');

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
        } catch(e) {}
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
  .command('history')
  .description('Show habit history, streak, and stats')
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
