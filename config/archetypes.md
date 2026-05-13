# Hook Archetypes

The autoimprove writer (`scripts/enhance.mjs`) loads this file and retrieves the
2–3 archetypes that fit each draft's `**Type:**`, then asks the model to
instantiate them as variants A/B/C. Curate over time: paste exemplar URLs (with
engagement numbers) as posts land them.

Format per archetype:
- `## <archetype-name>` — kebab-case identifier used in variant payloads.
- `**Mechanic:**` — one sentence: WHY this hook archetype pulls a scroll-stop
  lever. Knowing the mechanic prevents lazy template stamping.
- `**Fits types:**` — comma-separated draft types this archetype is good for.
  Matched against the draft's `**Type:**` (normalized: lowercased, separator
  prefix only — anything after `—`, `·`, or `-` is ignored when matching).
- `**Structure:**` — fenced template with `<placeholders>`. Line breaks matter.
- `**Exemplars:**` — bullet list. Cite handle, engagement, date, and a quote
  if you have it.

---

## introducing-X

**Mechanic:** lowercase noun alone on line 1 lets a scroller's eye lock on the name with zero verb overhead; pipeline arrows in the body show actual data flow; outcome on the last line is the payoff.

**Fits types:** building-in-public, trending-reaction

**Structure:**
```
<lowercase product/tool name>

<step1> → <step2> → <step3>

<outcome / what makes it work>
```

**Exemplars:**
- @aidenybai · Claude Doctor — 2556L / 3690B (2026-05-08) — opens with `claude doctor` alone on line 1, pipeline body, outcome at end.
- TODO: paste 2 more peer URLs matching this shape

---

## cause/fix

**Mechanic:** failure-state hook on line 1 arrests the scroll because it names a problem the reader recognizes; `cause:` + `fix:` on their own lines let the eye scan the diagnosis in two seconds; named tools/numbers do the persuasion.

**Fits types:** technical-tip, building-in-public

**Structure:**
```
<failure state, colon-terminated>: <symptom>

cause: <one-fragment reason>
fix: <named tool / pipeline / mechanism>

<bonus: locality, cost, latency>
```

**Exemplars:**
- @octavicristea — own 2026-05-09 offline-beat-recovery post (see `posted/archive.md`). Opens `player picks a choice, network dies mid-stream`, then cause + fix on labeled lines.
- @octavicristea — own 2026-05-03 roadtosf base64 leak post (see `posted/archive.md`). Same shape, lands a cost number.
- TODO: paste 2 peer URLs in the dev/indie-hacker lane

---

## I-just-replaced-X-with-Y

**Mechanic:** specific swap claim with before/after metric. Concrete because it names both ends of the swap and quantifies the win — readers can pattern-match to their own stack.

**Fits types:** technical-tip, building-in-public

**Structure:**
```
I just replaced <thing X> with <thing Y> for <use case>

<thing X>: <metric>
<thing Y>: <metric>

<resulting capability / what was preserved>
```

**Exemplars:**
- TODO: paste @levelsio URL — this is one of his recurring shapes
- TODO: paste @swyx or @theo equivalent

---

## numbered-gotchas

**Mechanic:** "N <topic> gotchas" sets expectation of a bare-list of pain points; labeled blocks (`Tool A: ...` / `Tool B: ...`) let readers scan to the one that's stinging them right now. High save-rate because it doubles as a checklist.

**Fits types:** technical-tip, building-in-public, thread

**Structure:**
```
<N> <topic> gotchas:

<Tool A>: <symptom>. <one-line fix>

<Tool B>: <symptom>. <one-line fix>
```

**Exemplars:**
- TODO: paste @levelsio launch-day gotcha URL
- TODO: paste @antirez bare-list stack tweet

---

## outlier-data

**Mechanic:** counter-intuitive number on line 1 stops the scroll because it conflicts with the reader's prior; one-line why grounds it before they bounce. Works best with a chart or table image.

**Fits types:** trending-reaction, contrarian-take

**Structure:**
```
<surprising number / metric>

<named entity / company / model>. <one-line why>

<source / chart link>
```

**Exemplars:**
- TODO: paste @benln synthesis-screenshot URL — this format dominates outlier-data
- TODO: paste @swyx or @karpathy outlier-data URL

---

## shipped-X-in-a-weekend

**Mechanic:** "shipped <verb + thing>" on line 1 is past-tense proof (not aspirational); the 3-bullet stack list with arrow connectors is bare-list scannability; a repo/demo link is implicit credibility.

**Fits types:** building-in-public

**Structure:**
```
shipped <thing> in a weekend

→ <tool 1>
→ <tool 2>
→ <tool 3>

<repo / demo URL>
```

**Exemplars:**
- TODO: paste @levelsio weekend-ship URL
- TODO: paste @swyx weekend-ship URL
