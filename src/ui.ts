import * as p from '@clack/prompts';
import color from 'picocolors';
import boxen from 'boxen';
import figlet from 'figlet';
import type { DailyEntry, GritData } from './storage.js';
import { getTodayDateString, computeDailySuccessAndScore, updateStats, saveData, getOrCreateTodayEntry, ensureCategory, getNextOrPrevDay } from './storage.js';

function getTheme(streak: number) {
  if (streak >= 8) {
    return {
      bg: (text: string) => color.bgRed(color.white(` ${text} `)),
      fg: color.red,
      borderColor: 'red',
      emoji: '🔥'
    };
  }
  if (streak >= 3) {
    return {
      bg: (text: string) => color.bgYellow(color.black(` ${text} `)),
      fg: color.yellow,
      borderColor: 'yellow',
      emoji: '⚡'
    };
  }
  return {
    bg: (text: string) => color.bgCyan(color.black(` ${text} `)),
    fg: color.cyan,
    borderColor: 'cyan',
    emoji: '🌱'
  };
}

async function promptCategory(message: string, options: string[]): Promise<string | null> {
  const choices = options.map(opt => ({ value: opt, label: opt }));
  choices.unshift({ value: '__NEW__', label: '+ Type a new category...' });

  const selection = await p.select({
    message,
    options: choices,
    maxItems: 10
  });

  if (p.isCancel(selection)) return null;

  if (selection === '__NEW__') {
    const fresh = await p.text({
      message: 'Enter the new category:',
      validate: (v) => (!v || !v.trim() ? 'Please provide a category name' : undefined)
    });
    if (p.isCancel(fresh)) return null;
    return fresh as string;
  }

  return selection as string;
}

async function promptMultiCategory(baseMessage: string, options: string[]): Promise<string[] | null> {
  const selected: string[] = [];
  while (true) {
    const message = selected.length === 0
      ? baseMessage
      : `Topics: ${selected.join(', ')} | Add another?`;

    const choices = options.filter(o => !selected.includes(o)).map(opt => ({ value: opt, label: opt }));
    choices.unshift({ value: '__NEW__', label: '+ Type a new topic...' });
    if (selected.length > 0) {
      choices.unshift({ value: '__DONE__', label: '✅ Done adding topics' });
    }

    const selection = await p.select({
      message,
      options: choices,
      maxItems: 12
    });

    if (p.isCancel(selection)) return null;
    if (selection === '__DONE__') break;

    let newTopic = selection as string;
    if (selection === '__NEW__') {
      const fresh = await p.text({
        message: 'Enter the new topic:',
        validate: (v) => (!v || !v.trim() ? 'Please provide a topic name' : undefined)
      });
      if (p.isCancel(fresh)) return null;
      newTopic = fresh as string;
    }

    if (!selected.includes(newTopic)) {
      selected.push(newTopic);
    }
  }
  return selected;
}

// Extract unique past topics for autocomplete to prevent repetitive typing
function extractPastTopics(data: GritData, logType: 'reading' | 'learning' | 'coding' | 'problems', filterCategory?: string): string[] {
  const topics = new Set<string>();
  for (const entry of data.history) {
    if (logType === 'reading') {
      entry.reading.forEach(r => {
        if (!filterCategory || r.category === filterCategory) topics.add(r.topic);
      });
    } else if (logType === 'learning') {
      entry.learning.forEach(r => {
        if (!filterCategory || r.category === filterCategory) topics.add(r.topic);
      });
    } else if (logType === 'coding') {
      entry.coding.forEach(r => {
        if (!filterCategory || r.category === filterCategory) topics.add(r.topic);
      });
    }
  }
  return Array.from(topics);
}

// Provides a fuzzy autocomplete for typing or selecting generic topics
async function promptTopic(message: string, pastTopics: string[]): Promise<string | null> {
  const choices = pastTopics.map(opt => ({ value: opt, label: opt }));
  choices.unshift({ value: '__NEW__', label: '+ Type a new topic...' });

  const selection = await p.select({
    message,
    options: choices,
    maxItems: 10
  });

  if (p.isCancel(selection)) return null;

  if (selection === '__NEW__') {
    const fresh = await p.text({
      message: 'Enter the new topic name:',
      validate: (v) => (!v || !v.trim() ? 'Please provide a topic name' : undefined)
    });
    if (p.isCancel(fresh)) return null;
    return fresh as string;
  }

  return selection as string;
}

export async function runDashboard(data: GritData, dataPath: string): Promise<void> {
  let theme = getTheme(data.stats.currentStreak);

  const renderBanner = () => {
    console.clear();
    let streakText = "";
    if (data.stats.currentStreak > 0) {
      streakText = `Current Streak: ${theme.fg(data.stats.currentStreak.toString())} ${theme.emoji} | Highest: ${data.stats.highestStreak} ${theme.emoji}`;
    } else {
      streakText = `Welcome! Let's build a new streak today. ${theme.emoji}`;
    }

    // Create large ASCII Art
    const asciiArt = figlet.textSync('GRIT', { font: 'Slant' });
    const styledArt = color.bold(theme.fg(asciiArt));

    console.log(
      boxen(`${styledArt}\n\n${color.bold('DASHBOARD V0.1')}\n${streakText}`, {
        padding: { top: 1, bottom: 1, left: 4, right: 4 },
        margin: { bottom: 1, top: 1 },
        borderStyle: 'bold',
        borderColor: theme.borderColor as any,
        textAlignment: 'center',
        float: 'center'
      })
    );
    p.intro(color.dim("Let's begin logging..."));
  };

  renderBanner();


  while (true) {
    const entry = getOrCreateTodayEntry(data);

    // Auto-compute score visually for dashboard
    let currentScore = 0;
    if (entry.problemSolving.length > 0) currentScore++;
    if (entry.reading.length > 0) currentScore++;
    if (entry.learning.length > 0) currentScore++;
    if (entry.coding.length > 0) currentScore++;

    const dashboardChoice = await p.selectKey({
      message: `What would you like to do? (Today's Score: ${currentScore}/4) [Press Key]`,
      options: [
        { value: 'p', label: `[p] 🧩 Log Problem Solving (${entry.problemSolving.length} done)` },
        { value: 'r', label: `[r] 📖 Log Reading (${entry.reading.length} done)` },
        { value: 'l', label: `[l] 🎓 Log Learning (${entry.learning.length} done)` },
        { value: 'c', label: `[c] 💻 Log Coding (${entry.coding.length} done)` },
        { value: 's', label: '[s] 📊 View Statistics (Graphs + Summaries)' },
        { value: 't', label: "[t] 🗑️ Clear Today's Habits" },
        { value: 'a', label: '[a] ⚠️ Clear All History' },
        { value: 'h', label: '[h] ⌨️ Show Keyboard Shortcuts' },
        { value: 'e', label: '[e] 🚪 Exit' }
      ]
    });

    if (p.isCancel(dashboardChoice) || dashboardChoice === 'e') {
      p.outro('Keep up the grit! See you next time! ✌️');
      process.exit(0);
    }

    if (dashboardChoice === 'p') {
      const count = await p.text({
        message: 'How many problems did you solve?',
        placeholder: 'e.g., 2',
        initialValue: '1',
      });
      if (p.isCancel(count)) continue;

      const difficulty = await p.select({
        message: 'What was the difficulty?',
        options: [
          { value: 'Easy', label: 'Easy' },
          { value: 'Medium', label: 'Medium' },
          { value: 'Hard', label: 'Hard' }
        ]
      });
      if (p.isCancel(difficulty)) continue;

      const topics = await promptMultiCategory('What topics were these problems about?', data.categories.problems);
      if (!topics || topics.length === 0) continue;

      topics.forEach(t => ensureCategory(data.categories.problems, t));

      entry.problemSolving.push({
        difficulty: difficulty as string,
        count: parseInt(count as string) || 1,
        topics
      });
    }

    else if (dashboardChoice === 'r') {
      const type = await p.select({
        message: 'What kind of reading?',
        options: [
          { value: 'article', label: 'Article' },
          { value: 'docs', label: 'Documentation' },
          { value: 'book', label: 'Book' }
        ]
      });
      if (p.isCancel(type)) continue;

      const category = await promptCategory('What was the main category? (e.g. Backend, Testing)', data.categories.reading);
      if (!category) continue;
      const newCategory = ensureCategory(data.categories.reading, category);

      const pastTopics = extractPastTopics(data, 'reading', newCategory);
      const topic = await promptTopic('Specific topic/title of the read?', pastTopics);
      if (!topic) continue;

      let pages;
      let sections;
      if (type === 'book') {
        const pg = await p.text({ 
          message: 'How many pages did you read? (e.g. 5, 20)',
          validate: (val) => val === '' ? undefined : (/^\d+$/.test(val || '') ? undefined : 'Please enter a valid number (digits only)')
        });
        if (!p.isCancel(pg) && typeof pg === 'string' && pg) pages = parseInt(pg) || undefined;
      } else if (type === 'docs') {
        const sec = await p.text({ 
          message: 'How many sections did you read?', 
          placeholder: 'e.g., 2',
          validate: (val) => val === '' ? undefined : (/^\d+$/.test(val || '') ? undefined : 'Please enter a valid number (digits only)')
        });
        if (!p.isCancel(sec) && typeof sec === 'string' && sec) sections = parseInt(sec) || undefined;
      }

      entry.reading.push({
        type: type as 'article' | 'docs' | 'book',
        category: newCategory,
        topic: (topic as string).trim(),
        pages,
        sections
      });
    }

    else if (dashboardChoice === 'l') {
      const category = await promptCategory('What category is the tutorial/course on?', data.categories.learning);
      if (!category) continue;
      const newCategory = ensureCategory(data.categories.learning, category);

      const pastTopics = extractPastTopics(data, 'learning', newCategory);
      const topic = await promptTopic('What exactly did you learn?', pastTopics);
      if (!topic) continue;

      const dur = await p.text({
        message: 'How many minutes was the video/course? (e.g. 30, 60)',
        validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Please enter a valid number in minutes (e.g. 45)'
      });
      const duration = (p.isCancel(dur) || typeof dur !== 'string' || !dur) ? undefined : parseInt(dur);

      entry.learning.push({
        category: newCategory,
        topic: (topic as string).trim(),
        duration
      });
    }

    else if (dashboardChoice === 'c') {
      const category = await promptCategory('What area did you practice building?', data.categories.coding);
      if (!category) continue;
      const newCategory = ensureCategory(data.categories.coding, category);

      const pastTopics = extractPastTopics(data, 'coding', newCategory);
      const topic = await promptTopic('What did you build?', pastTopics);
      if (!topic) continue;

      const timeSpentInput = await p.text({ 
        message: 'How many minutes did you spend coding? (e.g. 30, 45, 90)',
        validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Please enter a valid number in minutes (e.g. 60)'
      });
      if (p.isCancel(timeSpentInput) || typeof timeSpentInput !== 'string' || !timeSpentInput) continue;
      const timeSpent = parseInt(timeSpentInput) || 0;

      entry.coding.push({
        category: newCategory,
        topic: (topic as string).trim(),
        timeSpent
      });
    }

    else if (dashboardChoice === 's') {
      const period = await p.select({
        message: 'Select time period for statistics:',
        options: [
          { value: '30', label: 'Last 30 days' },
          { value: '365', label: 'Last year' },
          { value: 'all', label: 'All time' }
        ]
      });
      if (p.isCancel(period)) { renderBanner(); continue; }
      showStatistics(data, period as string);
      await p.text({ message: 'Press Enter to return to Dashboard...' });
      renderBanner();
      continue;
    }

    else if (dashboardChoice === 'h') {
      console.log(boxen(color.cyan(`
Keyboard Shortcuts:
  [p] Log Problem Solving
  [r] Log Reading
  [l] Log Learning
  [c] Log Coding
  [s] View Statistics (Graphs + Summaries)
  [t] Clear Today's Habits
  [a] Clear All History
  [h] Show Keyboard Shortcuts
  [e] Exit Dashboard
       `.trim()), { title: '⌨️ Shortcuts Help', padding: 1, borderColor: 'cyan' }));
      await p.text({ message: 'Press Enter to return to Dashboard...' });
      renderBanner();
      continue;
    }

    else if (dashboardChoice === 't') {
      const confirm = await p.confirm({
        message: 'Are you sure you want to clear all habits logged today? This lets you reload them.',
        initialValue: false
      });
      if (!p.isCancel(confirm) && confirm) {
        entry.problemSolving = [];
        entry.reading = [];
        entry.learning = [];
        entry.coding = [];
        entry.score = 0;
        entry.success = false;

        updateStats(data);
        await saveData(dataPath, data);

        theme = getTheme(data.stats.currentStreak);
        renderBanner();
        p.note(color.yellow("Today's habits have been cleared! You can start logging them again."));
      } else {
        renderBanner();
      }
      continue;
    }

    else if (dashboardChoice === 'a') {
      const confirm = await p.confirm({
        message: color.red('Are you sure you want to clear ALL history? This cannot be undone!'),
        initialValue: false
      });
      if (!p.isCancel(confirm) && confirm) {
        data.history = [];
        data.stats = { currentStreak: 0, highestStreak: 0 };
        await saveData(dataPath, data);

        theme = getTheme(data.stats.currentStreak);
        renderBanner();
        p.note(color.red('All history has been completely cleared.'));
      } else {
        renderBanner();
      }
      continue;
    }

    // Refresh streak and score after each valid input, and persist so we don't lose data
    computeDailySuccessAndScore(entry);
    updateStats(data);
    await saveData(dataPath, data);

    theme = getTheme(data.stats.currentStreak);
    renderBanner();
    p.note(color.green('✔ Done! Activity logged successfully.'));
  }
}

export function showStatsOverview(data: GritData): void {
  // Aggregate articles by topic
  const readCounts: Record<string, number> = {};
  for (const entry of data.history) {
    for (const r of entry.reading) {
      readCounts[r.category] = (readCounts[r.category] || 0) + 1;
    }
  }

  const sortedReads = Object.entries(readCounts).sort((a, b) => b[1] - a[1]);

  let statsStr = '';
  if (sortedReads.length > 0) {
    statsStr += color.bold(color.yellow('\n📚 Reading Distribution:\n'));
    for (const [cat, count] of sortedReads) {
      statsStr += `  - ${cat}: ${count} items\n`;
    }
  } else {
    statsStr += 'No reading data yet.\n';
  }

  // Aggregate problems solved dynamically
  let totalProbs = 0;
  for (const entry of data.history) {
    for (const p of entry.problemSolving) {
      totalProbs += p.count;
    }
  }

  statsStr += color.bold(color.blue('\n🧩 Problems Solved:\n'));
  statsStr += `  - All-time total: ${totalProbs} problems\n`;

  console.log(
    boxen(statsStr.trim(), {
      title: '📊 Your Grit Stats',
      titleAlignment: 'center',
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'round',
      borderColor: 'magenta',
      float: 'center'
    })
  );
}

function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d || '0')}/${parseInt(m || '0')}/${y}`;
}

export async function showHistory(data: GritData, all: boolean): Promise<void> {
  const theme = getTheme(data.stats.currentStreak);

  let headerText = `Current Streak: ${theme.fg(data.stats.currentStreak.toString())} ${theme.emoji} | Highest: ${data.stats.highestStreak} ${theme.emoji}`;

  const asciiArt = figlet.textSync('HISTORY', { font: 'Small' });
  const styledArt = color.bold(theme.fg(asciiArt));

  console.log(
    boxen(`${styledArt}\n\n${headerText}`, {
      padding: { top: 1, bottom: 1, left: 4, right: 4 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'bold',
      borderColor: theme.borderColor as any,
      textAlignment: 'center',
      float: 'center'
    })
  );
  p.intro(color.dim('Journey logs...'));

  if (data.history.length === 0) {
    p.outro('No history found yet. Start your journey today!');
    return;
  }

  const sorted = [...data.history].sort((a, b) => b.date.localeCompare(a.date));

  const todayStr = getTodayDateString();
  const thirtyDaysAgoStr = getNextOrPrevDay(todayStr, -30);

  const entriesToShow = all ? sorted : sorted.filter(e => e.date >= thirtyDaysAgoStr);

  const separator = color.dim('─'.repeat(70));

  for (const entry of entriesToShow) {
    computeDailySuccessAndScore(entry);
    const displayDate = formatDateDisplay(entry.date);

    console.log(`\n${color.bold(color.magenta(`📅 ${displayDate}`))}`);

    // Reading entries
    for (const r of entry.reading) {
      const typeLabel = r.type === 'article' ? 'an article' : r.type === 'docs' ? 'documentation' : 'a book';
      let line = `  📖 You read ${typeLabel} about ${color.cyan(r.category)} — topic: ${color.white(r.topic)}`;
      if (r.pages) line += ` (${r.pages} pages)`;
      if (r.sections) line += ` (${r.sections} section${r.sections > 1 ? 's' : ''})`;
      console.log(line);
    }

    // Problem solving entries
    for (const ps of entry.problemSolving) {
      const diffColor = ps.difficulty.toLowerCase() === 'easy'
        ? color.green(ps.difficulty)
        : ps.difficulty.toLowerCase() === 'medium'
          ? color.yellow(ps.difficulty)
          : color.red(ps.difficulty);
      const topicsList = ps.topics.join(', ');
      console.log(`  🧩 You solved ${color.bold(ps.count.toString())} ${diffColor} problem${ps.count > 1 ? 's' : ''} about ${color.white(topicsList)}`);
    }

    // Learning entries
    for (const l of entry.learning) {
      const durLabel = l.duration ? ` (${l.duration >= 60 ? `${Math.floor(l.duration / 60)}h${l.duration % 60 > 0 ? `${l.duration % 60}min` : ''}` : `${l.duration}min`})` : '';
      console.log(`  🎓 You watched a course about ${color.cyan(l.category)} — topic: ${color.white(l.topic)}${durLabel}`);
    }

    // Coding entries
    for (const c of entry.coding) {
      let timeStr = typeof c.timeSpent === 'number' 
        ? (c.timeSpent >= 60 ? `${Math.floor(c.timeSpent / 60)}h${c.timeSpent % 60 > 0 ? ` ${c.timeSpent % 60}min` : ''}` : `${c.timeSpent}min`)
        : (c.timeSpent || 'unknown time');
      console.log(`  💻 You coded on ${color.cyan(c.category)} — topic: ${color.white(c.topic)} (${timeStr})`);
    }

    // Daily summary
    const hasNoActivity = entry.reading.length === 0 && entry.problemSolving.length === 0 && entry.learning.length === 0 && entry.coding.length === 0;
    if (hasNoActivity) {
      console.log(color.dim('  No activities logged this day.'));
    } else {
      const statusEmoji = entry.success ? '✅' : '❌';
      const statusText = entry.success
        ? color.green('SUCCESS')
        : color.red('MISSED');
      console.log(`  ${statusEmoji} This day you completed ${color.bold(`${entry.score}/4`)} of the daily habits — ${statusText}`);
    }

    console.log(separator);
  }

  p.outro(all ? 'All history loaded.' : 'Showing last 30 days. Use --all for full history.');
}

export function showProblemsGraph(data: GritData, period: string): void {
  const todayStr = getTodayDateString();
  let daysBack: number;

  if (period === 'all') {
    daysBack = data.history.length > 0
      ? Math.ceil((new Date(todayStr).getTime() - new Date(data.history.reduce((min, e) => e.date < min ? e.date : min, todayStr).replace(/-/g, '/')).getTime()) / 86400000) + 1
      : 30;
    daysBack = Math.max(daysBack, 30);
  } else {
    daysBack = parseInt(period);
  }

  // Build a map of date -> { easy, medium, hard }
  const dateMap = new Map<string, { easy: number; medium: number; hard: number }>();

  for (const entry of data.history) {
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const ps of entry.problemSolving) {
      const diff = ps.difficulty.toLowerCase() as 'easy' | 'medium' | 'hard';
      if (diff in counts) {
        counts[diff] += ps.count;
      }
    }
    if (counts.easy > 0 || counts.medium > 0 || counts.hard > 0) {
      dateMap.set(entry.date, counts);
    }
  }

  // Generate the list of dates to show
  const dates: string[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    dates.push(getNextOrPrevDay(todayStr, -i));
  }

  // Get data for each date
  const graphData = dates.map(d => ({
    date: d,
    ...(dateMap.get(d) || { easy: 0, medium: 0, hard: 0 })
  }));

  // Find the max total to scale the Y axis
  let maxTotal = 0;
  for (const gd of graphData) {
    const total = gd.easy + gd.medium + gd.hard;
    if (total > maxTotal) maxTotal = total;
  }
  maxTotal = Math.max(maxTotal, 1); // prevent divide by zero

  const graphHeight = 12;
  const barBlocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

  // Determine how many date columns to show (limit width for readability)
  const maxCols = Math.min(graphData.length, 60);
  const step = Math.max(1, Math.floor(graphData.length / maxCols));
  const sampled = graphData.filter((_, i) => i % step === 0 || i === graphData.length - 1);

  // Y-axis labels
  const yLabels: number[] = [];
  for (let i = graphHeight; i >= 0; i--) {
    yLabels.push(Math.round((i / graphHeight) * maxTotal));
  }

  // Build the graph rows
  const yLabelWidth = Math.max(...yLabels.map(l => l.toString().length)) + 1;

  // Title
  const startDate = formatDateDisplay(dates[0] || todayStr);
  const endDate = formatDateDisplay(dates[dates.length - 1] || todayStr);
  const title = `Problems Solved: ${startDate} → ${endDate}`;

  console.log('');
  console.log(
    boxen(color.bold(color.cyan(title)), {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      borderStyle: 'round',
      borderColor: 'cyan',
      float: 'center'
    })
  );

  // Legend
  console.log(`  ${color.green('■')} Easy  ${color.yellow('■')} Medium  ${color.red('■')} Hard\n`);

  // Render chart rows from top to bottom
  for (let row = graphHeight; row >= 1; row--) {
    const threshold = (row / graphHeight) * maxTotal;
    const prevThreshold = ((row - 1) / graphHeight) * maxTotal;
    const label = Math.round(threshold).toString().padStart(yLabelWidth, ' ');

    let rowStr = color.dim(`${label} │`);

    for (const col of sampled) {
      const total = col.easy + col.medium + col.hard;

      if (total >= threshold) {
        // Full block — determine dominant difficulty at this level
        // Stack: easy at bottom, medium in middle, hard on top
        const easyTop = col.easy;
        const mediumTop = col.easy + col.medium;
        // Which segment is this row in?
        const levelMid = (threshold + prevThreshold) / 2;
        const scaledLevel = (levelMid / maxTotal) * total;

        if (scaledLevel <= easyTop) {
          rowStr += color.green('█');
        } else if (scaledLevel <= mediumTop) {
          rowStr += color.yellow('█');
        } else {
          rowStr += color.red('█');
        }
      } else if (total > prevThreshold) {
        // Partial block
        const fraction = (total - prevThreshold) / (threshold - prevThreshold);
        const blockIdx = Math.min(Math.floor(fraction * barBlocks.length), barBlocks.length - 1);
        const ch = barBlocks[blockIdx] || '▁';

        // Color by the topmost difficulty present
        if (col.hard > 0 && (col.easy + col.medium) < total) {
          rowStr += color.red(ch);
        } else if (col.medium > 0 && col.easy < total) {
          rowStr += color.yellow(ch);
        } else {
          rowStr += color.green(ch);
        }
      } else {
        rowStr += ' ';
      }
    }

    console.log(rowStr);
  }

  // X-axis line
  const xAxis = '─'.repeat(sampled.length);
  console.log(color.dim(`${''.padStart(yLabelWidth, ' ')} └${xAxis}`));

  // X-axis date labels (show first, middle, last)
  if (sampled.length > 0) {
    const firstLabel = formatDateDisplay(sampled[0]!.date);
    const lastLabel = formatDateDisplay(sampled[sampled.length - 1]!.date);

    if (sampled.length > 10) {
      const midIdx = Math.floor(sampled.length / 2);
      const midLabel = formatDateDisplay(sampled[midIdx]!.date);
      const gap1 = midIdx - firstLabel.length;
      const gap2 = sampled.length - midIdx - midLabel.length;
      console.log(color.dim(`${''.padStart(yLabelWidth + 1, ' ')}${firstLabel}${''.padStart(Math.max(1, gap1), ' ')}${midLabel}${''.padStart(Math.max(1, gap2), ' ')}${lastLabel}`));
    } else {
      const gap = sampled.length - firstLabel.length;
      console.log(color.dim(`${''.padStart(yLabelWidth + 1, ' ')}${firstLabel}${''.padStart(Math.max(1, gap), ' ')}${lastLabel}`));
    }
  }

  // Summary stats
  let totalEasy = 0, totalMedium = 0, totalHard = 0;
  for (const gd of graphData) {
    totalEasy += gd.easy;
    totalMedium += gd.medium;
    totalHard += gd.hard;
  }
  const totalAll = totalEasy + totalMedium + totalHard;

  console.log('');
  console.log(
    boxen(
      `${color.bold('Total:')} ${totalAll} problems\n` +
      `  ${color.green(`Easy: ${totalEasy}`)}  ${color.yellow(`Medium: ${totalMedium}`)}  ${color.red(`Hard: ${totalHard}`)}`,
      {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        borderStyle: 'round',
        borderColor: 'magenta',
        float: 'center'
      }
    )
  );
}

// ─── Helper: compute daysBack from period string ───
function computeDaysBack(data: GritData, period: string): number {
  const todayStr = getTodayDateString();
  if (period === 'all') {
    let daysBack = 30;
    if (data.history.length > 0) {
      const earliest = data.history.reduce((min, e) => e.date < min ? e.date : min, todayStr);
      daysBack = Math.ceil((new Date(todayStr).getTime() - new Date(earliest.replace(/-/g, '/')).getTime()) / 86400000) + 1;
      daysBack = Math.max(daysBack, 30);
    }
    return daysBack;
  }
  return parseInt(period);
}

// ─── Helper: generate date list ───
function generateDateList(daysBack: number): string[] {
  const todayStr = getTodayDateString();
  const dates: string[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    dates.push(getNextOrPrevDay(todayStr, -i));
  }
  return dates;
}

// ─── Helper: render a generic bar chart ───
function renderBarChart(
  title: string,
  legend: string,
  sampled: { date: string; values: { amount: number; colorFn: (s: string) => string }[] }[],
  maxTotal: number
): void {
  const graphHeight = 12;
  const barBlocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  maxTotal = Math.max(maxTotal, 1);

  const yLabels: number[] = [];
  for (let i = graphHeight; i >= 0; i--) {
    yLabels.push(Math.round((i / graphHeight) * maxTotal));
  }
  const yLabelWidth = Math.max(...yLabels.map(l => l.toString().length)) + 1;

  console.log('');
  console.log(
    boxen(color.bold(color.cyan(title)), {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      borderStyle: 'round',
      borderColor: 'cyan',
      float: 'center'
    })
  );
  console.log(legend);

  for (let row = graphHeight; row >= 1; row--) {
    const threshold = (row / graphHeight) * maxTotal;
    const prevThreshold = ((row - 1) / graphHeight) * maxTotal;
    const label = Math.round(threshold).toString().padStart(yLabelWidth, ' ');
    let rowStr = color.dim(`${label} │`);

    for (const col of sampled) {
      const total = col.values.reduce((s, v) => s + v.amount, 0);
      if (total >= threshold) {
        // Find which color segment this row falls into
        let cumulative = 0;
        const levelMid = (threshold + prevThreshold) / 2;
        const scaledLevel = (levelMid / maxTotal) * total;
        let colorFn = col.values[0]?.colorFn || color.white;
        for (const v of col.values) {
          cumulative += v.amount;
          if (scaledLevel <= cumulative) {
            colorFn = v.colorFn;
            break;
          }
        }
        rowStr += colorFn('█');
      } else if (total > prevThreshold) {
        const fraction = (total - prevThreshold) / (threshold - prevThreshold);
        const blockIdx = Math.min(Math.floor(fraction * barBlocks.length), barBlocks.length - 1);
        const ch = barBlocks[blockIdx] || '▁';
        // Use topmost color
        let colorFn = col.values[col.values.length - 1]?.colorFn || color.white;
        for (let vi = col.values.length - 1; vi >= 0; vi--) {
          if ((col.values[vi]?.amount || 0) > 0) {
            colorFn = col.values[vi]!.colorFn;
            break;
          }
        }
        rowStr += colorFn(ch);
      } else {
        rowStr += ' ';
      }
    }
    console.log(rowStr);
  }

  const xAxis = '─'.repeat(sampled.length);
  console.log(color.dim(`${''.padStart(yLabelWidth, ' ')} └${xAxis}`));

  if (sampled.length > 0) {
    const firstLabel = formatDateDisplay(sampled[0]!.date);
    const lastLabel = formatDateDisplay(sampled[sampled.length - 1]!.date);
    if (sampled.length > 10) {
      const midIdx = Math.floor(sampled.length / 2);
      const midLabel = formatDateDisplay(sampled[midIdx]!.date);
      const gap1 = midIdx - firstLabel.length;
      const gap2 = sampled.length - midIdx - midLabel.length;
      console.log(color.dim(`${''.padStart(yLabelWidth + 1, ' ')}${firstLabel}${''.padStart(Math.max(1, gap1), ' ')}${midLabel}${''.padStart(Math.max(1, gap2), ' ')}${lastLabel}`));
    } else {
      const gap = sampled.length - firstLabel.length;
      console.log(color.dim(`${''.padStart(yLabelWidth + 1, ' ')}${firstLabel}${''.padStart(Math.max(1, gap), ' ')}${lastLabel}`));
    }
  }
}

// ─── Reading Graph ───
export function showReadingGraph(data: GritData, period: string): void {
  const daysBack = computeDaysBack(data, period);
  const dates = generateDateList(daysBack);

  // Build per-date reading data
  const dateMap = new Map<string, { articles: number; docsSections: number; bookPages: number }>();
  for (const entry of data.history) {
    let articles = 0, docsSections = 0, bookPages = 0;
    for (const r of entry.reading) {
      if (r.type === 'article') articles++;
      else if (r.type === 'docs') docsSections += (r.sections || 1);
      else if (r.type === 'book') bookPages += (r.pages || 1);
    }
    if (articles > 0 || docsSections > 0 || bookPages > 0) {
      dateMap.set(entry.date, { articles, docsSections, bookPages });
    }
  }

  // Convert to intensity scores for stacking
  // Articles: ≤2 green(1), 3-4 yellow(2), >4 red(3)
  // Docs: 1 section green(1), 2-3 yellow(2), >3 red(3)
  // Books: ≤5 pages green(1), 6-10 yellow(2), >10 red(3)
  const graphData = dates.map(d => {
    const rd = dateMap.get(d) || { articles: 0, docsSections: 0, bookPages: 0 };
    return { date: d, ...rd };
  });

  let maxTotal = 0;
  for (const gd of graphData) {
    const total = gd.articles + gd.docsSections + gd.bookPages;
    if (total > maxTotal) maxTotal = total;
  }

  // Sampling
  const maxCols = Math.min(graphData.length, 60);
  const step = Math.max(1, Math.floor(graphData.length / maxCols));
  const sampled = graphData.filter((_, i) => i % step === 0 || i === graphData.length - 1);

  const startDate = formatDateDisplay(dates[0] || getTodayDateString());
  const endDate = formatDateDisplay(dates[dates.length - 1] || getTodayDateString());

  const chartData = sampled.map(col => ({
    date: col.date,
    values: [
      { amount: col.articles, colorFn: color.green },    // articles = green
      { amount: col.docsSections, colorFn: color.yellow }, // docs = yellow
      { amount: col.bookPages, colorFn: color.red }        // books = red/magenta
    ]
  }));

  renderBarChart(
    `Reading Activity: ${startDate} → ${endDate}`,
    `  ${color.green('■')} Articles  ${color.yellow('■')} Docs (sections)  ${color.red('■')} Books (pages)\n`,
    chartData,
    maxTotal
  );

  // Summary totals
  let totalArticles = 0, totalDocs = 0, totalBookPages = 0;
  for (const gd of graphData) {
    totalArticles += gd.articles;
    totalDocs += gd.docsSections;
    totalBookPages += gd.bookPages;
  }

  console.log('');
  console.log(
    boxen(
      `${color.bold('Total Reading:')}\n` +
      `  ${color.green(`Articles: ${totalArticles}`)}  ${color.yellow(`Docs sections: ${totalDocs}`)}  ${color.red(`Book pages: ${totalBookPages}`)}`,
      {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        borderStyle: 'round',
        borderColor: 'magenta',
        float: 'center'
      }
    )
  );
}

// ─── Learning Graph ───
export function showLearningGraph(data: GritData, period: string): void {
  const daysBack = computeDaysBack(data, period);
  const dates = generateDateList(daysBack);

  // Build per-date learning time (minutes)
  const dateMap = new Map<string, { easy: number; medium: number; hard: number }>();
  for (const entry of data.history) {
    let easy = 0, medium = 0, hard = 0;
    for (const l of entry.learning) {
      const dur = l.duration || 30; // default to 30min if not set
      if (dur <= 30) easy += dur;
      else if (dur <= 60) medium += dur;
      else hard += dur;
    }
    if (easy > 0 || medium > 0 || hard > 0) {
      dateMap.set(entry.date, { easy, medium, hard });
    }
  }

  const graphData = dates.map(d => ({
    date: d,
    ...(dateMap.get(d) || { easy: 0, medium: 0, hard: 0 })
  }));

  let maxTotal = 0;
  for (const gd of graphData) {
    const total = gd.easy + gd.medium + gd.hard;
    if (total > maxTotal) maxTotal = total;
  }

  const maxCols = Math.min(graphData.length, 60);
  const step = Math.max(1, Math.floor(graphData.length / maxCols));
  const sampled = graphData.filter((_, i) => i % step === 0 || i === graphData.length - 1);

  const startDate = formatDateDisplay(dates[0] || getTodayDateString());
  const endDate = formatDateDisplay(dates[dates.length - 1] || getTodayDateString());

  const chartData = sampled.map(col => ({
    date: col.date,
    values: [
      { amount: col.easy, colorFn: color.green },   // ≤30min
      { amount: col.medium, colorFn: color.yellow }, // 30min-1h
      { amount: col.hard, colorFn: color.red }       // >1h
    ]
  }));

  renderBarChart(
    `Learning Activity (minutes): ${startDate} → ${endDate}`,
    `  ${color.green('■')} ≤30min  ${color.yellow('■')} 30min–1h  ${color.red('■')} >1h\n`,
    chartData,
    maxTotal
  );

  // Summary
  let totalEasy = 0, totalMedium = 0, totalHard = 0;
  for (const gd of graphData) {
    totalEasy += gd.easy;
    totalMedium += gd.medium;
    totalHard += gd.hard;
  }
  const totalMin = totalEasy + totalMedium + totalHard;
  const totalHrs = Math.floor(totalMin / 60);
  const remainMin = totalMin % 60;

  console.log('');
  console.log(
    boxen(
      `${color.bold('Total Learning:')} ${totalHrs}h ${remainMin}min\n` +
      `  ${color.green(`Short (≤30m): ${totalEasy}min`)}  ${color.yellow(`Medium (≤1h): ${totalMedium}min`)}  ${color.red(`Long (>1h): ${totalHard}min`)}`,
      {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        borderStyle: 'round',
        borderColor: 'magenta',
        float: 'center'
      }
    )
  );
}

// ─── 30-Day Detailed Summary ───
export function show30DaySummary(data: GritData): void {
  const todayStr = getTodayDateString();
  const cutoff = getNextOrPrevDay(todayStr, -30);
  const recent = data.history.filter(e => e.date >= cutoff);

  // ── Reading breakdown ──
  const articlesByCategory: Record<string, { count: number; topics: Set<string> }> = {};
  const docsByCategory: Record<string, { sections: number; topics: Set<string> }> = {};
  const booksByCategory: Record<string, { pages: number; topics: Set<string> }> = {};
  let totalArticles = 0, totalDocs = 0, totalBooks = 0, totalBookPages = 0;

  for (const entry of recent) {
    for (const r of entry.reading) {
      if (r.type === 'article') {
        totalArticles++;
        if (!articlesByCategory[r.category]) articlesByCategory[r.category] = { count: 0, topics: new Set() };
        articlesByCategory[r.category]!.count++;
        articlesByCategory[r.category]!.topics.add(r.topic);
      } else if (r.type === 'docs') {
        totalDocs++;
        if (!docsByCategory[r.category]) docsByCategory[r.category] = { sections: 0, topics: new Set() };
        docsByCategory[r.category]!.sections += (r.sections || 1);
        docsByCategory[r.category]!.topics.add(r.topic);
      } else if (r.type === 'book') {
        totalBooks++;
        totalBookPages += (r.pages || 0);
        if (!booksByCategory[r.category]) booksByCategory[r.category] = { pages: 0, topics: new Set() };
        booksByCategory[r.category]!.pages += (r.pages || 0);
        booksByCategory[r.category]!.topics.add(r.topic);
      }
    }
  }

  // ── Problems breakdown ──
  const problemsByDifficulty: Record<string, { count: number; topics: Set<string> }> = {};
  let totalProblems = 0;

  for (const entry of recent) {
    for (const ps of entry.problemSolving) {
      totalProblems += ps.count;
      const diff = ps.difficulty;
      if (!problemsByDifficulty[diff]) problemsByDifficulty[diff] = { count: 0, topics: new Set() };
      problemsByDifficulty[diff]!.count += ps.count;
      ps.topics.forEach(t => problemsByDifficulty[diff]!.topics.add(t));
    }
  }

  // ── Learning breakdown ──
  const learningByCategory: Record<string, { totalMin: number; topics: Set<string> }> = {};
  let totalLearningMin = 0;

  for (const entry of recent) {
    for (const l of entry.learning) {
      const dur = l.duration || 30;
      totalLearningMin += dur;
      if (!learningByCategory[l.category]) learningByCategory[l.category] = { totalMin: 0, topics: new Set() };
      learningByCategory[l.category]!.totalMin += dur;
      learningByCategory[l.category]!.topics.add(l.topic);
    }
  }

  // ── Coding breakdown ──
  const codingByCategory: Record<string, { count: number; topics: Set<string> }> = {};
  let totalCodingSessions = 0;

  for (const entry of recent) {
    for (const c of entry.coding) {
      totalCodingSessions++;
      if (!codingByCategory[c.category]) codingByCategory[c.category] = { count: 0, topics: new Set() };
      codingByCategory[c.category]!.count++;
      codingByCategory[c.category]!.topics.add(c.topic);
    }
  }

  // ── Build the summary text ──
  let summary = '';

  // Reading
  if (totalArticles > 0 || totalDocs > 0 || totalBooks > 0) {
    summary += color.bold(color.yellow('\n📖 Reading:\n'));
    if (totalArticles > 0) {
      summary += `  You read ${color.bold(totalArticles.toString())} article${totalArticles > 1 ? 's' : ''}`;
      const cats = Object.entries(articlesByCategory).sort((a, b) => b[1].count - a[1].count);
      if (cats.length > 0) {
        const parts = cats.map(([cat, info]) => `${info.count} about ${color.cyan(cat)} (${Array.from(info.topics).slice(0, 5).join(', ')})`);
        summary += ' — ' + parts.join(', ');
      }
      summary += '\n';
    }
    if (totalDocs > 0) {
      summary += `  You read ${color.bold(totalDocs.toString())} documentation section${totalDocs > 1 ? 's' : ''}`;
      const cats = Object.entries(docsByCategory).sort((a, b) => b[1].sections - a[1].sections);
      if (cats.length > 0) {
        const parts = cats.map(([cat, info]) => `${info.sections} sections about ${color.cyan(cat)} (${Array.from(info.topics).slice(0, 5).join(', ')})`);
        summary += ' — ' + parts.join(', ');
      }
      summary += '\n';
    }
    if (totalBooks > 0) {
      summary += `  You read from ${color.bold(totalBooks.toString())} book${totalBooks > 1 ? 's' : ''} (${totalBookPages} pages total)`;
      const cats = Object.entries(booksByCategory).sort((a, b) => b[1].pages - a[1].pages);
      if (cats.length > 0) {
        const parts = cats.map(([cat, info]) => `${info.pages} pages about ${color.cyan(cat)} (${Array.from(info.topics).slice(0, 5).join(', ')})`);
        summary += ' — ' + parts.join(', ');
      }
      summary += '\n';
    }
  }

  // Problems
  if (totalProblems > 0) {
    summary += color.bold(color.blue('\n🧩 Problems:\n'));
    summary += `  You solved ${color.bold(totalProblems.toString())} problem${totalProblems > 1 ? 's' : ''}\n`;
    const diffs = Object.entries(problemsByDifficulty).sort((a, b) => b[1].count - a[1].count);
    for (const [diff, info] of diffs) {
      const diffColor = diff.toLowerCase() === 'easy' ? color.green : diff.toLowerCase() === 'medium' ? color.yellow : color.red;
      summary += `    ${diffColor(`${info.count} ${diff}`)} — topics: ${Array.from(info.topics).slice(0, 8).join(', ')}\n`;
    }
  }

  // Learning
  if (totalLearningMin > 0) {
    const hrs = Math.floor(totalLearningMin / 60);
    const mins = totalLearningMin % 60;
    const timeStr = hrs > 0 ? `${hrs}h ${mins}min` : `${mins}min`;
    summary += color.bold(color.magenta('\n🎓 Learning:\n'));
    summary += `  You completed ${color.bold(timeStr)} of courses\n`;
    const cats = Object.entries(learningByCategory).sort((a, b) => b[1].totalMin - a[1].totalMin);
    for (const [cat, info] of cats) {
      const catHrs = Math.floor(info.totalMin / 60);
      const catMins = info.totalMin % 60;
      const catTime = catHrs > 0 ? `${catHrs}h ${catMins}min` : `${catMins}min`;
      summary += `    ${color.cyan(cat)}: ${catTime} — ${Array.from(info.topics).slice(0, 5).join(', ')}\n`;
    }
  }

  // Coding
  if (totalCodingSessions > 0) {
    summary += color.bold(color.green('\n💻 Coding:\n'));
    summary += `  You did ${color.bold(totalCodingSessions.toString())} coding session${totalCodingSessions > 1 ? 's' : ''}\n`;
    const cats = Object.entries(codingByCategory).sort((a, b) => b[1].count - a[1].count);
    for (const [cat, info] of cats) {
      summary += `    ${color.cyan(cat)}: ${info.count} session${info.count > 1 ? 's' : ''} — ${Array.from(info.topics).slice(0, 5).join(', ')}\n`;
    }
  }

  if (!summary) {
    summary = '\n  No activity recorded in the last 30 days.\n';
  }

  // Success rate
  const successDays = recent.filter(e => { computeDailySuccessAndScore(e); return e.success; }).length;
  const activeDays = recent.filter(e => e.reading.length > 0 || e.problemSolving.length > 0 || e.learning.length > 0 || e.coding.length > 0).length;
  summary += `\n${color.dim(`Active days: ${activeDays}/30 | Successful days (≥3/4): ${successDays}/30`)}\n`;

  console.log(
    boxen(summary.trim(), {
      title: '📝 Last 30 Days — Detailed Summary',
      titleAlignment: 'center',
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'round',
      borderColor: 'cyan',
      float: 'center'
    })
  );
}

// ─── 6-Month Numbers Summary ───
export function show6MonthSummary(data: GritData): void {
  const todayStr = getTodayDateString();
  const cutoff = getNextOrPrevDay(todayStr, -180);
  const recent = data.history.filter(e => e.date >= cutoff);

  let totalProblems = 0;
  let totalArticles = 0;
  let totalDocs = 0;
  let totalBooks = 0;
  let totalBookPages = 0;
  let totalLearningMin = 0;
  let totalCodingSessions = 0;
  let successDays = 0;

  for (const entry of recent) {
    for (const ps of entry.problemSolving) totalProblems += ps.count;
    for (const r of entry.reading) {
      if (r.type === 'article') totalArticles++;
      else if (r.type === 'docs') totalDocs++;
      else if (r.type === 'book') { totalBooks++; totalBookPages += (r.pages || 0); }
    }
    for (const l of entry.learning) totalLearningMin += (l.duration || 30);
    totalCodingSessions += entry.coding.length;

    computeDailySuccessAndScore(entry);
    if (entry.success) successDays++;
  }

  const learningHrs = Math.floor(totalLearningMin / 60);
  const learningMins = totalLearningMin % 60;
  const learningStr = learningHrs > 0 ? `${learningHrs}h ${learningMins}min` : `${learningMins}min`;

  const activeDays = recent.filter(e => e.reading.length > 0 || e.problemSolving.length > 0 || e.learning.length > 0 || e.coding.length > 0).length;

  let summary = '';
  summary += `  ${color.blue('🧩')} ${color.bold(totalProblems.toString())} problems solved\n`;
  summary += `  ${color.yellow('📖')} ${color.bold(totalArticles.toString())} articles + ${color.bold(totalDocs.toString())} docs + ${color.bold(totalBooks.toString())} books read`;
  if (totalBookPages > 0) summary += ` (${totalBookPages} pages)`;
  summary += '\n';
  summary += `  ${color.magenta('🎓')} ${color.bold(learningStr)} of courses completed\n`;
  summary += `  ${color.green('💻')} ${color.bold(totalCodingSessions.toString())} coding sessions\n`;
  summary += `\n${color.dim(`Active days: ${activeDays}/180 | Successful days: ${successDays}/180`)}`;

  console.log(
    boxen(summary, {
      title: '📈 Last 6 Months — Overview',
      titleAlignment: 'center',
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'double',
      borderColor: 'green',
      float: 'center'
    })
  );
}

// ─── Combined Statistics View ───
export function showStatistics(data: GritData, period: string): void {
  const termWidth = process.stdout.columns || 80;

  console.clear();

  const asciiArt = figlet.textSync('STATS', { font: 'Small' });
  console.log(
    boxen(color.bold(color.cyan(asciiArt)), {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { top: 1, bottom: 0 },
      borderStyle: 'bold',
      borderColor: 'cyan',
      textAlignment: 'center',
      float: 'center'
    })
  );

  const periodLabel = period === '30' ? 'Last 30 Days' : period === '365' ? 'Last Year' : 'All Time';
  console.log(color.dim(`\n${'─'.repeat(termWidth)}`));
  console.log(color.bold(color.white(`  📊 Statistics — ${periodLabel}`)));
  console.log(color.dim('─'.repeat(termWidth)));

  // ── Graph 1: Problems ──
  console.log(color.bold(color.blue('\n  ━━━ 🧩 PROBLEMS SOLVED ━━━\n')));
  showProblemsGraph(data, period);

  console.log(color.dim('\n' + '─'.repeat(termWidth)));

  // ── Graph 2: Reading ──
  console.log(color.bold(color.yellow('\n  ━━━ 📖 READING ACTIVITY ━━━\n')));
  showReadingGraph(data, period);

  console.log(color.dim('\n' + '─'.repeat(termWidth)));

  // ── Graph 3: Learning ──
  console.log(color.bold(color.magenta('\n  ━━━ 🎓 LEARNING / COURSES ━━━\n')));
  showLearningGraph(data, period);

  console.log(color.dim('\n' + '─'.repeat(termWidth)));

  // ── 30-Day Summary ──
  console.log(color.bold(color.cyan('\n  ━━━ 📝 DETAILED 30-DAY SUMMARY ━━━\n')));
  show30DaySummary(data);

  console.log(color.dim('\n' + '─'.repeat(termWidth)));

  // ── 6-Month Summary ──
  console.log(color.bold(color.green('\n  ━━━ 📈 6-MONTH OVERVIEW ━━━\n')));
  show6MonthSummary(data);

  console.log(color.dim('\n' + '─'.repeat(termWidth) + '\n'));
}
