import test from "node:test";
import assert from "node:assert/strict";

import { getAutoresearchArgumentCompletions } from "../extensions/pi-autoresearch/index.ts";

test("/autoresearch argument completions include subcommands and help flags", () => {
  assert.deepEqual(
    getAutoresearchArgumentCompletions("").map((item) => item.value),
    ["help", "off", "clear", "export", "--help", "-h"],
  );
});

test("/autoresearch argument completions filter by typed prefix", () => {
  assert.deepEqual(getAutoresearchArgumentCompletions("e"), [
    { value: "export", label: "export" },
  ]);
  assert.deepEqual(getAutoresearchArgumentCompletions("--"), [
    { value: "--help", label: "--help" },
  ]);
  assert.deepEqual(getAutoresearchArgumentCompletions("zzz"), []);
});
