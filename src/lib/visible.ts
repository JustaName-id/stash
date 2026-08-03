import type { Item } from "../types";

/** Items to render: scoped to the active section (header included) when one
 * is active, then filtered by the done toggle (headers always show). */
export function visibleItems(
  items: Item[],
  activeSection: string | null,
  showDone: boolean,
  query = "",
): Item[] {
  const q = query.trim().toLowerCase();
  if (q) {
    // Search is global: flat, case-insensitive match across all sections.
    return items.filter(
      (i) =>
        i.text.toLowerCase().includes(q) &&
        (i.kind === "section" || showDone || !i.done),
    );
  }
  // The active section only routes captures — it never filters the view
  // (all sections and loose items stay visible, like the reference app).
  void activeSection;
  return showDone
    ? items
    : items.filter((i) => i.kind === "section" || !i.done);
}

/** Bulk-copy text: selected items joined by newlines in list order (AC-13). */
export function joinSelection(items: Item[], selectedIds: string[]): string {
  const selected = new Set(selectedIds);
  return items
    .filter((i) => selected.has(i.id))
    .map((i) => i.text)
    .join("\n");
}
