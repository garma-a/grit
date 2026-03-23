/**
 * Quick Log Module for Grit Habit Tracker
 * 
 * Allows quick, real-time logging of activities throughout the day
 * with a visual grid interface and single-key shortcuts.
 */

import * as p from '@clack/prompts';
import color from 'picocolors';
import boxen from 'boxen';
import type { GritData } from './database.js';
import { getOrCreateTodayEntry, ensureCategory, saveData, computeDailySuccessAndScore, updateStats } from './storage.js';
import { updateEntryPoints, calculateTier, getTierBadge } from './points.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY SHORTCUTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ActivityShortcut {
  key: string;
  emoji: string;
  name: string;
  category: 'problem' | 'reading' | 'learning' | 'coding' | 'english';
  color: (text: string) => string;
}

export const ACTIVITY_SHORTCUTS: ActivityShortcut[] = [
  { key: 'p', emoji: '🧩', name: 'Problem Solving', category: 'problem', color: color.blue },
  { key: 'r', emoji: '📚', name: 'Reading', category: 'reading', color: color.yellow },
  { key: 'l', emoji: '🎓', name: 'Learning', category: 'learning', color: color.magenta },
  { key: 'c', emoji: '💻', name: 'Coding', category: 'coding', color: color.green },
  { key: 'e', emoji: '🇬🇧', name: 'English', category: 'english', color: color.cyan },
];

// ═══════════════════════════════════════════════════════════════════════════════
// GRID DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a visual grid display of all activities
 */
export function createActivityGrid(currentPoints: number, tierBadge: string): string {
  const lines: string[] = [];
  
  // Header
  lines.push('');
  lines.push(color.bold(color.cyan(`  GRIT QUICK LOG - Points: ${color.yellow(currentPoints.toString())} ${tierBadge}`)));
  lines.push(color.cyan('  ═══════════════════════════════════════════════'));
  lines.push('');
  
  // Simple list layout
  const shortcuts = ACTIVITY_SHORTCUTS;
  
  lines.push(`  ${shortcuts[0]!.color(`[${shortcuts[0]!.key.toUpperCase()}]`)} ${shortcuts[0]!.emoji}  ${shortcuts[0]!.name.padEnd(18)} ${shortcuts[1]!.color(`[${shortcuts[1]!.key.toUpperCase()}]`)} ${shortcuts[1]!.emoji}  ${shortcuts[1]!.name}`);
  lines.push(`  ${shortcuts[2]!.color(`[${shortcuts[2]!.key.toUpperCase()}]`)} ${shortcuts[2]!.emoji}  ${shortcuts[2]!.name.padEnd(18)} ${shortcuts[3]!.color(`[${shortcuts[3]!.key.toUpperCase()}]`)} ${shortcuts[3]!.emoji}  ${shortcuts[3]!.name}`);
  lines.push(`  ${shortcuts[4]!.color(`[${shortcuts[4]!.key.toUpperCase()}]`)} ${shortcuts[4]!.emoji}  ${shortcuts[4]!.name.padEnd(18)} ${color.red('[Q]')} 🚪 Exit`);
  
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Show a compact summary of today's activities
 */
export function showTodaySummary(data: GritData): string {
  const entry = getOrCreateTodayEntry(data);
  
  const lines: string[] = [];
  lines.push(color.bold('\n📊 Today\'s Activities:'));
  
  // Problem solving
  const problemCount = entry.problemSolving.reduce((sum, p) => sum + p.count, 0);
  lines.push(`  ${ACTIVITY_SHORTCUTS[0]?.emoji} Problems: ${problemCount > 0 ? color.green(`${problemCount} solved`) : color.dim('None')}`);
  
  // Reading
  const readingSessions = entry.reading.length;
  const totalPages = entry.reading.reduce((sum, r) => sum + (r.pages || 0), 0);
  lines.push(`  ${ACTIVITY_SHORTCUTS[1]?.emoji} Reading: ${readingSessions > 0 ? color.green(`${readingSessions} session(s), ${totalPages} pages`) : color.dim('None')}`);
  
  // Learning
  const learningSessions = entry.learning.length;
  const totalLearningMins = entry.learning.reduce((sum, l) => sum + (l.duration || 30), 0);
  lines.push(`  ${ACTIVITY_SHORTCUTS[2]?.emoji} Learning: ${learningSessions > 0 ? color.green(`${learningSessions} session(s), ${totalLearningMins} min`) : color.dim('None')}`);
  
  // Coding
  const codingSessions = entry.coding.length;
  const totalCodingMins = entry.coding.reduce((sum, c) => sum + c.timeSpent, 0);
  lines.push(`  ${ACTIVITY_SHORTCUTS[3]?.emoji} Coding: ${codingSessions > 0 ? color.green(`${codingSessions} session(s), ${totalCodingMins} min`) : color.dim('None')}`);
  
  // English
  const englishSessions = entry.englishLearning.length;
  lines.push(`  ${ACTIVITY_SHORTCUTS[4]?.emoji} English: ${englishSessions > 0 ? color.green(`${englishSessions} session(s)`) : color.dim('None')}`);
  
  // Points and score
  lines.push('');
  lines.push(`  💎 Points Today: ${color.yellow(`+${entry.pointsEarned}`)}`);
  lines.push(`  ⭐ Daily Score: ${entry.score >= 3 ? color.green(`${entry.score}/4 ✅`) : color.yellow(`${entry.score}/4`)}`);
  
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY LOGGING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quick log a problem solving activity
 */
async function logProblem(data: GritData): Promise<boolean> {
  const entry = getOrCreateTodayEntry(data);
  
  const count = await p.text({
    message: 'How many problems?',
    placeholder: '1',
    initialValue: '1',
    validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Enter a number'
  });
  
  if (p.isCancel(count)) return false;
  
  const difficulty = await p.select({
    message: 'Difficulty?',
    options: [
      { value: 'Easy', label: '🟢 Easy (8 pts each)' },
      { value: 'Medium', label: '🟡 Medium (10 pts each)' },
      { value: 'Hard', label: '🔴 Hard (20 pts each)' }
    ]
  });
  
  if (p.isCancel(difficulty)) return false;
  
  const topics = await p.text({
    message: 'Topics (comma separated)?',
    placeholder: 'Arrays, Strings',
    initialValue: 'LeetCode'
  });
  
  if (p.isCancel(topics)) return false;
  
  const topicsList = (topics as string).split(',').map(t => t.trim()).filter(t => t);
  
  entry.problemSolving.push({
    difficulty: difficulty as string,
    count: parseInt(count as string) || 1,
    topics: topicsList
  });
  
  p.log.success(color.green(`✓ Logged ${count} ${difficulty} problem(s)`));
  return true;
}

/**
 * Quick log a reading activity
 */
async function logReading(data: GritData): Promise<boolean> {
  const entry = getOrCreateTodayEntry(data);
  
  const type = await p.select({
    message: 'What did you read?',
    options: [
      { value: 'book', label: '📖 Book (1 pt/page)' },
      { value: 'article', label: '📄 Article (10 pts)' },
      { value: 'docs', label: '📚 Documentation (10 pts)' }
    ]
  });
  
  if (p.isCancel(type)) return false;
  
  const category = await p.text({
    message: 'Category?',
    placeholder: 'Backend, Testing, etc.',
    initialValue: data.categories.reading[0] || 'General'
  });
  
  if (p.isCancel(category)) return false;
  
  const topic = await p.text({
    message: 'Topic/Title?',
    placeholder: 'Name of the book/article'
  });
  
  if (p.isCancel(topic)) return false;
  
  let pages: number | undefined;
  if (type === 'book') {
    const pagesInput = await p.text({
      message: 'How many pages?',
      placeholder: '10',
      validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Enter a number'
    });
    
    if (p.isCancel(pagesInput)) return false;
    pages = parseInt(pagesInput as string) || undefined;
  }
  
  ensureCategory(data.categories.reading, category as string);
  
  entry.reading.push({
    type: type as 'article' | 'docs' | 'book',
    category: category as string,
    topic: topic as string,
    pages
  });
  
  const pointsEarned = type === 'book' && pages ? pages : 10;
  p.log.success(color.green(`✓ Logged ${type} (+${pointsEarned} pts)`));
  return true;
}

/**
 * Quick log a learning activity
 */
async function logLearning(data: GritData): Promise<boolean> {
  const entry = getOrCreateTodayEntry(data);
  
  const duration = await p.text({
    message: 'Duration in minutes?',
    placeholder: '30',
    validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Enter minutes as a number'
  });
  
  if (p.isCancel(duration)) return false;
  
  const category = await p.text({
    message: 'Category?',
    placeholder: 'Algorithms, System Design, etc.',
    initialValue: data.categories.learning[0] || 'General'
  });
  
  if (p.isCancel(category)) return false;
  
  const topic = await p.text({
    message: 'What did you learn?',
    placeholder: 'Specific topic'
  });
  
  if (p.isCancel(topic)) return false;
  
  ensureCategory(data.categories.learning, category as string);
  
  const mins = parseInt(duration as string) || 30;
  
  entry.learning.push({
    category: category as string,
    topic: topic as string,
    duration: mins
  });
  
  const pointsEarned = Math.round(mins * (20 / 60));
  p.log.success(color.green(`✓ Logged ${mins} min learning (+${pointsEarned} pts)`));
  return true;
}

/**
 * Quick log a coding activity
 */
async function logCoding(data: GritData): Promise<boolean> {
  const entry = getOrCreateTodayEntry(data);
  
  const duration = await p.text({
    message: 'Duration in minutes?',
    placeholder: '30',
    validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Enter minutes as a number'
  });
  
  if (p.isCancel(duration)) return false;
  
  const category = await p.text({
    message: 'Category?',
    placeholder: 'API, UI, Scripting, etc.',
    initialValue: data.categories.coding[0] || 'General'
  });
  
  if (p.isCancel(category)) return false;
  
  const topic = await p.text({
    message: 'What did you build?',
    placeholder: 'Specific project/feature'
  });
  
  if (p.isCancel(topic)) return false;
  
  ensureCategory(data.categories.coding, category as string);
  
  const mins = parseInt(duration as string) || 30;
  
  entry.coding.push({
    category: category as string,
    topic: topic as string,
    timeSpent: mins
  });
  
  const pointsEarned = Math.round(mins * (20 / 60));
  p.log.success(color.green(`✓ Logged ${mins} min coding (+${pointsEarned} pts)`));
  return true;
}

/**
 * Quick log an English learning activity
 */
async function logEnglish(data: GritData): Promise<boolean> {
  const entry = getOrCreateTodayEntry(data);
  
  const type = await p.select({
    message: 'Type of practice?',
    options: [
      { value: 'video', label: '🎬 Video (10 pts/hour)' },
      { value: 'book_grammar', label: '📖 Grammar (10 pts)' },
      { value: 'book_vocabulary', label: '📝 Vocabulary (2 pts/word)' },
      { value: 'speaking_ai', label: '🗣️  Speaking (1 pt/min)' }
    ]
  });
  
  if (p.isCancel(type)) return false;
  
  const logEntry: any = { type };
  let pointsEarned = 0;
  
  if (type === 'video') {
    const duration = await p.text({
      message: 'Duration in minutes?',
      placeholder: '30',
      validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Enter minutes as a number'
    });
    
    if (p.isCancel(duration)) return false;
    
    const mins = parseInt(duration as string) || 0;
    logEntry.durationMinutes = mins;
    pointsEarned = Math.round(mins * (10 / 60));
    
  } else if (type === 'book_grammar') {
    pointsEarned = 10;
    
  } else if (type === 'book_vocabulary') {
    const words = await p.text({
      message: 'How many new words?',
      placeholder: '5',
      validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Enter a number'
    });
    
    if (p.isCancel(words)) return false;
    
    const wordCount = parseInt(words as string) || 0;
    logEntry.wordsCount = wordCount;
    pointsEarned = wordCount * 2;
    
  } else if (type === 'speaking_ai') {
    const duration = await p.text({
      message: 'Duration in minutes?',
      placeholder: '10',
      validate: (val) => /^\d+$/.test(val || '') ? undefined : 'Enter minutes as a number'
    });
    
    if (p.isCancel(duration)) return false;
    
    const mins = parseInt(duration as string) || 0;
    logEntry.durationMinutes = mins;
    pointsEarned = mins;
  }
  
  entry.englishLearning.push(logEntry);
  
  p.log.success(color.green(`✓ Logged English practice (+${pointsEarned} pts)`));
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN QUICK LOG INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the quick log interface
 */
export async function runQuickLog(data: GritData, dataPath: string): Promise<void> {
  let continueLogging = true;
  
  while (continueLogging) {
    console.clear();
    
    // Calculate current tier
    const tierInfo = calculateTier(data.stats.currentPoints, data.stats.monthlySubtractionAmount);
    const tierBadge = getTierBadge(tierInfo);
    
    // Show grid
    console.log('\n' + createActivityGrid(data.stats.currentPoints, tierBadge));
    
    // Show today's summary
    console.log(showTodaySummary(data));
    
    // Get activity choice
    console.log('\n' + color.dim('Press a letter key to log an activity, or Q to quit and save.'));
    
    const choice = await p.text({
      message: 'What did you just do?',
      placeholder: 'p/r/l/c/e or q',
      validate: (val) => {
        const v = (val || '').toLowerCase();
        if (['p', 'r', 'l', 'c', 'e', 'q'].includes(v)) return undefined;
        return 'Enter p, r, l, c, e, or q';
      }
    });
    
    if (p.isCancel(choice) || (choice as string).toLowerCase() === 'q') {
      continueLogging = false;
      break;
    }
    
    const key = (choice as string).toLowerCase();
    let logged = false;
    
    try {
      switch (key) {
        case 'p':
          logged = await logProblem(data);
          break;
        case 'r':
          logged = await logReading(data);
          break;
        case 'l':
          logged = await logLearning(data);
          break;
        case 'c':
          logged = await logCoding(data);
          break;
        case 'e':
          logged = await logEnglish(data);
          break;
      }
      
      // If activity was logged, update points and save
      if (logged) {
        const entry = getOrCreateTodayEntry(data);
        computeDailySuccessAndScore(entry);
        updateEntryPoints(entry, data);
        updateStats(data);
        await saveData(dataPath, data);
        
        // Brief pause to show success message
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
    } catch (error) {
      console.error(color.red('Error logging activity:'), error);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  
  // Final summary
  console.clear();
  const entry = getOrCreateTodayEntry(data);
  const finalTierInfo = calculateTier(data.stats.currentPoints, data.stats.monthlySubtractionAmount);
  
  console.log(
    boxen(
      `${color.bold('Session Complete!')}\n\n` +
      `${color.bold('Today\'s Summary:')}\n` +
      `  Score: ${entry.score >= 3 ? color.green(`${entry.score}/4 ✅`) : color.yellow(`${entry.score}/4`)}\n` +
      `  Points Earned: ${color.yellow(`+${entry.pointsEarned}`)}\n` +
      `  Total Points: ${color.bold(data.stats.currentPoints.toString())}\n` +
      `  Tier: ${getTierBadge(finalTierInfo)}`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'green',
        textAlignment: 'left'
      }
    )
  );
  
  p.outro(color.dim('Great work! Keep grinding! 💪'));
}
