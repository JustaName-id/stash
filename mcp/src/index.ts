#!/usr/bin/env node
/**
 * Stash MCP server (stdio, local-only).
 *
 * Reads the Stash data file directly (read-only) and writes new captures to
 * a sidecar inbox file — never to stash.json, which the running app owns.
 * The app merges and deletes the sidecar on its own schedule.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = join(
  homedir(),
  "Library/Application Support/com.mariano.stash",
);
const STASH_FILE = join(DATA_DIR, "stash.json");
const INBOX_FILE = join(DATA_DIR, "mcp-inbox.json");

interface Item {
  id: string;
  text: string;
  kind: "text" | "link" | "section";
  done: boolean;
  createdAt: number;
}

async function readItems(): Promise<Item[]> {
  try {
    const raw = JSON.parse(await readFile(STASH_FILE, "utf8"));
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

/** Positional membership: an item belongs to the nearest section above it. */
function withSections(items: Item[]): { item: Item; section: string | null }[] {
  let current: string | null = null;
  return items.map((item) => {
    if (item.kind === "section") current = item.text;
    return { item, section: item.kind === "section" ? null : current };
  });
}

function formatItems(rows: { item: Item; section: string | null }[]): string {
  const lines = rows
    .filter(({ item }) => item.kind !== "section")
    .map(
      ({ item, section }) =>
        `- [${item.done ? "x" : " "}] ${item.text}${section ? `  (section: ${section})` : ""}`,
    );
  return lines.length ? lines.join("\n") : "No items.";
}

const server = new McpServer({ name: "stash", version: "0.1.0" });

server.registerTool(
  "list_items",
  {
    title: "List Stash items",
    description:
      "List captured items from the user's local Stash quick-capture panel. " +
      "Optionally filter by section name or pending (not done) only.",
    inputSchema: {
      section: z
        .string()
        .optional()
        .describe("Only items in this section (case-insensitive name)"),
      pending_only: z
        .boolean()
        .optional()
        .describe("Only items not yet marked done"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ section, pending_only }) => {
    let rows = withSections(await readItems());
    if (section) {
      const s = section.toLowerCase();
      rows = rows.filter((r) => r.section?.toLowerCase() === s);
    }
    if (pending_only) rows = rows.filter((r) => !r.item.done);
    return { content: [{ type: "text", text: formatItems(rows) }] };
  },
);

server.registerTool(
  "search_items",
  {
    title: "Search Stash items",
    description:
      "Case-insensitive substring search across all captured Stash items.",
    inputSchema: {
      query: z.string().min(1).describe("Text to search for"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ query }) => {
    const q = query.toLowerCase();
    const rows = withSections(await readItems()).filter(
      ({ item }) =>
        item.kind !== "section" && item.text.toLowerCase().includes(q),
    );
    return { content: [{ type: "text", text: formatItems(rows) }] };
  },
);

server.registerTool(
  "add_item",
  {
    title: "Add a Stash item",
    description:
      "Capture a new item into the user's Stash inbox. It appears in the " +
      "app within a few seconds (top of the list, or in the named section " +
      "if one matches).",
    inputSchema: {
      text: z.string().min(1).describe("The note, prompt, or link to capture"),
      section: z
        .string()
        .optional()
        .describe("Optional section name to file it under"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ text, section }) => {
    await mkdir(DATA_DIR, { recursive: true });
    let entries: unknown[] = [];
    try {
      entries = JSON.parse(await readFile(INBOX_FILE, "utf8"));
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
    entries.push({
      id: randomUUID(),
      text: text.trim(),
      section: section?.trim() || null,
      createdAt: Date.now(),
    });
    await writeFile(INBOX_FILE, JSON.stringify(entries, null, 2));
    return {
      content: [
        {
          type: "text",
          text: `Captured. It will appear in Stash within a few seconds${section ? ` under "${section}" if that section exists` : ""}.`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
