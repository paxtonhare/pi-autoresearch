/**
 * Deterministic compaction summary for autoresearch sessions.
 *
 * Replaces the default LLM-generated summary with a synthesized view of
 * persisted state — experiment rules, ideas backlog, and recent runs.
 * Everything that matters between iterations already lives on disk, so we
 * skip the LLM call entirely and keep the summary lossless on what counts.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  reconstructJsonlState,
  type ReconstructedRun,
} from "./jsonl.ts";

const RECENT_RUN_LIMIT = 50;

export interface AutoresearchSummaryPaths {
  workDir: string;
  jsonlPath: string;
  mdPath: string;
  ideasPath: string;
}

export function autoresearchSummaryPathsFor(workDir: string): AutoresearchSummaryPaths {
  return {
    workDir,
    jsonlPath: path.join(workDir, "autoresearch.jsonl"),
    mdPath: path.join(workDir, "autoresearch.md"),
    ideasPath: path.join(workDir, "autoresearch.ideas.md"),
  };
}

/**
 * Build the full compaction summary text from persisted autoresearch state.
 * Returns a markdown string that is itself the entire compaction summary.
 */
export function buildAutoresearchCompactionSummary(paths: AutoresearchSummaryPaths): string {
  const sections = [
    headerSection(),
    rulesSection(paths.mdPath),
    ideasSection(paths.ideasPath),
    recentRunsSection(paths.jsonlPath),
    nextStepSection(),
  ];
  return sections.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function headerSection(): string {
  return [
    "# Autoresearch Compaction Summary",
    "",
    "The conversation history was discarded; the persisted autoresearch state below is the source of truth.",
    "Continue the experiment loop using only what is included here plus the live tools.",
  ].join("\n");
}

function rulesSection(mdPath: string): string {
  const content = readTrimmedFile(mdPath);
  if (!content) return "";
  return `## Experiment Rules (autoresearch.md)\n\n${content}`;
}

function ideasSection(ideasPath: string): string {
  const content = readTrimmedFile(ideasPath);
  if (!content) return "";
  return `## Ideas Backlog (autoresearch.ideas.md)\n\n${content}`;
}

function recentRunsSection(jsonlPath: string): string {
  const runs = recentRuns(jsonlPath);
  if (runs.length === 0) {
    return "## Recent Runs\n\nNo runs yet — start with the first hypothesis.";
  }
  const lines = runs.map((run) => formatRunLine(run, baselineFor(run, runs)));
  return [
    `## Recent Runs (last ${runs.length})`,
    "",
    "Format: `#run status metric (delta) | desc | hyp: ... | next: ... | rollback: ...`",
    "",
    ...lines,
    "",
    "If you need more details, read additional lines from autoresearch.jsonl.",
  ].join("\n");
}

function nextStepSection(): string {
  return [
    "## Next Step",
    "",
    "Pick the most promising hypothesis (from the ideas backlog or the latest `next:` hints in recent runs)",
    "and run the next experiment immediately. Do not stop until interrupted.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Recent runs
// ---------------------------------------------------------------------------

function recentRuns(jsonlPath: string): ReconstructedRun[] {
  const content = readFileOrEmpty(jsonlPath);
  if (!content) return [];
  const state = reconstructJsonlState(content);
  return state.results.slice(-RECENT_RUN_LIMIT);
}

/** Baseline metric for a run = first run in the same segment within the visible window. */
function baselineFor(run: ReconstructedRun, all: ReconstructedRun[]): number | null {
  const sameSegment = all.find((other) => other.segment === run.segment);
  return sameSegment?.metric ?? null;
}

function formatRunLine(run: ReconstructedRun, baseline: number | null): string {
  const head = `#${run.run} ${padStatus(run.status)} ${formatMetric(run.metric)}${formatDelta(run.metric, baseline)}`;
  const parts = [head, formatDescription(run), ...formatAsiFields(run.asi)];
  return parts.filter(Boolean).join(" | ");
}

function padStatus(status: ReconstructedRun["status"]): string {
  return status.padEnd(STATUS_WIDTH);
}

const STATUS_WIDTH = "checks_failed".length;

function formatMetric(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function formatDelta(value: number, baseline: number | null): string {
  if (baseline === null || baseline === 0 || value === baseline) return "";
  const pct = ((value - baseline) / baseline) * 100;
  const sign = pct > 0 ? "+" : "";
  return ` (${sign}${pct.toFixed(1)}%)`;
}

function formatDescription(run: ReconstructedRun): string {
  return run.description ? `desc: ${run.description}` : "";
}

function formatAsiFields(asi: ReconstructedRun["asi"]): string[] {
  if (!asi) return [];
  return [
    formatAsiField(asi, "hypothesis", "hyp"),
    formatAsiField(asi, "next_action_hint", "next"),
    formatAsiField(asi, "rollback_reason", "rollback"),
  ];
}

function formatAsiField(asi: Record<string, unknown>, key: string, label: string): string {
  const value = asi[key];
  if (typeof value !== "string" || value.trim() === "") return "";
  return `${label}: ${value.trim()}`;
}

// ---------------------------------------------------------------------------
// File IO
// ---------------------------------------------------------------------------

function readTrimmedFile(filePath: string): string {
  return readFileOrEmpty(filePath).trim();
}

function readFileOrEmpty(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}
