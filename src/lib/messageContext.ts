export const MESSAGE_CONTEXT_MARKER_REGEX =
  /\[Dormcheck:(listing|business|profile|post):([a-f0-9-]+)\]/i;

export type MessageContextType = 'listing' | 'business' | 'profile' | 'post';

export interface ParsedMessageContext {
  marker: { type: MessageContextType; id: string } | null;
  introText: string;
}

function isDividerLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= 3 && /^━+$/.test(trimmed);
}

export function parseMessageContext(content: string): ParsedMessageContext {
  const match = content.match(MESSAGE_CONTEXT_MARKER_REGEX);
  if (!match) {
    return { marker: null, introText: content };
  }

  const type = match[1].toLowerCase() as MessageContextType;
  const id = match[2];

  const lines = content.split('\n');
  const dividerIndex = lines.findIndex((line) => isDividerLine(line));

  let introText: string;
  if (dividerIndex >= 0) {
    introText = lines.slice(0, dividerIndex).join('\n');
  } else {
    introText = content.replace(MESSAGE_CONTEXT_MARKER_REGEX, '');
  }

  return {
    marker: { type, id },
    introText: introText.trim(),
  };
}

/**
 * Composes a DM that carries a shared listing. The marker is what
 * `MessagePreviewCard` resolves; `intro` is rendered as a plain bubble above
 * the card, so it must NOT restate the listing's price/category — that would
 * print the same listing twice, once as text and once as the card.
 */
export function buildListingShareContent(listingId: string, intro: string): string {
  return `${intro.trim()}\n[Dormcheck:listing:${listingId}]`;
}
