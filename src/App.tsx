import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Item } from "./types";
import { useStashStore } from "./store";
import { visibleItems, joinSelection } from "./lib/visible";
import { initPersistence } from "./persistence";
import { CaptureInput } from "./components/CaptureInput";
import { ItemRow } from "./components/ItemRow";
import { PermissionBanner } from "./components/PermissionBanner";
import { ContextMenu, MenuButton, type MenuState } from "./components/ContextMenu";

function isEditingText(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
  );
}

export default function App() {
  const items = useStashStore((s) => s.items);
  const showDone = useStashStore((s) => s.showDone);
  const setShowDone = useStashStore((s) => s.setShowDone);
  const selected = useStashStore((s) => s.selected);
  const activeSection = useStashStore((s) => s.activeSection);
  const moveItem = useStashStore((s) => s.moveItem);
  const searchQuery = useStashStore((s) => s.searchQuery);
  const setSearchQuery = useStashStore((s) => s.setSearchQuery);
  const pinned = useStashStore((s) => s.pinned);
  const persistFailed = useStashStore((s) => s.persistFailed);

  const [bulkCopied, setBulkCopied] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [appMenu, setAppMenu] = useState(false);
  const [about, setAbout] = useState(false);
  const [version, setVersion] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const menuRef = useRef<MenuState | null>(null);
  menuRef.current = menu;
  const appMenuRef = useRef(false);
  appMenuRef.current = appMenu;
  const aboutRef = useRef(false);
  aboutRef.current = about;
  const bulkTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const draggedId = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const flashCopied = () => {
    setBulkCopied(true);
    clearTimeout(bulkTimer.current);
    bulkTimer.current = setTimeout(() => setBulkCopied(false), 1200);
  };

  useEffect(() => {
    initPersistence();
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setVersion)
      .catch(() => setVersion("dev"));
    const onKeyDown = async (e: KeyboardEvent) => {
      const st = useStashStore.getState();
      const key = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (menuRef.current) setMenu(null);
        else if (appMenuRef.current) setAppMenu(false);
        else if (aboutRef.current) setAbout(false);
        else if (st.searchQuery) st.setSearchQuery("");
        else if (st.selected.length > 0) st.clearSelection();
        else getCurrentWindow().hide();
      } else if (e.metaKey && key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.metaKey && key === "a") {
        // Select-all of items only outside the search box and when the
        // focused field has no text of its own to select.
        const el = document.activeElement;
        const inSearch = el === searchRef.current;
        const hasText =
          (el instanceof HTMLTextAreaElement ||
            el instanceof HTMLInputElement) &&
          el.value.length > 0;
        if (!inSearch && !hasText) {
          e.preventDefault();
          st.selectAll();
        }
      } else if (e.key === " " && st.selected.length > 0 && !isEditingText()) {
        // Space toggles done on the selection (AC-5 v1.4).
        e.preventDefault();
        st.toggleDoneSelected();
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        st.selected.length > 0 &&
        !isEditingText()
      ) {
        e.preventDefault();
        st.removeSelected();
      } else if (e.metaKey && key === "k") {
        e.preventDefault();
        st.cycleActiveSection();
      } else if (e.metaKey && key === "c" && st.selected.length > 0) {
        // Text selected inside an input wins over the bulk copy (AC-13).
        const el = document.activeElement;
        if (
          (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) &&
          el.selectionStart !== el.selectionEnd
        ) {
          return;
        }
        e.preventDefault();
        const joined = joinSelection(st.items, st.selected);
        const text = e.shiftKey
          ? joined.split("\n").map((l) => `- ${l}`).join("\n") // ⇧⌘C: Copy as List
          : joined;
        try {
          await writeText(text);
        } catch (err) {
          console.error("clipboard write failed", err);
          return;
        }
        flashCopied();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(bulkTimer.current);
    };
  }, []);

  const togglePin = () => {
    const next = !pinned;
    getCurrentWindow()
      .setAlwaysOnTop(next)
      .then(() => useStashStore.getState().setPinned(next))
      .catch((err) => console.error("failed to toggle always-on-top", err));
  };

  const onDropOn = (target: Item) => {
    const id = draggedId.current;
    draggedId.current = null;
    if (!id || id === target.id) return;
    // Dropping on a section header files the item into that section.
    if (target.kind === "section") {
      useStashStore.getState().moveToSection([id], target.id);
      return;
    }
    const current = useStashStore.getState().items;
    const dropIndex = current.findIndex((i) => i.id === target.id);
    if (dropIndex !== -1) moveItem(id, dropIndex);
  };

  const dropIntoSection = (sectionId: string | null) => {
    const id = draggedId.current;
    draggedId.current = null;
    if (id) useStashStore.getState().moveToSection([id], sectionId);
  };

  // Fallback for drops on gaps / section bodies: resolve to the nearest row
  // above the pointer (row drops handle themselves first and null the id).
  const onListDrop = (e: React.DragEvent<HTMLUListElement>) => {
    e.preventDefault();
    const id = draggedId.current;
    if (!id) return;
    draggedId.current = null;
    let targetId: string | null = null;
    for (const el of e.currentTarget.querySelectorAll<HTMLElement>("[data-row-id]")) {
      if (el.getBoundingClientRect().top <= e.clientY) targetId = el.dataset.rowId!;
      else break;
    }
    const st = useStashStore.getState();
    if (!targetId) {
      st.moveToSection([id], null); // dropped above everything → Inbox
      return;
    }
    const target = st.items.find((i) => i.id === targetId);
    if (!target) return;
    if (target.kind === "section") st.moveToSection([id], target.id);
    else {
      const di = st.items.findIndex((i) => i.id === targetId);
      if (di !== -1) moveItem(id, di);
    }
  };

  const visible = visibleItems(items, activeSection, showDone, searchQuery);
  const doneCount = items.filter((i) => i.done).length;
  const activeName = items.find((i) => i.id === activeSection)?.text ?? null;

  return (
    <div className="flex h-screen flex-col bg-neutral-900 text-neutral-100">
      <header
        data-tauri-drag-region
        className="flex shrink-0 cursor-default items-center justify-between gap-2 px-3 pt-2.5 pb-1 select-none"
      >
        <span
          data-tauri-drag-region
          className="text-xs font-semibold tracking-wide text-amber-600"
        >
          Stash
          {activeName && (
            <span className="ml-1.5 font-normal text-neutral-400">
              / {activeName}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span data-tauri-drag-region className="text-[11px] text-neutral-500">
            {selected.length > 0
              ? "⌘C copy · ⇧⌘C list · space done · ⌫ delete"
              : "⇧⇧ toggle · ⌘K section · ⌘F search"}
          </span>
          <button
            onClick={togglePin}
            title={pinned ? "Stop keeping on top" : "Keep on top"}
            aria-label={pinned ? "Stop keeping on top" : "Keep on top"}
            aria-pressed={pinned}
            className={`cursor-pointer text-xs transition-all ${
              pinned ? "" : "opacity-40 grayscale"
            } hover:opacity-100`}
          >
            📌
          </button>
        </span>
      </header>

      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1">
        <input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="⌕  Search (filters only — capture below)"
          aria-label="Search items"
          className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-800/50 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-amber-600/50 focus:outline-none"
        />
        <div className="relative">
          <button
            onClick={() => setAppMenu((v) => !v)}
            title="More actions"
            aria-label="More actions"
            aria-expanded={appMenu}
            className="cursor-pointer rounded-md px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            ⋯
          </button>
          {appMenu && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => setAppMenu(false)}
              onContextMenu={(e) => {
                e.preventDefault();
                setAppMenu(false);
              }}
            />
          )}
          {appMenu && (
            <div className="absolute right-0 z-50 mt-1 min-w-40 rounded-lg border border-neutral-700 bg-neutral-800 py-1 text-xs shadow-xl">
              <MenuButton
                label={showDone ? "Hide done" : "Show done"}
                onClick={() => {
                  setShowDone(!showDone);
                  setAppMenu(false);
                }}
              />
              <MenuButton
                label="Select all"
                hint="⌘A"
                onClick={() => {
                  useStashStore.getState().selectAll();
                  setAppMenu(false);
                }}
              />
              <MenuButton
                label="Clear done items"
                danger
                onClick={() => {
                  useStashStore.getState().removeDone();
                  setAppMenu(false);
                }}
              />
              <div className="my-1 border-t border-neutral-700" />
              <MenuButton
                label="About Stash"
                onClick={() => {
                  setAbout(true);
                  setAppMenu(false);
                }}
              />
            </div>
          )}
        </div>
      </div>

      <CaptureInput />
      <PermissionBanner />
      {persistFailed && (
        <div className="mx-3 mb-2 rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          Saving is unavailable — items from this session are not being
          persisted. Check that the app data folder is writable, then restart
          Stash.
        </div>
      )}

      <ul
        className="flex-1 space-y-2 overflow-y-auto px-3 pt-1 pb-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onListDrop}
      >
        {!searchQuery && visible.some((i) => i.kind === "section") && (
          <li
            className="flex items-center gap-2 px-1 pb-0.5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dropIntoSection(null);
            }}
          >
            <span className="text-[11px] font-semibold tracking-widest text-neutral-400 uppercase">
              Inbox
            </span>
            <span aria-hidden className="h-px flex-1 bg-neutral-800" />
          </li>
        )}
        {!searchQuery &&
          visible.some((i) => i.kind === "section") &&
          (visible.length === 0 || visible[0].kind === "section") && (
            <li
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dropIntoSection(null);
              }}
              className="rounded-xl border border-dashed border-neutral-800 px-3 py-2 text-center text-[11px] text-neutral-600"
            >
              No items — drop here
            </li>
          )}
        {visible.length === 0 &&
          (items.length === 0 ? (
            <li className="px-2 pt-6 text-center text-xs leading-relaxed text-neutral-600">
              Nothing captured yet. Type above and press Enter — use "# Name"
              for a section. Click an item to select it, ⌘C to copy,
              double-click to edit, drag to reorder.
            </li>
          ) : (
            <li className="px-2 pt-6 text-center text-xs text-neutral-600">
              {searchQuery
                ? "No items match your search."
                : 'All items here are hidden by the current filter — toggle "Show done" or press ⌘K.'}
            </li>
          ))}
        {visible.flatMap((item, idx) => {
          const rows = [
            <ItemRow
              key={item.id}
              item={item}
              selected={selected.includes(item.id)}
              editing={editingId === item.id}
              onRequestEdit={() => setEditingId(item.id)}
              onEditDone={() => setEditingId(null)}
              onDragStart={() => (draggedId.current = item.id)}
              onDropOn={() => onDropOn(item)}
              onCopied={flashCopied}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
              }}
            />,
          ];
          const nextIsSection =
            idx === visible.length - 1 || visible[idx + 1].kind === "section";
          if (item.kind === "section" && nextIsSection) {
            rows.push(
              <li
                key={`${item.id}-empty`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dropIntoSection(item.id);
                }}
                className="rounded-xl border border-dashed border-neutral-800 px-3 py-2 text-center text-[11px] text-neutral-600"
              >
                No items — drop here
              </li>,
            );
          }
          return rows;
        })}
      </ul>

      {about && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setAbout(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-6 rounded-xl border border-neutral-700 bg-neutral-800 p-4 text-center text-xs shadow-2xl"
          >
            <p className="text-base font-semibold text-amber-500">📌 Stash</p>
            <p className="mt-1 text-neutral-400">
              Version {version || "…"} · MIT
            </p>
            <p className="mt-2 text-neutral-300">by Mariano Aguero</p>
            <p className="mt-2 text-neutral-500">
              Report issues (click to copy):
            </p>
            <button
              onClick={() =>
                writeText("https://github.com/mariano-aguero/stash/issues").then(
                  flashCopied,
                  (err) => console.error("clipboard failed", err),
                )
              }
              className="mt-0.5 cursor-pointer text-sky-400 underline decoration-sky-400/40 hover:text-sky-300"
            >
              github.com/mariano-aguero/stash/issues
            </button>
            <p className="mt-3">
              <button
                onClick={() => setAbout(false)}
                className="cursor-pointer rounded-md bg-neutral-700 px-3 py-1 text-neutral-200 hover:bg-neutral-600"
              >
                Close
              </button>
            </p>
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onRequestEdit={(id) => setEditingId(id)}
        />
      )}

      <footer className="flex shrink-0 items-center justify-between border-t border-neutral-800 px-3 py-1.5 text-[11px] text-neutral-500">
        {bulkCopied ? (
          <span className="text-amber-500">Copied</span>
        ) : selected.length > 0 ? (
          <span className="text-amber-500">{selected.length} selected</span>
        ) : (
          <span>
            {items.length} item{items.length === 1 ? "" : "s"}
            {doneCount > 0 && ` · ${doneCount} done`}
          </span>
        )}
        <button
          onClick={() => setShowDone(!showDone)}
          className="cursor-pointer hover:text-neutral-300"
        >
          {showDone ? "Hide done" : "Show done"}
        </button>
      </footer>
    </div>
  );
}
