export interface ParsedChecklistNoteItem {
  name: string;
  checked: boolean;
  link?: string;
}

/** Returns the cleaned line after stripping bullets, numbers, and checkboxes (for URL detection). */
function getCleanedLine(raw: string): string {
  let line = raw.trim();
  if (!line) return "";
  line = line.replace(/^\d+[.):-]\s+/, "");
  line = line.replace(/^[•·◦▪▸▶➤➜\-*+]\s+/, "");
  if (/^\[[xX]\]\s*/.test(line)) line = line.replace(/^\[[xX]\]\s*/, "");
  else if (/^\[ \]\s*/.test(line)) line = line.replace(/^\[ \]\s*/, "");
  else line = line.replace(/^(☐|☑|✓|✗|✔)\s*/, "");
  return line.trim();
}

function parseLine(raw: string): { name: string; checked: boolean } | null {
  let line = raw.trim();
  if (!line) return null;

  // Strip numbered list and bullets first so "- [x] item" becomes "[x] item"
  line = line.replace(/^\d+[.):-]\s+/, "");
  line = line.replace(/^[•·◦▪▸▶➤➜\-*+]\s+/, "");

  let checked = false;
  if (/^\[[xX]\]\s*/.test(line)) {
    checked = true;
    line = line.replace(/^\[[xX]\]\s*/, "");
  } else if (/^\[ \]\s*/.test(line)) {
    line = line.replace(/^\[ \]\s*/, "");
  } else {
    const hadCheck = /^(☑|✓|✔)/.test(line);
    line = line.replace(/^(☐|☑|✓|✗|✔)\s*/, "");
    if (hadCheck) checked = true;
  }

  const name = line.trim();
  return name ? { name, checked } : null;
}

export function parseNotes(raw: string): ParsedChecklistNoteItem[] {
  const lines = raw.split(/\r?\n/);
  const items: ParsedChecklistNoteItem[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const cleaned = getCleanedLine(rawLine);
    if (cleaned && /^https?:\/\//.test(cleaned)) {
      if (items.length > 0 && !items[items.length - 1].link) {
        items[items.length - 1] = { ...items[items.length - 1], link: cleaned };
      }
      continue;
    }

    const parsed = parseLine(rawLine);
    if (parsed) {
      items.push({ name: parsed.name, checked: parsed.checked });
    }
  }

  return items;
}
