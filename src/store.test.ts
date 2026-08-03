import { describe, expect, it } from "vitest";
import { createStashStore } from "./store";
import { detectKind } from "./lib/links";
import { joinSelection, visibleItems } from "./lib/visible";

describe("stash store", () => {
  it("adds trimmed items to the top of the list", () => {
    const store = createStashStore();
    store.getState().add("  first  ");
    store.getState().add("second");
    const items = store.getState().items;
    expect(items.map((i) => i.text)).toEqual(["second", "first"]);
    expect(items.every((i) => !i.done)).toBe(true);
  });

  it("ignores empty input", () => {
    const store = createStashStore();
    store.getState().add("   ");
    expect(store.getState().items).toHaveLength(0);
  });

  it("toggles and removes items by id", () => {
    const store = createStashStore();
    store.getState().add("a prompt");
    const id = store.getState().items[0].id;

    store.getState().toggle(id);
    expect(store.getState().items[0].done).toBe(true);
    store.getState().toggle(id);
    expect(store.getState().items[0].done).toBe(false);

    store.getState().remove(id);
    expect(store.getState().items).toHaveLength(0);
  });

  it("classifies links vs text", () => {
    expect(detectKind("https://tanstack.com/query")).toBe("link");
    expect(detectKind("http://example.com/a?b=c")).toBe("link");
    expect(detectKind("www.example.com")).toBe("link");
    expect(detectKind("refactor the auth hook")).toBe("text");
    expect(detectKind("see https://example.com for details")).toBe("text");
  });

  it("hydrates from persisted items", () => {
    const store = createStashStore();
    store.getState().hydrate([
      { id: "1", text: "kept", kind: "text", done: true, createdAt: 123 },
    ]);
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().items[0].text).toBe("kept");
  });

  it("preserves items captured before hydration completes", () => {
    const store = createStashStore();
    store.getState().add("typed before load");
    store.getState().hydrate([
      { id: "1", text: "persisted", kind: "text", done: false, createdAt: 1 },
    ]);
    expect(store.getState().items.map((i) => i.text)).toEqual([
      "typed before load",
      "persisted",
    ]);
  });

  it("ignores a second hydration", () => {
    const store = createStashStore();
    store.getState().hydrate([
      { id: "1", text: "once", kind: "text", done: false, createdAt: 1 },
    ]);
    store.getState().hydrate([
      { id: "1", text: "once", kind: "text", done: false, createdAt: 1 },
    ]);
    expect(store.getState().items).toHaveLength(1);
  });

  it("creates a section from '# Name' at the end and makes it active", () => {
    const store = createStashStore();
    store.getState().add("loose stays above");
    store.getState().add("# Work");
    const section = store.getState().items[1];
    expect(section.kind).toBe("section");
    expect(section.text).toBe("Work");
    expect(store.getState().activeSection).toBe(section.id);
  });

  it("captures into the active section, or to the top with no section", () => {
    const store = createStashStore();
    store.getState().add("loose item");
    store.getState().add("# Work");
    store.getState().add("work item");
    const texts = store.getState().items.map((i) => i.text);
    expect(texts).toEqual(["loose item", "Work", "work item"]);
  });

  it("cycles the active section: All → each section → All", () => {
    const store = createStashStore();
    store.getState().add("# A");
    store.getState().add("# B"); // appended after A
    const [a, b] = store.getState().items;
    expect(store.getState().activeSection).toBe(b.id); // B just created
    store.getState().cycleActiveSection(); // B is last → All
    expect(store.getState().activeSection).toBeNull();
    store.getState().cycleActiveSection(); // → A (first)
    expect(store.getState().activeSection).toBe(a.id);
    store.getState().cycleActiveSection(); // → B
    expect(store.getState().activeSection).toBe(b.id);
  });

  it("scopes visible items to the active section", () => {
    const store = createStashStore();
    store.getState().add("loose");
    store.getState().add("# Work");
    store.getState().add("in work");
    const section = store.getState().items[1];
    // Active section routes captures but never filters the view.
    expect(visibleItems(store.getState().items, section.id, true)).toHaveLength(3);
    expect(visibleItems(store.getState().items, null, true)).toHaveLength(3);
  });

  it("reorders items with moveItem: dragging up takes the target's position", () => {
    const store = createStashStore();
    store.getState().add("c");
    store.getState().add("b");
    store.getState().add("a");
    const c = store.getState().items[2];
    store.getState().moveItem(c.id, 0);
    expect(store.getState().items.map((i) => i.text)).toEqual(["c", "a", "b"]);
  });

  it("reorders items with moveItem: dragging down takes the target's position", () => {
    const store = createStashStore();
    store.getState().add("d");
    store.getState().add("c");
    store.getState().add("b");
    store.getState().add("a");
    const a = store.getState().items[0];
    store.getState().moveItem(a.id, 3); // drop a on d
    expect(store.getState().items.map((i) => i.text)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("clears the selection on view changes (⌘K and Hide done)", () => {
    const store = createStashStore();
    store.getState().add("# S");
    store.getState().add("item");
    const item = store.getState().items[1];
    store.getState().toggleSelected(item.id);
    store.getState().cycleActiveSection();
    expect(store.getState().selected).toEqual([]);
    store.getState().toggleSelected(item.id);
    store.getState().setShowDone(false);
    expect(store.getState().selected).toEqual([]);
  });

  it("joins a selection in list order, skipping sections from selection", () => {
    const store = createStashStore();
    store.getState().add("# S");
    store.getState().add("two");
    store.getState().add("one"); // active section puts "one" above "two"
    const [section, one, two] = store.getState().items;
    store.getState().toggleSelected(section.id); // ignored: sections not selectable
    store.getState().toggleSelected(two.id);
    store.getState().toggleSelected(one.id);
    expect(store.getState().selected).toEqual([two.id, one.id]);
    expect(joinSelection(store.getState().items, store.getState().selected)).toBe(
      "one\ntwo",
    );
  });

  it("clears selection and active section when their items are removed", () => {
    const store = createStashStore();
    store.getState().add("# S");
    store.getState().add("item");
    const [section, item] = store.getState().items;
    store.getState().toggleSelected(item.id);
    store.getState().remove(item.id);
    expect(store.getState().selected).toEqual([]);
    store.getState().remove(section.id);
    expect(store.getState().activeSection).toBeNull();
  });

  it("sets the active section directly and toggles back to All", () => {
    const store = createStashStore();
    store.getState().add("# S");
    const section = store.getState().items[0];
    store.getState().setActiveSection(null);
    expect(store.getState().activeSection).toBeNull();
    store.getState().setActiveSection(section.id);
    expect(store.getState().activeSection).toBe(section.id);
  });

  it("removes all selected items with removeSelected", () => {
    const store = createStashStore();
    store.getState().add("keep");
    store.getState().add("drop 1");
    store.getState().add("drop 2");
    const [d2, d1] = store.getState().items;
    store.getState().toggleSelected(d1.id);
    store.getState().toggleSelected(d2.id);
    store.getState().removeSelected();
    expect(store.getState().items.map((i) => i.text)).toEqual(["keep"]);
    expect(store.getState().selected).toEqual([]);
  });

  it("selectAll selects only visible non-section items", () => {
    const store = createStashStore();
    store.getState().add("loose");
    store.getState().add("# S");
    store.getState().add("in section");
    // The active section no longer filters the view: both items are
    // selectable, the section header never is.
    store.getState().selectAll();
    expect(store.getState().selected).toHaveLength(2);
  });

  it("edits an item's text and re-detects its kind", () => {
    const store = createStashStore();
    store.getState().add("plain note");
    const id = store.getState().items[0].id;
    store.getState().updateText(id, "https://example.com");
    expect(store.getState().items[0].kind).toBe("link");
  });

  it("merges the selection into one note at the first position", () => {
    const store = createStashStore();
    store.getState().add("b");
    store.getState().add("a");
    const [a, b] = store.getState().items;
    store.getState().toggleSelected(a.id);
    store.getState().toggleSelected(b.id);
    store.getState().mergeSelected();
    expect(store.getState().items).toHaveLength(1);
    expect(store.getState().items[0].text).toBe("a\nb");
    expect(store.getState().selected).toEqual([store.getState().items[0].id]);
  });

  it("moves items into a section and back out", () => {
    const store = createStashStore();
    store.getState().add("loose");
    store.getState().add("# S");
    const loose = store.getState().items[0];
    const section = store.getState().items[1];
    store.getState().moveToSection([loose.id], section.id);
    expect(store.getState().items.map((i) => i.text)).toEqual(["S", "loose"]);
    store.getState().moveToSection([loose.id], null);
    expect(store.getState().items.map((i) => i.text)).toEqual(["loose", "S"]);
  });

  it("search filters across sections, case-insensitive", () => {
    const store = createStashStore();
    store.getState().add("Alpha note");
    store.getState().add("# S");
    store.getState().add("beta ALPHA thing");
    const found = visibleItems(store.getState().items, null, true, "alpha");
    expect(found.map((i) => i.text)).toEqual(["Alpha note", "beta ALPHA thing"]);
  });

  it("space-toggle marks all selected done, then unmarks", () => {
    const store = createStashStore();
    store.getState().add("x");
    store.getState().add("y");
    const [y, x] = store.getState().items;
    store.getState().toggleSelected(x.id);
    store.getState().toggleSelected(y.id);
    store.getState().toggle(x.id); // x done, y pending
    store.getState().toggleDoneSelected();
    expect(store.getState().items.every((i) => i.done)).toBe(true);
    store.getState().toggleDoneSelected();
    expect(store.getState().items.every((i) => !i.done)).toBe(true);
  });

  it("shift-click selects the visible range from the anchor", () => {
    const store = createStashStore();
    store.getState().add("d");
    store.getState().add("c");
    store.getState().add("# S"); // section at end, not part of ranges
    store.getState().setActiveSection(null);
    store.getState().add("b");
    store.getState().add("a"); // list: a, b, c, d, S
    const [a, , , d] = store.getState().items;
    store.getState().selectOnly(a.id); // anchor = a
    store.getState().selectRange(d.id);
    expect(store.getState().selected).toHaveLength(4);
    // No anchor yet in a fresh store: range collapses to the target.
    const fresh = createStashStore();
    fresh.getState().add("x");
    fresh.getState().selectRange(fresh.getState().items[0].id);
    expect(fresh.getState().selected).toHaveLength(1);
  });

  it("collapsed sections hide their items; capture auto-expands", () => {
    const store = createStashStore();
    store.getState().add("# S");
    store.getState().add("inside");
    const section = store.getState().items[0];
    store.getState().toggleCollapsed(section.id);
    const vis = visibleItems(
      store.getState().items,
      null,
      true,
      "",
      store.getState().collapsed,
    );
    expect(vis.map((i) => i.text)).toEqual(["S"]);
    // Search ignores collapse.
    expect(
      visibleItems(store.getState().items, null, true, "inside", store.getState().collapsed),
    ).toHaveLength(1);
    // Capturing into the active (collapsed) section expands it.
    store.getState().add("new capture");
    expect(store.getState().collapsed).toEqual([]);
  });

  it("survives a JSON round-trip", () => {
    const store = createStashStore();
    store.getState().add("https://tanstack.com/query");
    const restored = createStashStore();
    restored.getState().hydrate(JSON.parse(JSON.stringify(store.getState().items)));
    expect(restored.getState().items).toEqual(store.getState().items);
  });
});
