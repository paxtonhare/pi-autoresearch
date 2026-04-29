import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import {
  autoresearchSummaryPathsFor,
  buildAutoresearchCompactionSummary,
} from "../extensions/pi-autoresearch/compaction.ts";

function withTempWorkDir(fn) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "pi-autoresearch-compact-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeJsonlLines(workDir, lines) {
  fs.writeFileSync(path.join(workDir, "autoresearch.jsonl"), lines.join("\n") + "\n");
}

test("summary contains all three persisted sources when present", () => {
  withTempWorkDir((workDir) => {
    fs.writeFileSync(path.join(workDir, "autoresearch.md"), "# Rules\nDo not cheat.");
    fs.writeFileSync(path.join(workDir, "autoresearch.ideas.md"), "- Try memoization\n- Try parallelism");
    writeJsonlLines(workDir, [
      '{"type":"config","name":"S","metricName":"ms","metricUnit":"ms","bestDirection":"lower"}',
      '{"run":1,"commit":"aaa1111","metric":100,"status":"keep","description":"baseline","timestamp":1,"metrics":{},"asi":{"hypothesis":"start point"}}',
      '{"run":2,"commit":"bbb2222","metric":80,"status":"keep","description":"cache foo","timestamp":2,"metrics":{},"asi":{"hypothesis":"memoize repeated keys","next_action_hint":"try LRU"}}',
      '{"run":3,"commit":"ccc3333","metric":120,"status":"discard","description":"tried lru-cache","timestamp":3,"metrics":{},"asi":{"rollback_reason":"import overhead"}}',
    ]);

    const summary = buildAutoresearchCompactionSummary(autoresearchSummaryPathsFor(workDir));

    assert.match(summary, /# Autoresearch Compaction Summary/);
    assert.match(summary, /## Experiment Rules \(autoresearch\.md\)/);
    assert.match(summary, /Do not cheat\./);
    assert.match(summary, /## Ideas Backlog \(autoresearch\.ideas\.md\)/);
    assert.match(summary, /Try memoization/);
    assert.match(summary, /## Recent Runs \(last 3\)/);
    assert.match(summary, /#1 keep/);
    assert.match(summary, /#2 keep\s+80 \(-20\.0%\)/);
    assert.match(summary, /#3 discard\s+120 \(\+20\.0%\)/);
    assert.match(summary, /hyp: memoize repeated keys/);
    assert.match(summary, /next: try LRU/);
    assert.match(summary, /rollback: import overhead/);
    assert.match(summary, /## Next Step/);
    assert.match(summary, /If you need more details, read additional lines from autoresearch\.jsonl\./);
  });
});

test("summary degrades gracefully when no files exist", () => {
  withTempWorkDir((workDir) => {
    const summary = buildAutoresearchCompactionSummary(autoresearchSummaryPathsFor(workDir));

    assert.match(summary, /# Autoresearch Compaction Summary/);
    assert.doesNotMatch(summary, /## Experiment Rules/);
    assert.doesNotMatch(summary, /## Ideas Backlog/);
    assert.match(summary, /No runs yet/);
    assert.match(summary, /## Next Step/);
  });
});

test("summary keeps only the last 50 runs", () => {
  withTempWorkDir((workDir) => {
    const lines = ['{"type":"config","name":"S","metricName":"ms","metricUnit":"ms","bestDirection":"lower"}'];
    for (let i = 1; i <= 75; i++) {
      lines.push(`{"run":${i},"commit":"c${i}","metric":${100 + i},"status":"keep","description":"r${i}","timestamp":${i},"metrics":{}}`);
    }
    writeJsonlLines(workDir, lines);

    const summary = buildAutoresearchCompactionSummary(autoresearchSummaryPathsFor(workDir));

    assert.match(summary, /## Recent Runs \(last 50\)/);
    assert.doesNotMatch(summary, /#25 keep/);
    assert.match(summary, /#26 keep/);
    assert.match(summary, /#75 keep/);
  });
});

test("delta is computed against the first run of the same segment within window", () => {
  withTempWorkDir((workDir) => {
    writeJsonlLines(workDir, [
      '{"type":"config","name":"S","metricName":"ms","metricUnit":"ms","bestDirection":"lower"}',
      '{"run":1,"commit":"a","metric":200,"status":"keep","description":"seg0 base","timestamp":1,"metrics":{}}',
      '{"type":"config","name":"S","metricName":"ms","metricUnit":"ms","bestDirection":"lower"}',
      '{"run":2,"commit":"b","metric":100,"status":"keep","description":"seg1 base","timestamp":2,"metrics":{}}',
      '{"run":3,"commit":"c","metric":80,"status":"keep","description":"seg1 better","timestamp":3,"metrics":{}}',
    ]);

    const summary = buildAutoresearchCompactionSummary(autoresearchSummaryPathsFor(workDir));

    // seg1 base (#2) is the baseline for #3 — no delta on #2 itself
    assert.match(summary, /#2 keep\s+100 \| desc: seg1 base/);
    assert.match(summary, /#3 keep\s+80 \(-20\.0%\) \| desc: seg1 better/);
    // seg0 base (#1) shows no delta (it is its own baseline)
    assert.match(summary, /#1 keep\s+200 \| desc: seg0 base/);
  });
});
