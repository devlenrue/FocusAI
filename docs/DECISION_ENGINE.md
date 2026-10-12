# FocusAI deterministic decision engine

## Purpose

The current engine is a pure TypeScript domain package at `packages/decision-engine`. It produces explainable, structured recommendations even if no paid AI provider exists or an optional provider fails. It is the authority for ranking, capacity, dependencies, scheduling constraints, and recovery guardrails.

It is deliberately **not** an AI chatbot and does not invent tasks, commitments, historical behavior, or availability.

## Input contract

The engine accepts only supplied records:

- active tasks: priority, impact, estimate, due time, optional goal alignment, cognitive load, dependencies, completed/blocked state;
- explicit availability windows;
- fixed commitments to subtract from availability;
- user-selected readiness (`low`, `steady`, `high`);
- planning preferences such as transition time and recovery cognitive cap;
- an explicit planning timestamp.

Missing data receives transparent defaults. For example, a missing due date uses a low baseline urgency; it is not treated as secretly urgent. The current API's working-hour default is documented separately and disclosed in the UI.

## Ranking formula

Each active task receives a normalized score rounded to three decimals:

```text
score = urgency × 0.31
      + priority × 0.24
      + impact × 0.18
      + goalAlignment × 0.12
      + effortFit × 0.09
      + readinessFit × 0.06
```

The weights are configurable per engine call and are renormalized if overridden. The default weights sum to 1.0.

### Input normalization

| Signal         | Current rule                                                                            |
| -------------- | --------------------------------------------------------------------------------------- |
| Urgency        | overdue = 1.0; ≤8h = .97; ≤24h = .88; ≤72h = .70; ≤7d = .42; later = .18; unknown = .15 |
| Priority       | low = .20; medium = .50; high = .78; critical = 1.0                                     |
| Impact         | Map user-provided 1–5 to 0–1                                                            |
| Goal alignment | Explicit 0–1 value; currently no goal UI populates it                                   |
| Effort fit     | Higher for work that can realistically fit available capacity                           |
| Readiness fit  | Matches low/steady/high user readiness to low/medium/high cognitive load                |

The engine emits human-readable reasons only for signals that actually apply, such as “Its deadline is within the next day,” “It has a high expected impact,” or “It matches the energy level you selected.” These are deterministic reasons based on the submitted fields.

## Scheduling algorithm

1. Validate and normalize each availability window.
2. Subtract fixed commitments from the windows.
3. Calculate real available capacity from the remaining intervals.
4. Rank active tasks.
5. Iterate tasks in score order, making successive passes when dependencies require a lower-ranked prerequisite to be scheduled first.
6. Place each whole task in the earliest contiguous remaining interval that:
   - is long enough for its estimate (respecting minimum focus block size),
   - starts after any scheduled prerequisite,
   - does not overlap a fixed commitment or another generated block.
7. Reserve the configured transition buffer after each scheduled block.
8. Explicitly defer blocked, impossible-dependency, or no-capacity tasks instead of silently overbooking them.
9. Return top three priorities, next action, scheduled blocks, deferred tasks, and feasibility totals.

### Important current constraint: whole tasks

The first scheduler only places a task if it fits as one contiguous block. It does not yet decompose a 90-minute task across separate 60-minute windows. In that case it returns an explicit `capacity` deferral rather than claiming a fake plan. User-approved decomposition is planned work.

## Recovery plan

Recovery is a separate operation, not a punitive rewrite:

1. The API derives the remainder of the working window from the supplied current timestamp (when no explicit availability is sent).
2. Fixed commitments are subtracted.
3. The engine determines remaining capacity.
4. It applies the high-cognitive-load cap only in recovery mode.
5. It schedules realistic remaining work and returns deferrals with a reason.
6. The old plan is preserved as a superseded historical plan; no unrelated task or focus history is reset.

### High-cognitive-load cap

Default rule:

```text
high cognitive scheduled work ≤ floor(remaining capacity × 0.20)
```

This is a configurable user preference (`high_cognitive_recovery_cap`), **not** a universal psychological law. The cap applies only to recovery mode. A high-cognitive task over that allowance is deferred with a transparent explanation; it is not marked as a failure.

### Current-day recovery signal

The API also derives a read-only recovery signal when the operative current local-day **daily** plan has a block whose end time has passed while its linked task is still open. This is a dashboard prompt, not an engine score or a task-state transition.

- It considers only the current user's current local date and the same draft/accepted-plan precedence used for their visible plan.
- It excludes completed, blocked, deleted, and breakdown-container tasks, plus a task with an active focus session; a person currently focusing is not presumed to have missed the work.
- When a recovery draft or approval is the operative current plan, it suppresses the original-daily-plan prompt. The user has already made an explicit response to changed reality.
- Detection performs **no write**: it does not mark a task failed, complete, deferred, or late, and it does not regenerate a plan.
- The person may choose **Create recovery draft** in Planning Studio. Only then does the existing recovery generator calculate remaining availability and apply the configurable high-cognitive cap.

## Deterministic fallback and future hybrid intelligence

The deterministic engine is already the fallback. A future LLM adapter may help with task decomposition, natural-language explanation, or coaching, but must:

- live behind a provider interface;
- receive only authorized, minimal data;
- have timeouts and error handling;
- validate structured responses;
- never create facts or bypass feasibility/authorization rules;
- require clear confirmation for consequential changes.

Until this exists, the product must not say an LLM integration is connected.

## Tests currently covering the engine

`packages/decision-engine/src/index.test.ts` verifies:

- an overdue/high-impact task outranks low-impact undated work;
- fixed commitments are excluded and capacity overflow becomes an explicit deferral;
- dependency order is respected even when the dependent item has a higher score;
- the configurable 20% recovery cap applies in recovery mode.

The API integration test additionally verifies a recovery request derives a 120-minute remaining-day window for a 16:00 UTC recovery in the 09:00–18:00 UTC default workday, and that a current passed block produces a read-only recovery signal which clears for an active focus session, an operative recovery plan, or a completed task. The Chromium workflow also verifies that a 90-minute low-priority prerequisite spanning two fragmented remaining intervals is shown as an explicit capacity deferral—not forced into the day or silently changed—and that its higher-priority dependent task receives the separate factual dependency deferral. Task Workspace confirms both remain actionable and preserves the dependency link.

## Not yet modeled

- User-adjustable weight UI/persistence;
- calendar CRUD and break windows;
- task splitting/subtasks/recurrence;
- more detailed dependency-cycle diagnostics;
- historical learning/recommendation feedback;
- timezone/DST-aware daily planning;
- external-calendar authorization;
- optional LLM provider behavior.
