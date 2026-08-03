import { create } from "zustand";
import type { Item } from "./types";
import { detectKind } from "./lib/links";
import { visibleItems } from "./lib/visible";

const SECTION_RE = /^#\s*(.+)$/;

export interface StashState {
  items: Item[];
  showDone: boolean;
  hydrated: boolean;
  selected: string[];
  activeSection: string | null;
  pinned: boolean;
  persistFailed: boolean;
  add: (text: string) => void;
  addFromInbox: (text: string, sectionName: string | null) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  setShowDone: (show: boolean) => void;
  hydrate: (items: Item[]) => void;
  searchQuery: string;
  anchorId: string | null;
  collapsed: string[];
  toggleCollapsed: (id: string) => void;
  toggleSelected: (id: string) => void;
  selectOnly: (id: string) => void;
  selectRange: (toId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  updateText: (id: string, text: string) => void;
  mergeSelected: () => void;
  moveToSection: (ids: string[], sectionId: string | null) => void;
  toggleDoneSelected: () => void;
  setSearchQuery: (q: string) => void;
  removeDone: () => void;
  moveItem: (id: string, dropIndex: number) => void;
  cycleActiveSection: () => void;
  setActiveSection: (id: string | null) => void;
  removeSelected: () => void;
  setPinned: (pinned: boolean) => void;
  setPersistFailed: (failed: boolean) => void;
}

export function createStashStore() {
  return create<StashState>()((set) => ({
    items: [],
    showDone: true,
    hydrated: false,
    selected: [],
    activeSection: null,
    pinned: true,
    persistFailed: false,
    searchQuery: "",
    anchorId: null,
    collapsed: [],
    // Collapsing changes the view, so the selection clears (AC-13 rule).
    toggleCollapsed: (id) =>
      set((s) => ({
        collapsed: s.collapsed.includes(id)
          ? s.collapsed.filter((x) => x !== id)
          : [...s.collapsed, id],
        selected: [],
        anchorId: null,
      })),
    add: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const sectionName = SECTION_RE.exec(trimmed)?.[1];
      set((s) => {
        if (sectionName) {
          // `# Name` creates a section and makes it the capture target. It
          // goes to the end of the list so existing loose items stay above
          // the first header (i.e. in no section) — membership is positional.
          const section: Item = {
            id: crypto.randomUUID(),
            text: sectionName.trim(),
            kind: "section",
            done: false,
            createdAt: Date.now(),
          };
          return { items: [...s.items, section], activeSection: section.id };
        }
        const item: Item = {
          id: crypto.randomUUID(),
          text: trimmed,
          kind: detectKind(trimmed),
          done: false,
          createdAt: Date.now(),
        };
        // Captures land right below the active section's header (AC-16),
        // or at the top of the list when no section is active.
        if (s.activeSection) {
          const at = s.items.findIndex((i) => i.id === s.activeSection);
          if (at !== -1) {
            const items = [...s.items];
            items.splice(at + 1, 0, item);
            // Never capture into a collapsed (invisible) section.
            return {
              items,
              collapsed: s.collapsed.filter((c) => c !== s.activeSection),
            };
          }
        }
        return { items: [item, ...s.items] };
      });
    },
    // MCP captures: file under the named section if one matches
    // (case-insensitive), else top of the Inbox.
    addFromInbox: (text, sectionName) =>
      set((s) => {
        const trimmed = text.trim();
        if (!trimmed) return s;
        const item: Item = {
          id: crypto.randomUUID(),
          text: trimmed,
          kind: detectKind(trimmed),
          done: false,
          createdAt: Date.now(),
        };
        if (sectionName) {
          const sec = s.items.find(
            (i) =>
              i.kind === "section" &&
              i.text.toLowerCase() === sectionName.toLowerCase(),
          );
          if (sec) {
            const at = s.items.findIndex((i) => i.id === sec.id);
            const items = [...s.items];
            items.splice(at + 1, 0, item);
            return {
              items,
              collapsed: s.collapsed.filter((c) => c !== sec.id),
            };
          }
        }
        return { items: [item, ...s.items] };
      }),
    toggle: (id) =>
      set((s) => ({
        items: s.items.map((i) =>
          i.id === id && i.kind !== "section" ? { ...i, done: !i.done } : i,
        ),
      })),
    remove: (id) =>
      set((s) => ({
        items: s.items.filter((i) => i.id !== id),
        selected: s.selected.filter((x) => x !== id),
        activeSection: s.activeSection === id ? null : s.activeSection,
        collapsed: s.collapsed.filter((c) => c !== id),
      })),
    // View changes clear the selection so hidden items are never silently
    // copied by ⌘C (AC-13).
    setShowDone: (show) => set({ showDone: show, selected: [], anchorId: null }),
    // Merge below in-memory items: anything captured before hydration finishes
    // is newer than the persisted list and must survive (AC-E4).
    hydrate: (persisted) =>
      set((s) =>
        s.hydrated ? s : { items: [...s.items, ...persisted], hydrated: true },
      ),
    toggleSelected: (id) =>
      set((s) => {
        const item = s.items.find((i) => i.id === id);
        if (!item || item.kind === "section") return s;
        return {
          anchorId: id,
          selected: s.selected.includes(id)
            ? s.selected.filter((x) => x !== id)
            : [...s.selected, id],
        };
      }),
    // Shift-click: select the visible range between the anchor (last plain
    // or ⌘ click) and the target, sections excluded.
    selectRange: (toId) =>
      set((s) => {
        const vis = visibleItems(
          s.items,
          s.activeSection,
          s.showDone,
          s.searchQuery,
          s.collapsed,
        )
          .filter((i) => i.kind !== "section")
          .map((i) => i.id);
        const b = vis.indexOf(toId);
        if (b === -1) return s;
        const a = s.anchorId ? vis.indexOf(s.anchorId) : -1;
        if (a === -1) return { selected: [toId], anchorId: toId };
        const [lo, hi] = a < b ? [a, b] : [b, a];
        return { selected: vis.slice(lo, hi + 1) };
      }),
    // ⌘A: everything currently visible, sections excluded (AC-13).
    selectAll: () =>
      set((s) => ({
        selected: visibleItems(s.items, s.activeSection, s.showDone, s.searchQuery, s.collapsed)
          .filter((i) => i.kind !== "section")
          .map((i) => i.id),
      })),
    clearSelection: () => set({ selected: [], anchorId: null }),
    // Plain click: this item becomes the whole selection (AC-5 v1.4).
    selectOnly: (id) =>
      set((s) => {
        const item = s.items.find((i) => i.id === id);
        if (!item || item.kind === "section") return s;
        return { selected: [id], anchorId: id };
      }),
    updateText: (id, text) =>
      set((s) => {
        const trimmed = text.trim();
        if (!trimmed) return s;
        return {
          items: s.items.map((i) =>
            i.id === id
              ? i.kind === "section"
                ? { ...i, text: trimmed.replace(/^#\s+/, "") }
                : { ...i, text: trimmed, kind: detectKind(trimmed) }
              : i,
          ),
        };
      }),
    // Merge selected items into one note (newline-joined, list order),
    // kept at the first selected item's position (AC-22).
    mergeSelected: () =>
      set((s) => {
        const sel = new Set(s.selected);
        const chosen = s.items.filter((i) => sel.has(i.id));
        if (chosen.length < 2) return s;
        const merged: Item = {
          ...chosen[0],
          text: chosen.map((i) => i.text).join("\n"),
          kind: "text",
        };
        return {
          items: s.items
            .map((i) => (i.id === merged.id ? merged : i))
            .filter((i) => i.id === merged.id || !sel.has(i.id)),
          selected: [merged.id],
        };
      }),
    // Move items below a section header (or to the top for null), keeping
    // their relative order (AC-23).
    moveToSection: (ids, sectionId) =>
      set((s) => {
        const moving = new Set(ids);
        const picked = s.items.filter(
          (i) => moving.has(i.id) && i.kind !== "section",
        );
        if (!picked.length) return s;
        const rest = s.items.filter((i) => !moving.has(i.id) || i.kind === "section");
        const at = sectionId
          ? rest.findIndex((i) => i.id === sectionId) + 1
          : 0;
        if (sectionId && at === 0) return s;
        const items = [...rest];
        items.splice(at, 0, ...picked);
        return { items };
      }),
    // Space: if anything selected is pending, mark all done; else unmark.
    toggleDoneSelected: () =>
      set((s) => {
        const sel = new Set(s.selected);
        const target = s.items.some(
          (i) => sel.has(i.id) && i.kind !== "section" && !i.done,
        );
        return {
          items: s.items.map((i) =>
            sel.has(i.id) && i.kind !== "section" ? { ...i, done: target } : i,
          ),
        };
      }),
    setSearchQuery: (q) => set({ searchQuery: q, selected: [], anchorId: null }),
    removeDone: () =>
      set((s) => ({
        items: s.items.filter((i) => i.kind === "section" || !i.done),
        selected: [],
      })),
    // dropIndex is the drop target's index in the pre-removal list; the
    // dragged row takes the target's position (AC-14), so dragging downward
    // needs a -1 adjustment after the row is removed.
    moveItem: (id, dropIndex) =>
      set((s) => {
        const from = s.items.findIndex((i) => i.id === id);
        if (from === -1) return s;
        const items = [...s.items];
        const [moved] = items.splice(from, 1);
        const to = dropIndex > from ? dropIndex - 1 : dropIndex;
        items.splice(Math.max(0, Math.min(to, items.length)), 0, moved);
        return { items };
      }),
    cycleActiveSection: () =>
      set((s) => {
        const sections = s.items.filter((i) => i.kind === "section");
        if (sections.length === 0) return s;
        const at = sections.findIndex((sec) => sec.id === s.activeSection);
        const next =
          at === -1
            ? sections[0].id
            : at + 1 < sections.length
              ? sections[at + 1].id
              : null;
        // Switching views clears the selection (AC-13); the newly active
        // section expands.
        return {
          activeSection: next,
          selected: [],
          anchorId: null,
          collapsed: next ? s.collapsed.filter((c) => c !== next) : s.collapsed,
        };
      }),
    // Clicking a section header activates it; clicking the active one
    // returns to All (AC-16). View change clears the selection.
    // Activating a section also expands it.
    setActiveSection: (id) =>
      set((s) => ({
        activeSection: id,
        selected: [],
        anchorId: null,
        collapsed: id ? s.collapsed.filter((c) => c !== id) : s.collapsed,
      })),
    // Delete/Backspace with a selection active (AC-13).
    removeSelected: () =>
      set((s) => {
        const doomed = new Set(s.selected);
        return {
          items: s.items.filter((i) => !doomed.has(i.id)),
          selected: [],
        };
      }),
    setPinned: (pinned) => set({ pinned }),
    setPersistFailed: (failed) => set({ persistFailed: failed }),
  }));
}

export const useStashStore = createStashStore();
