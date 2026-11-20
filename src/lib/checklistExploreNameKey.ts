/** Normalized key for matching explore product titles to checklist `item` text (trim + case-insensitive). */
export function checklistExploreNameKey(name: string): string {
  return name.trim().toLowerCase();
}
