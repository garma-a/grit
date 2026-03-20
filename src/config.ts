/**
 * Configuration Module for Grit Habit Tracker
 * 
 * Manages application configuration including database path.
 * Includes extensive defensive programming with assert statements.
 */

import assert from "node:assert";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, statSync, promises as fs } from "node:fs";
import * as p from "@clack/prompts";
import color from "picocolors";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG_PATH = join(homedir(), ".gritconfig");

// ── ASSERTION: CONFIG_PATH validation ──
assert(typeof CONFIG_PATH === 'string', '[CONFIG] CONFIG_PATH must be a string');
assert(CONFIG_PATH.length > 0, '[CONFIG] CONFIG_PATH cannot be empty');
assert(CONFIG_PATH.includes('.gritconfig'), '[CONFIG] CONFIG_PATH must contain .gritconfig');

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface GritConfig {
  dataPath: string;
  /** @deprecated Use dataPath which now points to .db file */
  legacyJsonPath?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the current configuration
 * 
 * Returns null if:
 * - Config file doesn't exist
 * - Config file is invalid JSON
 * - dataPath is a directory instead of a file
 */
export async function getConfig(): Promise<GritConfig | null> {
  // ── Check if config file exists ──
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }

  try {
    const data = await fs.readFile(CONFIG_PATH, "utf-8");
    
    // ── ASSERTION: file content validation ──
    assert(typeof data === 'string', '[GET_CONFIG] File content must be a string');
    
    const parsed = JSON.parse(data);
    
    // ── ASSERTION: parsed structure validation ──
    assert(typeof parsed === 'object' && parsed !== null, '[GET_CONFIG] Config must be a non-null object');
    
    // ── Handle legacy JSON path migration ──
    let dataPath = parsed.dataPath;
    
    if (typeof dataPath !== 'string' || dataPath.length === 0) {
      return null;
    }
    
    // ── Convert legacy .json path to .db path ──
    if (dataPath.endsWith('.json')) {
      const newDbPath = dataPath.replace(/\.json$/, '.db');
      
      // ── Store original for migration reference ──
      parsed.legacyJsonPath = dataPath;
      parsed.dataPath = newDbPath;
      dataPath = newDbPath;
      
      // ── Save updated config ──
      await saveConfig(parsed);
    }
    
    // ── Validate dataPath is not a directory ──
    if (dataPath) {
      try {
        const stat = statSync(dataPath);
        if (stat.isDirectory()) {
          // ── ASSERTION: dataPath should not be a directory ──
          assert(false, `[GET_CONFIG] dataPath is a directory, not a file: ${dataPath}`);
          return null;
        }
      } catch (e) {
        // ── File does not exist yet (fine) ──
        // ── But we should verify parent directory is valid ──
        const parentDir = dirname(dataPath);
        if (existsSync(parentDir)) {
          try {
            const parentStat = statSync(parentDir);
            // ── ASSERTION: parent must be a directory ──
            assert(parentStat.isDirectory(), `[GET_CONFIG] Parent path is not a directory: ${parentDir}`);
          } catch {
            // ── Parent doesn't exist, will be created later ──
          }
        }
      }
    }
    
    const config: GritConfig = {
      dataPath: parsed.dataPath,
      legacyJsonPath: parsed.legacyJsonPath
    };
    
    // ── ASSERTION: final config validation ──
    assert(typeof config.dataPath === 'string', '[GET_CONFIG] config.dataPath must be a string');
    assert(config.dataPath.length > 0, '[GET_CONFIG] config.dataPath cannot be empty');
    
    return config;
    
  } catch (e) {
    // ── Config file exists but is invalid ──
    return null;
  }
}

/**
 * Save configuration to disk
 */
export async function saveConfig(config: GritConfig): Promise<void> {
  // ── ASSERTION: input validation ──
  assert(typeof config === 'object' && config !== null, '[SAVE_CONFIG] config must be a non-null object');
  assert(typeof config.dataPath === 'string', '[SAVE_CONFIG] config.dataPath must be a string');
  assert(config.dataPath.length > 0, '[SAVE_CONFIG] config.dataPath cannot be empty');
  
  // ── Ensure dataPath ends with .db ──
  if (!config.dataPath.endsWith('.db')) {
    if (config.dataPath.endsWith('.json')) {
      // ── Store legacy path and convert ──
      config.legacyJsonPath = config.dataPath;
      config.dataPath = config.dataPath.replace(/\.json$/, '.db');
    } else {
      config.dataPath = config.dataPath + '.db';
    }
  }
  
  // ── ASSERTION: dataPath ends with .db ──
  assert(config.dataPath.endsWith('.db'), `[SAVE_CONFIG] dataPath must end with .db, got: ${config.dataPath}`);
  
  const configJson = JSON.stringify(config, null, 2);
  
  // ── ASSERTION: JSON string validation ──
  assert(typeof configJson === 'string', '[SAVE_CONFIG] JSON.stringify must return a string');
  assert(configJson.length > 0, '[SAVE_CONFIG] Config JSON cannot be empty');
  
  await fs.writeFile(CONFIG_PATH, configJson, "utf-8");
  
  // ── ASSERTION: verify file was written ──
  assert(existsSync(CONFIG_PATH), '[SAVE_CONFIG] Config file should exist after write');
}

/**
 * Prompt user for initial configuration
 */
export async function promptForConfig(): Promise<GritConfig> {
  p.intro(color.bgCyan(color.black(" Welcome to Grit - Habit Tracker ")));
  p.note(
    "It looks like this is your first time running grit. Let's get set up!",
  );

  const defaultPath = join(homedir(), ".gritdata.db");
  
  // ── ASSERTION: default path validation ──
  assert(typeof defaultPath === 'string', '[PROMPT_CONFIG] defaultPath must be a string');
  assert(defaultPath.endsWith('.db'), '[PROMPT_CONFIG] defaultPath must end with .db');

  const dataPath = await p.text({
    message: "Where would you like to store your habit database?",
    placeholder: defaultPath,
    initialValue: defaultPath,
    validate: (value) => {
      // ── Validation: non-empty ──
      if (!value || !value.trim()) {
        return "Please enter a valid path";
      }
      
      const trimmedValue = value.trim();
      
      // ── Validation: not a directory ──
      try {
        const stat = statSync(trimmedValue);
        if (stat.isDirectory()) {
          return "Path must be a file, not a directory";
        }
      } catch (e) {
        // ── Path does not exist yet, which is fine ──
      }
      
      // ── Validation: parent directory is accessible ──
      const parentDir = dirname(trimmedValue);
      if (existsSync(parentDir)) {
        try {
          const parentStat = statSync(parentDir);
          if (!parentStat.isDirectory()) {
            return "Parent path is not a directory";
          }
        } catch {
          return "Cannot access parent directory";
        }
      }
      
      return undefined; // Valid
    },
  });

  if (p.isCancel(dataPath)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // ── ASSERTION: user input validation ──
  assert(typeof dataPath === 'string', '[PROMPT_CONFIG] dataPath must be a string');
  assert(dataPath.length > 0, '[PROMPT_CONFIG] dataPath cannot be empty');

  // ── Ensure path ends with .db ──
  let finalPath = dataPath as string;
  if (!finalPath.endsWith('.db')) {
    if (finalPath.endsWith('.json')) {
      finalPath = finalPath.replace(/\.json$/, '.db');
    } else {
      finalPath = finalPath + '.db';
    }
  }
  
  // ── ASSERTION: final path validation ──
  assert(finalPath.endsWith('.db'), `[PROMPT_CONFIG] finalPath must end with .db, got: ${finalPath}`);

  const config: GritConfig = { dataPath: finalPath };
  
  await saveConfig(config);

  p.outro(`Awesome! Your data will be saved at ${color.cyan(config.dataPath)}`);
  
  return config;
}

/**
 * Get the config file path (for debugging/info)
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Check if a legacy JSON file exists for migration
 */
export function hasLegacyJsonFile(config: GritConfig): boolean {
  // ── ASSERTION: input validation ──
  assert(typeof config === 'object' && config !== null, '[HAS_LEGACY] config must be a non-null object');
  
  // ── Check explicit legacy path ──
  if (config.legacyJsonPath && existsSync(config.legacyJsonPath)) {
    return true;
  }
  
  // ── Check if there's a .json file alongside the .db path ──
  if (config.dataPath.endsWith('.db')) {
    const jsonPath = config.dataPath.replace(/\.db$/, '.json');
    if (existsSync(jsonPath)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get the legacy JSON file path if it exists
 */
export function getLegacyJsonPath(config: GritConfig): string | null {
  // ── ASSERTION: input validation ──
  assert(typeof config === 'object' && config !== null, '[GET_LEGACY] config must be a non-null object');
  
  // ── Check explicit legacy path ──
  if (config.legacyJsonPath && existsSync(config.legacyJsonPath)) {
    return config.legacyJsonPath;
  }
  
  // ── Check if there's a .json file alongside the .db path ──
  if (config.dataPath.endsWith('.db')) {
    const jsonPath = config.dataPath.replace(/\.db$/, '.json');
    if (existsSync(jsonPath)) {
      return jsonPath;
    }
  }
  
  return null;
}
