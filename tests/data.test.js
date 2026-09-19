// Data validation suite for FlowStream's static data files.
// These files are written by a sibling agent; if they don't exist yet this
// suite skips gracefully with a warning instead of failing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = fileURLToPath(new URL("../docs/data/", import.meta.url));
const MAX_TOTAL_SEC = 45 * 60;

async function loadIfExists(name) {
  try {
    await stat(join(DATA_DIR, name));
  } catch {
    return null;
  }
  const raw = await readFile(join(DATA_DIR, name), "utf8");
  return JSON.parse(raw);
}

const curriculum = await loadIfExists("curriculum.json");
const glossary = await loadIfExists("glossary.json");

// The curriculum file wraps its payload: { curriculum: { lessons, skillTree, ... } }
const curriculumRoot = curriculum?.curriculum ?? curriculum;
const lessonsOf = () => curriculumRoot?.lessons ?? curriculumRoot;

// Time-field aliases used across sibling-authored data shapes.
const startOf = (x) => x.startSec ?? x.start;
const endOf = (x) => x.endSec ?? x.end;
const cueTimeOf = (cue) => cue.t ?? cue.time ?? cue.start;

if (!curriculum) {
  console.warn("SKIP: docs/data/curriculum.json not found yet — curriculum checks skipped.");
}
if (!glossary) {
  console.warn("SKIP: docs/data/glossary.json not found yet — glossary checks skipped.");
}

// ---------------------------------------------------------------- curriculum

test("curriculum: lessons array is non-empty", { skip: !curriculum }, () => {
  const lessons = lessonsOf();
  assert.ok(Array.isArray(lessons), "lessons must be an array");
  assert.ok(lessons.length > 0, "lessons must be non-empty");
});

test("curriculum: total durations fit within 45 minutes", { skip: !curriculum }, () => {
  const lessons = lessonsOf();
  const total = lessons.reduce((sum, l) => sum + (l.durationSec ?? 0), 0);
  assert.ok(total > 0, "total duration should be positive");
  assert.ok(
    total <= MAX_TOTAL_SEC,
    `total duration ${total}s exceeds ${MAX_TOTAL_SEC}s (45 min)`
  );
});

test("curriculum: chapters sorted, non-overlapping, fluff flags boolean", { skip: !curriculum }, () => {
  const lessons = lessonsOf();
  for (const lesson of lessons) {
    const chapters = lesson.chapters;
    if (!chapters) continue;
    assert.ok(Array.isArray(chapters), `chapters must be an array in lesson ${lesson.id}`);
    for (const ch of chapters) {
      const label = ch.id ?? ch.title ?? "?";
      assert.equal(typeof ch.fluff, "boolean", `fluff must be boolean in chapter ${label}`);
      const s = startOf(ch);
      const e = endOf(ch);
      assert.ok(Number.isFinite(s), `chapter start must be finite in chapter ${label}`);
      assert.ok(Number.isFinite(e), `chapter end must be finite in chapter ${label}`);
      assert.ok(e > s, `chapter end must exceed start in chapter ${label}`);
    }
    const sorted = [...chapters].sort((a, b) => startOf(a) - startOf(b));
    assert.deepEqual(
      chapters.map((c) => c.id ?? c.title),
      sorted.map((c) => c.id ?? c.title),
      `chapters must be sorted by start in lesson ${lesson.id}`
    );
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        startOf(sorted[i]) >= endOf(sorted[i - 1]),
        `chapters overlap in lesson ${lesson.id}: ${sorted[i - 1].id ?? sorted[i - 1].title} / ${sorted[i].id ?? sorted[i].title}`
      );
    }
  }
});

test("curriculum: transcript times monotonic and within [0, durationSec]", { skip: !curriculum }, () => {
  const lessons = lessonsOf();
  for (const lesson of lessons) {
    const transcript = lesson.transcript;
    if (!transcript) continue;
    assert.ok(Array.isArray(transcript), `transcript must be an array in lesson ${lesson.id}`);
    let prev = -Infinity;
    for (const cue of transcript) {
      const t = cueTimeOf(cue);
      assert.ok(Number.isFinite(t), `cue time must be finite in lesson ${lesson.id}`);
      assert.ok(t >= prev, `transcript times must be monotonic in lesson ${lesson.id}`);
      assert.ok(t >= 0, `transcript time must be >= 0 in lesson ${lesson.id}`);
      if (Number.isFinite(lesson.durationSec)) {
        assert.ok(
          t <= lesson.durationSec,
          `transcript time ${t} exceeds durationSec ${lesson.durationSec} in lesson ${lesson.id}`
        );
      }
      prev = t;
    }
  }
});

test("curriculum: quiz answer indices valid", { skip: !curriculum }, () => {
  const lessons = lessonsOf();
  for (const lesson of lessons) {
    const quiz = lesson.quiz ?? lesson.questions;
    if (!quiz) continue;
    assert.ok(Array.isArray(quiz), `quiz must be an array in lesson ${lesson.id}`);
    for (const q of quiz) {
      const options = q.options ?? q.choices;
      assert.ok(Array.isArray(options) && options.length > 0, `quiz question needs options in lesson ${lesson.id}`);
      const answer = q.answer ?? q.correctIndex ?? q.answerIndex;
      assert.ok(
        Number.isInteger(answer) && answer >= 0 && answer < options.length,
        `quiz answer index ${answer} invalid in lesson ${lesson.id}`
      );
    }
  }
});

test("curriculum: flashcards non-empty", { skip: !curriculum }, () => {
  const lessons = lessonsOf();
  for (const lesson of lessons) {
    const cards = lesson.flashcards;
    if (!cards) continue;
    assert.ok(Array.isArray(cards) && cards.length > 0, `flashcards must be non-empty in lesson ${lesson.id}`);
    for (const card of cards) {
      assert.ok(card.front || card.q, `flashcard needs a front in lesson ${lesson.id}`);
      assert.ok(card.back || card.a, `flashcard needs a back in lesson ${lesson.id}`);
    }
  }
});

test("curriculum: skillTree prerequisites reference existing ids and form no cycles", { skip: !curriculum }, () => {
  const tree = curriculumRoot.skillTree ?? curriculumRoot.skills;
  if (!tree) return; // optional section
  const nodes = Array.isArray(tree) ? tree : tree.nodes;
  assert.ok(Array.isArray(nodes) && nodes.length > 0, "skillTree must have nodes");
  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    const prereqs = node.prerequisites ?? node.prereqs ?? [];
    assert.ok(Array.isArray(prereqs), `prerequisites must be an array for node ${node.id}`);
    for (const p of prereqs) {
      assert.ok(ids.has(p), `prerequisite ${p} of node ${node.id} does not exist`);
    }
  }
  // Cycle detection via DFS.
  const adj = new Map(nodes.map((n) => [n.id, n.prerequisites ?? n.prereqs ?? []]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...ids].map((id) => [id, WHITE]));
  const visit = (id, path) => {
    color.set(id, GRAY);
    for (const next of adj.get(id) ?? []) {
      if (color.get(next) === GRAY) {
        throw new assert.AssertionError({
          message: `cycle in skillTree: ${[...path, id, next].join(" -> ")}`,
        });
      }
      if (color.get(next) === WHITE) visit(next, [...path, id]);
    }
    color.set(id, BLACK);
  };
  for (const id of ids) if (color.get(id) === WHITE) visit(id, []);
});

// ----------------------------------------------------------------- glossary

test("glossary: >= 8 terms, each with definition and analogies for every profile", { skip: !glossary }, () => {
  const terms = glossary.terms ?? glossary;
  const list = Array.isArray(terms) ? terms : Object.entries(terms).map(([term, v]) => ({ term, ...v }));
  assert.ok(list.length >= 8, `glossary needs >= 8 terms, found ${list.length}`);
  const profiles = glossary.profiles ?? ["beginner", "intermediate", "advanced"];
  for (const entry of list) {
    const def = entry.definition;
    assert.ok(typeof def === "string" && def.trim().length > 0, `term "${entry.term}" needs a definition`);
    const analogies = entry.analogies ?? entry.analogy;
    assert.ok(analogies && typeof analogies === "object", `term "${entry.term}" needs analogies`);
    for (const profile of profiles) {
      const a = analogies[profile];
      assert.ok(
        typeof a === "string" && a.trim().length > 0,
        `term "${entry.term}" needs an analogy for profile "${profile}"`
      );
    }
  }
});
