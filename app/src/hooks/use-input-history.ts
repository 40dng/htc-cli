import { useRef } from "react";
import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const HISTORY_FILE = join(homedir(), ".htc", "input_history.json");
const MAX = 100;

function load(): string[] {
  try { return JSON.parse(readFileSync(HISTORY_FILE, "utf-8")); }
  catch { return []; }
}

function persist(h: string[]) {
  try {
    mkdirSync(join(homedir(), ".htc"), { recursive: true });
    writeFileSync(HISTORY_FILE, JSON.stringify(h), "utf-8");
  } catch {}
}

export function useInputHistory() {
  const history = useRef<string[]>(load());
  const cursor  = useRef(-1);

  const push = (text: string) => {
    const h = history.current;
    if (text && h[0] !== text) {
      history.current = [text, ...h].slice(0, MAX);
      persist(history.current);
    }
    cursor.current = -1;
  };

  const up = (): string | null => {
    const h = history.current;
    if (!h.length) return null;
    cursor.current = Math.min(cursor.current + 1, h.length - 1);
    return h[cursor.current]!;
  };

  const down = (): string => {
    if (cursor.current <= 0) { cursor.current = -1; return ""; }
    cursor.current--;
    return history.current[cursor.current]!;
  };

  const reset = () => { cursor.current = -1; };

  return { push, up, down, reset };
}
