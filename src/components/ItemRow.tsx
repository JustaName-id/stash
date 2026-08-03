import {
  useEffect,
  useRef,
  type DragEvent,
  type MouseEvent,
} from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Item } from "../types";
import { useStashStore } from "../store";
import { renderInline } from "../lib/markdown";

interface ItemRowProps {
  item: Item;
  selected: boolean;
  editing: boolean;
  onRequestEdit: () => void;
  onEditDone: () => void;
  onDragStart: () => void;
  onDropOn: () => void;
  onContextMenu: (e: MouseEvent) => void;
  onCopied: () => void;
}

export function ItemRow({
  item,
  selected,
  editing,
  onRequestEdit,
  onEditDone,
  onDragStart,
  onDropOn,
  onContextMenu,
  onCopied,
}: ItemRowProps) {
  const toggle = useStashStore((s) => s.toggle);
  const remove = useStashStore((s) => s.remove);
  const isCollapsed = useStashStore((s) => s.collapsed.includes(item.id));
  const editRef = useRef<HTMLTextAreaElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (editing) {
      settledRef.current = false;
      editRef.current?.focus();
      editRef.current?.select();
    }
  }, [editing]);

  const dragProps = {
    "data-row-id": item.id,
    onContextMenu,
    draggable: !editing,
    onDragStart: (e: DragEvent) => {
      // ⌘/⇧-click mean selection gestures, never "start a drag" (AC-14).
      if (e.metaKey || e.shiftKey) {
        e.preventDefault();
        return;
      }
      onDragStart();
    },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      onDropOn();
    },
  };

  const deleteButton = (
    <button
      onClick={() => remove(item.id)}
      title="Delete"
      aria-label={`Delete "${item.text}"`}
      className="shrink-0 cursor-pointer text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
    >
      ✕
    </button>
  );

  if (item.kind === "section") {
    return (
      <li
        {...dragProps}
        className="group flex cursor-grab items-center gap-2 px-1 pt-3 pb-0.5"
      >
        <button
          onClick={() => useStashStore.getState().toggleCollapsed(item.id)}
          title={isCollapsed ? "Expand section" : "Collapse section"}
          aria-expanded={!isCollapsed}
          className="cursor-pointer text-[10px] text-neutral-500 hover:text-amber-400"
        >
          {isCollapsed ? "▸" : "▾"}
        </button>
        <button
          role="heading"
          aria-level={2}
          title="Focus this section (click again for All)"
          onClick={() => {
            const st = useStashStore.getState();
            st.setActiveSection(
              st.activeSection === item.id ? null : item.id,
            );
          }}
          className="cursor-pointer text-left text-[11px] font-semibold tracking-widest text-neutral-400 uppercase hover:text-amber-400"
        >
          {item.text}
        </button>
        <span aria-hidden className="h-px flex-1 bg-neutral-800" />
        {deleteButton}
      </li>
    );
  }

  if (editing) {
    return (
      <li>
        <textarea
          ref={editRef}
          defaultValue={item.text}
          rows={3}
          aria-label="Edit item"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              settledRef.current = true;
              useStashStore.getState().updateText(item.id, e.currentTarget.value);
              onEditDone();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              settledRef.current = true; // explicit cancel: discard
              onEditDone();
            }
          }}
          onBlur={(e) => {
            // Clicking away saves (never silently discards); Enter/Esc have
            // already settled the edit by the time unmount-blur fires.
            if (!settledRef.current) {
              useStashStore.getState().updateText(item.id, e.currentTarget.value);
            }
            onEditDone();
          }}
          className="w-full resize-none rounded-lg border border-amber-600/70 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none"
        />
      </li>
    );
  }

  return (
    <li
      {...dragProps}
      className={`group flex cursor-grab items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-sm transition-colors ${
        selected
          ? "border-amber-600/50 bg-amber-500/10"
          : "border-transparent bg-neutral-800/60 hover:bg-neutral-800"
      }`}
    >
      <input
        type="checkbox"
        checked={item.done}
        onChange={() => toggle(item.id)}
        aria-label={`Mark "${item.text}" as ${item.done ? "not done" : "done"}`}
        className="mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-neutral-600 transition-colors checked:border-amber-600 checked:bg-amber-600 hover:border-amber-600/70"
      />
      <button
        onClick={(e) => {
          // Click selects AND copies the item; ⌘-click builds a
          // multi-selection without copying (⌘C / ⇧⌘C copy the selection).
          const st = useStashStore.getState();
          if (e.shiftKey) {
            st.selectRange(item.id);
            return;
          }
          // Plain (and ⌘) click is a pure toggle: it only ever changes THIS
          // item's membership — the rest of the selection never collapses.
          st.toggleSelected(item.id);
          if (!selected) {
            // It just became selected: copy it.
            writeText(item.text).then(onCopied, (err) =>
              console.error("clipboard write failed", err),
            );
          }
        }}
        onDoubleClick={onRequestEdit}
        title="Click to select & copy · double-click to edit"
        aria-pressed={selected}
        className={`min-w-0 flex-1 cursor-pointer text-left text-sm leading-snug break-words ${
          item.done ? "text-neutral-500 line-through" : "text-neutral-200"
        }`}
      >
        {item.kind === "link" ? (
          <span className="text-sky-400 underline decoration-sky-400/40">
            {item.text}
          </span>
        ) : (
          renderInline(item.text)
        )}
      </button>
      {deleteButton}
    </li>
  );
}
