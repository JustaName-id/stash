import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Item } from "./types";
import { useStashStore } from "./store";

const STORE_FILE = "stash.json";
const SAVE_DEBOUNCE_MS = 300;

let store: Store | null = null;
let initialized = false;

async function getStore(): Promise<Store> {
  if (store) return store;
  try {
    store = await load(STORE_FILE, { autoSave: false });
  } catch {
    // Corrupt data file: move it aside (never overwrite silently) and retry.
    await invoke("backup_corrupt_store");
    store = await load(STORE_FILE, { autoSave: false });
  }
  return store;
}

export async function initPersistence(): Promise<void> {
  // Guard against double-invocation (React StrictMode re-runs effects).
  if (initialized) return;
  initialized = true;

  let s: Store;
  try {
    s = await getStore();
  } catch (err) {
    // Even the post-backup retry failed (e.g. read-only data dir). Degrade
    // to in-memory for the session and warn the user visibly.
    console.error("persistence unavailable, running in-memory", err);
    useStashStore.getState().setPersistFailed(true);
    useStashStore.getState().hydrate([]);
    return;
  }
  const items = ((await s.get<Item[]>("items")) ?? []).filter(
    (i) => typeof i?.id === "string" && typeof i?.text === "string",
  );
  useStashStore.getState().hydrate(items);

  // Text selected in another app when ⇧⇧ opened the panel (AC via
  // selection capture). Registered here so the initialized-guard prevents
  // StrictMode double-listeners.
  listen<string>("selection-captured", (e) => {
    useStashStore.getState().add(e.payload);
  });

  // Merge captures dropped by the MCP server into its sidecar inbox.
  let draining = false;
  const drainMcpInbox = async () => {
    if (draining) return;
    draining = true;
    try {
      const entries = await invoke<{ text: string; section: string | null }[]>(
        "drain_mcp_inbox",
      );
      for (const e of entries) {
        useStashStore.getState().addFromInbox(e.text, e.section);
      }
    } catch (err) {
      console.error("mcp inbox drain failed", err);
    } finally {
      draining = false;
    }
  };
  drainMcpInbox();
  setInterval(drainMcpInbox, 5000);

  let timer: ReturnType<typeof setTimeout> | undefined;
  useStashStore.subscribe((state, prev) => {
    if (state.items === prev.items) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      s.set("items", useStashStore.getState().items)
        .then(() => s.save())
        .catch((err) => {
          // Never swallow silently; the next mutation retries with fresh state.
          console.error("failed to persist items", err);
        });
    }, SAVE_DEBOUNCE_MS);
  });
}
