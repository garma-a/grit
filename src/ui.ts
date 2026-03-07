import * as p from '@clack/prompts';
import color from 'picocolors';
import type { DailyEntry, GritData } from './storage.js';
import { getTodayDateString, computeDailySuccessAndScore, updateStats, saveData, getOrCreateTodayEntry, ensureCategory } from './storage.js';

function getTheme(streak: number) {
  if (streak >= 8) {
    return {
      bg: (text: string) => color.bgRed(color.white(` ${text} `)),
      fg: color.red,
      emoji: '🔥'
    };
  }
  if (streak >= 3) {
    return {
      bg: (text: string) => color.bgYellow(color.black(` ${text} `)),
      fg: color.yellow,
      emoji: '⚡'
    };
  }
  return {
    bg: (text: string) => color.bgCyan(color.black(` ${text} `)),
    fg: color.cyan,
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
  const theme = getTheme(data.stats.currentStreak);
  console.clear();
  p.intro(theme.bg(' GRIT DASHBOARD '));

  if (data.stats.currentStreak > 0) {
    p.note(`Current Streak: ${theme.fg(data.stats.currentStreak.toString())} ${theme.emoji} | Highest: ${data.stats.highestStreak} ${theme.emoji}`);
  } else {
    p.note('Welcome! Let\'s build a new streak today. 🌱');
  }

  while (true) {
    const entry = getOrCreateTodayEntry(data);
    
    // Auto-compute score visually for dashboard
    let currentScore = 0;
    if (entry.problemSolving.length > 0) currentScore++;
    if (entry.reading.length > 0) currentScore++;
    if (entry.learning.length > 0) currentScore++;
    if (entry.coding.length > 0) currentScore++;

    const dashboardChoice = await p.select({
      message: `What would you like to do? (Today's Score: ${currentScore}/4)`,
      options: [
        { value: 'problem', label: `🧩 Log Problem Solving (${entry.problemSolving.length} done)` },
        { value: 'reading', label: `📖 Log Reading (${entry.reading.length} done)` },
        { value: 'learning', label: `🎓 Log Learning (${entry.learning.length} done)` },
        { value: 'coding', label: `💻 Log Coding (${entry.coding.length} done)` },
        { value: 'stats', label: '📊 View My Stats Overview' },
        { value: 'exit', label: '🚪 Exit' }
      ]
    });

    if (p.isCancel(dashboardChoice) || dashboardChoice === 'exit') {
      p.outro('Keep up the grit! See you next time! ✌️');
      process.exit(0);
    }

    if (dashboardChoice === 'problem') {
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

    else if (dashboardChoice === 'reading') {
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
       if (type === 'book') {
          const pg = await p.text({ message: 'How many pages? (optional)' });
          if (!p.isCancel(pg) && pg) pages = parseInt(pg as string) || undefined;
       }

       entry.reading.push({
         type: type as 'article' | 'docs' | 'book',
         category: newCategory,
         topic: (topic as string).trim(),
         pages
       });
    }

    else if (dashboardChoice === 'learning') {
       const category = await promptCategory('What category is the tutorial/course on?', data.categories.learning);
       if (!category) continue;
       const newCategory = ensureCategory(data.categories.learning, category);

       const pastTopics = extractPastTopics(data, 'learning', newCategory);
       const topic = await promptTopic('What exactly did you learn?', pastTopics);
       if (!topic) continue;

       entry.learning.push({
         category: newCategory,
         topic: (topic as string).trim()
       });
    }

    else if (dashboardChoice === 'coding') {
       const category = await promptCategory('What area did you practice building?', data.categories.coding);
       if (!category) continue;
       const newCategory = ensureCategory(data.categories.coding, category);

       const pastTopics = extractPastTopics(data, 'coding', newCategory);
       const topic = await promptTopic('What did you build?', pastTopics);
       if (!topic) continue;

       const timeSpent = await p.text({ message: 'How much time did you spend?' });
       if (p.isCancel(timeSpent)) continue;

       entry.coding.push({
         category: newCategory,
         topic: (topic as string).trim(),
         timeSpent: (timeSpent as string).trim()
       });
    }

    else if (dashboardChoice === 'stats') {
       showStatsOverview(data);
       continue;
    }

    // Refresh streak and score after each valid input, and persist so we don't lose data
    computeDailySuccessAndScore(entry);
    updateStats(data);
    await saveData(dataPath, data);

    console.clear();
    p.intro(theme.bg(' GRIT DASHBOARD '));
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

  p.note(statsStr.trim(), 'Your Grit Stats');
}

export async function showHistory(data: GritData, all: boolean): Promise<void> {
  const theme = getTheme(data.stats.currentStreak);
  p.intro(theme.bg(' GRIT Habit History '));
  p.note(`Current Streak: ${theme.fg(data.stats.currentStreak.toString())} ${theme.emoji} | Highest: ${data.stats.highestStreak} ${theme.emoji}`);

  if (data.history.length === 0) {
    p.outro('No history found yet. Start your journey today!');
    return;
  }

  const sorted = [...data.history].sort((a, b) => b.date.localeCompare(a.date));

  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() - 30);
  const thirtyDaysAgoStr = (limitDate.toISOString().split('T')[0] as string) || '';

  const entriesToShow = all ? sorted : sorted.filter(e => e.date >= thirtyDaysAgoStr);

  for (const entry of entriesToShow) {
    const successIcon = entry.success ? color.green('✔') : color.red('✖');
    
    // We summarize their arrays
    const parts = [];
    if (entry.problemSolving.length > 0) parts.push(`${entry.problemSolving.length}x Problems`);
    if (entry.reading.length > 0) parts.push(`${entry.reading.length}x Reading items`);
    if (entry.learning.length > 0) parts.push(`${entry.learning.length}x Learning items`);
    if (entry.coding.length > 0) parts.push(`${entry.coding.length}x Coding sessions`);
    
    console.log(` ${successIcon} ${color.bold(entry.date)}: [Score: ${entry.score}/4] -> ${parts.join(', ') || 'No habits'}`);
  }

  p.outro(all ? 'All history loaded.' : 'Showing last 30 days. Use --all for full history.');
}
