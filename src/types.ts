export type ItemKind = "text" | "link" | "section";

export interface Item {
  id: string;
  text: string;
  kind: ItemKind;
  done: boolean;
  createdAt: number;
}
