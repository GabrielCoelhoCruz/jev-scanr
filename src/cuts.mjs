import { readFileSync } from "node:fs";

const { cuts } = JSON.parse(
  readFileSync(new URL("../cuts.json", import.meta.url)),
);

export const defaultCut = (id) => (cuts.signals[id] ?? cuts.default).cut;
export const defaultFloor = (id) => (cuts.signals[id] ?? cuts.default).floor;
