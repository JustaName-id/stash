import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useStashStore } from "../store";
import { joinSelection } from "../lib/visible";

export interface MenuState {
  x: number;
  y: number;
  itemId: string;
}

interface ContextMenuProps {
  menu: MenuState;
  onClose: () => void;
  onRequestEdit: (id: string) => void;
}

export function MenuButton({
  label,
  hint,
  danger,
  onClick,
}: {
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-neutral-700/70 ${
        danger ? "text-red-400" : "text-neutral-200"
      }`}
    >
      {label}
      {hint && <span className="text-neutral-500">{hint}</span>}
    </button>
  );
}

export function ContextMenu({ menu, onClose, onRequestEdit }: ContextMenuProps) {
  // Select only stable references - a selector that returns a fresh array
  // (e.g. items.filter(...)) makes Zustand v5 re-render in an infinite loop
  // and crashes the whole UI.
  const items = useStashStore((s) => s.items);
  const activeSection = useStashStore((s) => s.activeSection);
  const selected = useStashStore((s) => s.selected);
  const item = items.find((i) => i.id === menu.itemId);
  const sections = items.filter((i) => i.kind === "section");
  if (!item) return null;

  const st = () => useStashStore.getState();
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  // Acting on a right-clicked item that's part of the selection acts on the
  // whole selection (like the reference app).
  const targets = selected.includes(item.id) ? selected : [item.id];
  const copyText = () => joinSelection(st().items, targets);
  const clip = (text: string) =>
    writeText(text).catch((err) => console.error("clipboard failed", err));

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute max-h-80 min-w-44 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-800 py-1 text-xs shadow-xl"
        style={{
          left: Math.min(menu.x, window.innerWidth - 190),
          top: Math.min(menu.y, window.innerHeight - 260),
        }}
      >
        {item.kind === "section" ? (
          <>
            <MenuButton
              label={activeSection === item.id ? "Show all" : "Focus section"}
              onClick={run(() =>
                st().setActiveSection(
                  activeSection === item.id ? null : item.id,
                ),
              )}
            />
            <MenuButton
              label="Delete section"
              danger
              onClick={run(() => st().remove(item.id))}
            />
          </>
        ) : (
          <>
            <MenuButton label="Copy" hint="⌘C" onClick={run(() => clip(copyText()))} />
            <MenuButton
              label="Copy as List"
              hint="⇧⌘C"
              onClick={run(() =>
                clip(
                  copyText()
                    .split("\n")
                    .map((l) => `- ${l}`)
                    .join("\n"),
                ),
              )}
            />
            <MenuButton
              label={item.done ? "Mark as Not Done" : "Mark as Done"}
              hint="Space"
              onClick={run(() =>
                targets.length > 1
                  ? st().toggleDoneSelected()
                  : st().toggle(item.id),
              )}
            />
            <div className="my-1 border-t border-neutral-700" />
            <MenuButton label="Edit" hint="dbl-click" onClick={run(() => onRequestEdit(item.id))} />
            {targets.length >= 2 && (
              <MenuButton
                label="Merge Notes"
                onClick={run(() => st().mergeSelected())}
              />
            )}
            <MenuButton label="Select all" hint="⌘A" onClick={run(() => st().selectAll())} />
            {sections.length > 0 && (
              <>
                <div className="my-1 border-t border-neutral-700" />
                <p className="px-3 py-1 text-[10px] tracking-wider text-neutral-500 uppercase">
                  Move to
                </p>
                <MenuButton
                  label="No section"
                  onClick={run(() => st().moveToSection(targets, null))}
                />
                {sections.map((sec) => (
                  <MenuButton
                    key={sec.id}
                    label={sec.text}
                    onClick={run(() => st().moveToSection(targets, sec.id))}
                  />
                ))}
              </>
            )}
            <div className="my-1 border-t border-neutral-700" />
            <MenuButton
              label={targets.length > 1 ? `Delete ${targets.length} items` : "Delete"}
              hint="⌫"
              danger
              onClick={run(() =>
                targets.length > 1 ? st().removeSelected() : st().remove(item.id),
              )}
            />
          </>
        )}
      </div>
    </div>
  );
}
