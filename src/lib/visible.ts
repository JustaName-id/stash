import type { Item } from "../types";

/** Items to render: scoped to the active section (header included) when one
 * is active, then filtered by the done toggle (headers always show). */
export function visibleItems(
  items: Item[],
  activeSection: string | null,
  showDone: boolean,
  query = "",
  collapsed: string[] = [],
): Item[] {
  const q = query.trim().toLowerCase();
  if (q) {
    // Search is global: flat, case-insensitive match across all sections,
    // ignoring collapse so matches are always findable.
    return items.filter(
      (i) =>
        i.text.toLowerCase().includes(q) &&
        (i.kind === "section" || showDone || !i.done),
    );
  }
  // The active section only routes captures — it never filters the view.
  void activeSection;
  const hiddenSections = new Set(collapsed);
  const out: Item[] = [];
  let hiding = false;
  for (const i of items) {
    if (i.kind === "section") {
      hiding = hiddenSections.has(i.id);
      out.push(i);
      continue;
    }
    if (hiding) continue;
    if (!showDone && i.done) continue;
    out.push(i);
  }
  return out;
}

/** Bulk-copy text: selected items joined by newlines in list order (AC-13). */
export function joinSelection(items: Item[], selectedIds: string[]): string {
  const selected = new Set(selectedIds);
  return items
    .filter((i) => selected.has(i.id))
    .map((i) => i.text)
    .join("\n");
}
