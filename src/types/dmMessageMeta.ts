/**
 * Structured attachment payload for a DM (`messages.metadata`, jsonb; added in
 * migration 20260825000000). A message is either plain text (metadata null) or
 * carries one of these. `content` on the row ALWAYS holds a human-readable
 * fallback, so an older client and the `conversations.last_message` preview
 * still render something sensible.
 *
 * Deliberately mirrors `GroupMessageMetadata` in shape and discipline rather
 * than inventing a second convention for the same problem.
 */
export type DmImageMessageMetadata = {
  type: 'image';
  /** Public URL in the `dm-photos` bucket. */
  url: string;
  /** Intrinsic pixel size, when the browser could read it — lets the bubble
   *  reserve the right box and avoid a layout jump when the image decodes. */
  width?: number | null;
  height?: number | null;
};

/** A private object in `dm-audio`; never a public or durable download URL. */
export type DmAudioMessageMetadata = {
  type: 'audio';
  /** `<conversation-id>/<sender-id>/<random>.m4a`, protected by Storage RLS. */
  path: string;
  /** Playback length captured before upload, in whole milliseconds. */
  durationMs: number;
  /** MIME type recorded by the device, useful for the player fallback. */
  mimeType?: string | null;
};

/** Static poll definition; votes live in `dm_poll_votes` for realtime updates. */
export type DmPollMessageMetadata = {
  type: 'poll';
  question: string;
  options: string[];
};

export type DmMessageMetadata =
  | DmImageMessageMetadata
  | DmAudioMessageMetadata
  | DmPollMessageMetadata;

/** Narrow an unknown jsonb value to any valid DM attachment, else null. */
export function parseDmAttachmentMetadata(raw: unknown): DmMessageMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.type === 'image' && typeof m.url === 'string' && m.url) {
    return {
      type: 'image',
      url: m.url,
      width: typeof m.width === 'number' ? m.width : null,
      height: typeof m.height === 'number' ? m.height : null,
    };
  }
  if (
    m.type === 'audio'
    && typeof m.path === 'string'
    && m.path
    && typeof m.durationMs === 'number'
    && Number.isFinite(m.durationMs)
    && m.durationMs > 0
  ) {
    return {
      type: 'audio',
      path: m.path,
      durationMs: Math.round(m.durationMs),
      mimeType: typeof m.mimeType === 'string' ? m.mimeType : null,
    };
  }
  if (
    m.type === 'poll'
    && typeof m.question === 'string'
    && m.question.trim()
    && Array.isArray(m.options)
    && m.options.length >= 2
    && m.options.length <= 8
    && m.options.every((option) => typeof option === 'string' && option.trim())
  ) {
    return {
      type: 'poll',
      question: m.question.trim(),
      options: m.options.map((option) => (option as string).trim()),
    };
  }
  return null;
}

/**
 * Existing photo renderers intentionally stay image-narrow until the shared
 * audio/poll renderer is mounted. This compatibility helper avoids treating an
 * audio/poll payload as an image while old clients roll forward.
 */
export function parseDmMessageMetadata(raw: unknown): DmImageMessageMetadata | null {
  const attachment = parseDmAttachmentMetadata(raw);
  return attachment?.type === 'image' ? attachment : null;
}
