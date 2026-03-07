import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, promises as fs, statSync } from "node:fs";
import * as p from "@clack/prompts";
import color from "picocolors";

const CONFIG_PATH = join(homedir(), ".gritconfig");

export interface GritConfig {
  dataPath: string;
}

export async function getConfig(): Promise<GritConfig | null> {
  if (existsSync(CONFIG_PATH)) {
    try {
      const data = await fs.readFile(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(data) as GritConfig;
      if (parsed.dataPath) {
        try {
          const stat = statSync(parsed.dataPath);
          if (stat.isDirectory()) {
            return null;
          }
        } catch (e) {
          // File does not exist yet (fine)
        }
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }
  return null;
}

export async function saveConfig(config: GritConfig): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function promptForConfig(): Promise<GritConfig> {
  p.intro(color.bgCyan(color.black(" Welcome to Grit - Habit Tracker ")));
  p.note(
    "It looks like this is your first time running grit. Let's get set up!",
  );

  const defaultPath = join(homedir(), ".gritdata.json");

  const dataPath = await p.text({
    message: "Where would you like to store your habit data?",
    placeholder: defaultPath,
    initialValue: defaultPath,
    validate: (value) => {
      if (!value) return "Please enter a valid path";
      try {
        const stat = statSync(value as string);
        if (stat.isDirectory()) {
          return "Path must be a file, not a directory";
        }
      } catch (e) {
        // Path does not exist yet, which is fine
      }
    },
  });

  if (p.isCancel(dataPath)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const config: GritConfig = { dataPath: dataPath as string };
  await saveConfig(config);

  p.outro(`Awesome! Your data will be saved at ${color.cyan(config.dataPath)}`);
  return config;
}
