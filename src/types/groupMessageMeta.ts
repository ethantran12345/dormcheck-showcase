/**
 * Structured attachment payload for a group/community chat message
 * (`group_messages.metadata`, jsonb). A message is either plain text (metadata
 * null) or carries one of these. `content` on the row always holds a
 * human-readable fallback so old clients and last_message previews still work.
 *
 * Added 2026-07-20 with migration 20260818000000_group_messages_metadata.
 */
export type GroupMessageMetadata =
  | {
      type: 'checklist_item';
      /** checklist_items.id - lets the card deep-link / dedupe later. */
      itemId: string;
      /** Display name (checklist_items.item). */
      name: string;
      /** checklist_items.category, for the card subtitle. */
      category?: string | null;
      /** Lucide icon name (checklist_items.icon_name), if any. */
      iconName?: string | null;
      /** Product image (checklist_items.image_url), if any. */
      imageUrl?: string | null;
    }
  | {
      type: 'instagram';
      /** Handle without the leading '@'. */
      username: string;
    };

/** Narrow an unknown jsonb value to a valid GroupMessageMetadata, else null. */
export function parseGroupMessageMetadata(raw: unknown): GroupMessageMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.type === 'checklist_item' && typeof m.itemId === 'string' && typeof m.name === 'string') {
    return {
      type: 'checklist_item',
      itemId: m.itemId,
      name: m.name,
      category: typeof m.category === 'string' ? m.category : null,
      iconName: typeof m.iconName === 'string' ? m.iconName : null,
      imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl : null,
    };
  }
  if (m.type === 'instagram' && typeof m.username === 'string' && m.username.trim()) {
    return { type: 'instagram', username: m.username.trim().replace(/^@+/, '') };
  }
  return null;
}
