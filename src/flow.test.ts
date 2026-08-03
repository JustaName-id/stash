import { describe, expect, it } from "vitest";
import { createStashStore } from "./store";
import { joinSelection, visibleItems } from "./lib/visible";

/** Integration flow: a full user journey through the store layer -
 * the closest to E2E the stack allows on macOS (tauri-driver is
 * Linux/Windows only). UI bindings are thin wrappers over these actions. */
describe("full user journey", () => {
  it("capture → sections → search → select → copy → reorder → restart", () => {
    const day1 = createStashStore();
    const s = () => day1.getState();

    // Morning: quick captures, then organize into a section.
    s().add("review PR 42");
    s().add("https://tanstack.com/query");
    s().add("# Prompts");
    s().add("explain the auth flow");
    s().add("write tests for **login**");

    // Active section captures land under Prompts.
    expect(s().items.map((i) => i.text)).toEqual([
      "https://tanstack.com/query",
      "review PR 42",
      "Prompts",
      "write tests for **login**",
      "explain the auth flow",
    ]);

    // Search finds across sections; select-all respects it.
    s().setSearchQuery("tests");
    expect(visibleItems(s().items, s().activeSection, true, "tests")).toHaveLength(1);
    s().selectAll();
    expect(s().selected).toHaveLength(1);
    s().setSearchQuery("");

    // Select the two prompts, copy as list, mark done with Space.
    const prompts = s().items.filter(
      (i) => i.text.includes("tests for") || i.text.includes("auth flow"),
    );
    prompts.forEach((p) => s().toggleSelected(p.id));
    const list = joinSelection(s().items, s().selected)
      .split("\n")
      .map((l) => `- ${l}`);
    expect(list).toEqual([
      "- write tests for **login**",
      "- explain the auth flow",
    ]);
    s().toggleDoneSelected();
    expect(prompts.every((p) => s().items.find((i) => i.id === p.id)?.done)).toBe(true);

    // Drag the link into Prompts, then merge the two done prompts.
    const link = s().items[0];
    const section = s().items.find((i) => i.kind === "section")!;
    s().moveToSection([link.id], section.id);
    expect(s().items[2].id).toBe(link.id);
    s().mergeSelected();
    // "review PR 42" plus the merged prompt note remain as text items.
    expect(s().items.filter((i) => i.kind === "text")).toHaveLength(2);

    // "Restart": persisted JSON round-trip hydrates identically, and an
    // item typed before hydration survives on top.
    const persisted = JSON.parse(JSON.stringify(s().items));
    const day2 = createStashStore();
    day2.getState().add("typed during launch");
    day2.getState().hydrate(persisted);
    expect(day2.getState().items.map((i) => i.text)).toEqual([
      "typed during launch",
      ...persisted.map((i: { text: string }) => i.text),
    ]);
  });
});
