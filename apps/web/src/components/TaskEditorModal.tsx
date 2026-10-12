import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  GitBranch,
  Minus,
  Plus,
  Save,
  X,
} from "lucide-react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { api } from "@/lib/api";
import type {
  CognitiveLoad,
  Goal,
  Priority,
  Task,
  TaskInput,
  TaskStatus,
} from "@/lib/types";

interface TaskEditorModalProps {
  open: boolean;
  task: Task | null;
  tasks: Task[];
  onClose: () => void;
}

interface EditorFields {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  impact: number;
  estimateMinutes: number;
  actualMinutes: number;
  dueAt: string;
  cognitiveLoad: CognitiveLoad;
  goalAlignment: number;
  goalId: string | null;
  blocked: boolean;
  dependencies: string[];
}

interface StepDraft {
  id: string;
  title: string;
  estimateMinutes: number;
}

function datetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function toEditorFields(task: Task): EditorFields {
  return {
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    impact: task.impact,
    estimateMinutes: task.estimateMinutes,
    actualMinutes: task.actualMinutes,
    dueAt: datetimeLocalValue(task.dueAt),
    cognitiveLoad: task.cognitiveLoad,
    goalAlignment: task.goalAlignment,
    goalId: task.goalId,
    blocked: task.blocked,
    dependencies: task.dependencies,
  };
}

function makeStep(estimateMinutes: number): StepDraft {
  return {
    id: crypto.randomUUID(),
    title: "",
    estimateMinutes: Math.max(1, Math.min(720, Math.round(estimateMinutes))),
  };
}

export function TaskEditorModal({
  open,
  task,
  tasks,
  onClose,
}: TaskEditorModalProps) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLElement>(null);
  const [fields, setFields] = useState<EditorFields | null>(
    task ? toEditorFields(task) : null,
  );
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const goalsQuery = useQuery({
    queryKey: ["goals"],
    queryFn: api.getGoals,
    enabled: open,
  });

  useEffect(() => {
    if (!open || !task) return;
    setFields(toEditorFields(task));
    setBreakdownOpen(false);
    setSteps([]);
  }, [open, task]);

  const refreshWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["goals"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["plan"] }),
    ]);
  };

  const updateTask = useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: EditorFields }) =>
      api.updateTask(taskId, {
        title: input.title.trim(),
        description: input.description.trim() || null,
        status: input.status,
        priority: input.priority,
        impact: Math.max(1, Math.min(5, Math.round(input.impact))),
        estimateMinutes: Math.max(
          1,
          Math.min(720, Math.round(input.estimateMinutes)),
        ),
        actualMinutes: Math.max(
          0,
          Math.min(10_080, Math.round(input.actualMinutes)),
        ),
        dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
        cognitiveLoad: input.cognitiveLoad,
        goalAlignment: Math.max(0, Math.min(1, Number(input.goalAlignment))),
        goalId: input.goalId,
        blocked: input.blocked,
        dependencies: input.dependencies,
      }),
    onSuccess: async () => {
      await refreshWorkspace();
      onClose();
    },
  });

  const decomposeTask = useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: TaskInput[] }) =>
      api.decomposeTask(taskId, input),
    onSuccess: async () => {
      await refreshWorkspace();
      onClose();
    },
  });

  useDialogFocus({
    open: open && Boolean(task) && Boolean(fields),
    dialogRef,
    onDismiss: onClose,
    dismissDisabled: updateTask.isPending || decomposeTask.isPending,
  });

  const dependencyOptions = useMemo(
    () =>
      task
        ? tasks.filter(
            (candidate) => candidate.id !== task.id && !candidate.isDecomposed,
          )
        : [],
    [task, tasks],
  );
  const goalOptions = useMemo(
    () =>
      (goalsQuery.data?.items ?? []).filter(
        (goal: Goal) => goal.status === "active" || goal.id === fields?.goalId,
      ),
    [fields?.goalId, goalsQuery.data?.items],
  );

  if (!open || !task || !fields) return null;
  // Capture non-null values after the render guard so event callbacks retain
  // a stable, type-safe snapshot for this modal render.
  const editorTask = task;
  const editorFields = fields;

  const isBusy = updateTask.isPending || decomposeTask.isPending;
  const currentError = updateTask.error ?? decomposeTask.error;

  function patchFields(update: Partial<EditorFields>) {
    setFields((current) => (current ? { ...current, ...update } : current));
  }

  function toggleDependency(dependencyId: string) {
    patchFields({
      dependencies: editorFields.dependencies.includes(dependencyId)
        ? editorFields.dependencies.filter((id) => id !== dependencyId)
        : [...editorFields.dependencies, dependencyId],
    });
  }

  function openBreakdown() {
    updateTask.reset();
    decomposeTask.reset();
    setBreakdownOpen(true);
    if (steps.length === 0) setSteps([makeStep(editorFields.estimateMinutes)]);
  }

  function addStep() {
    setSteps((current) => [...current, makeStep(editorFields.estimateMinutes)]);
  }

  function patchStep(id: string, update: Partial<StepDraft>) {
    setSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...update } : step)),
    );
  }

  function removeStep(id: string) {
    setSteps((current) => current.filter((step) => step.id !== id));
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editorFields.title.trim()) return;
    decomposeTask.reset();
    updateTask.mutate({ taskId: editorTask.id, input: editorFields });
  }

  function confirmBreakdown() {
    if (
      steps.length === 0 ||
      steps.some(
        (step) =>
          !step.title.trim() ||
          !Number.isFinite(step.estimateMinutes) ||
          step.estimateMinutes < 1 ||
          step.estimateMinutes > 720,
      )
    ) {
      return;
    }
    updateTask.reset();
    const reviewedSteps: TaskInput[] = steps.map((step) => ({
      title: step.title.trim(),
      // The remaining planning fields are intentionally visible on the parent
      // editor and carried forward as a reviewable baseline. New steps start
      // actionable, unblocked, and without hidden dependencies.
      description: null,
      status: "todo",
      priority: editorFields.priority,
      impact: Math.max(1, Math.min(5, Math.round(editorFields.impact))),
      estimateMinutes: Math.max(
        1,
        Math.min(720, Math.round(step.estimateMinutes)),
      ),
      dueAt: editorFields.dueAt
        ? new Date(editorFields.dueAt).toISOString()
        : null,
      cognitiveLoad: editorFields.cognitiveLoad,
      goalAlignment: Math.max(
        0,
        Math.min(1, Number(editorFields.goalAlignment)),
      ),
      // The API also enforces parent-goal inheritance as the trusted boundary.
      goalId: editorFields.goalId,
      blocked: false,
      dependencies: [],
    }));
    decomposeTask.mutate({ taskId: editorTask.id, input: reviewedSteps });
  }

  const breakdownCanConfirm =
    steps.length > 0 &&
    steps.every(
      (step) =>
        Boolean(step.title.trim()) &&
        Number.isFinite(step.estimateMinutes) &&
        step.estimateMinutes >= 1 &&
        step.estimateMinutes <= 720,
    );

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={() => !isBusy && onClose()}
    >
      <section
        ref={dialogRef}
        className="modal-card task-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">TASK DETAILS</span>
            <h2 id="task-editor-title">Shape the work deliberately.</h2>
            {task.isDecomposed ? (
              <p className="editor-context">
                This is a breakdown container. It stays visible for context and
                is excluded from future plan drafts.
              </p>
            ) : task.parentTaskId ? (
              <p className="editor-context">
                This is a confirmed step. It can be planned and focused like any
                other task.
              </p>
            ) : null}
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close task editor"
            onClick={onClose}
            disabled={isBusy}
          >
            <X size={18} />
          </button>
        </header>

        <form className="capture-form task-editor-form" onSubmit={save}>
          <label>
            Task title
            <input
              data-dialog-initial-focus
              value={fields.title}
              onChange={(event) => patchFields({ title: event.target.value })}
              maxLength={200}
              required
            />
          </label>
          <label>
            Context <span className="field-optional">optional</span>
            <textarea
              value={fields.description}
              onChange={(event) =>
                patchFields({ description: event.target.value })
              }
              maxLength={10_000}
              rows={3}
              placeholder="What would help your future self begin?"
            />
          </label>

          <div className="form-grid task-editor-grid">
            <label>
              Status
              <select
                value={fields.status}
                onChange={(event) =>
                  patchFields({ status: event.target.value as TaskStatus })
                }
              >
                <option value="backlog">Backlog</option>
                <option value="todo">To do</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </label>
            <label>
              Priority
              <select
                value={fields.priority}
                onChange={(event) =>
                  patchFields({ priority: event.target.value as Priority })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label>
              Estimate (minutes)
              <input
                type="number"
                min="1"
                max="720"
                value={fields.estimateMinutes}
                onChange={(event) =>
                  patchFields({ estimateMinutes: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Actual minutes
              <input
                type="number"
                min="0"
                max="10080"
                value={fields.actualMinutes}
                onChange={(event) =>
                  patchFields({ actualMinutes: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Impact (1–5)
              <input
                type="number"
                min="1"
                max="5"
                value={fields.impact}
                onChange={(event) =>
                  patchFields({ impact: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Cognitive load
              <select
                value={fields.cognitiveLoad}
                onChange={(event) =>
                  patchFields({
                    cognitiveLoad: event.target.value as CognitiveLoad,
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Goal alignment (0–1)
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={fields.goalAlignment}
                onChange={(event) =>
                  patchFields({ goalAlignment: Number(event.target.value) })
                }
              />
            </label>
            <label className="task-goal-field">
              Goal <span className="field-optional">optional</span>
              <select
                value={fields.goalId ?? ""}
                onChange={(event) =>
                  patchFields({ goalId: event.target.value || null })
                }
              >
                <option value="">No linked goal</option>
                {goalOptions.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                    {goal.status === "active" ? "" : ` · ${goal.status}`}
                  </option>
                ))}
              </select>
              <small>
                This records real context; it does not silently change the
                task’s planning score.
              </small>
              {goalsQuery.isError && (
                <small className="task-goal-load-error">
                  Goals could not be loaded. Keep or clear the current link and
                  try again.
                </small>
              )}
            </label>
            <label>
              Due <span className="field-optional">optional</span>
              <input
                type="datetime-local"
                value={fields.dueAt}
                onChange={(event) => patchFields({ dueAt: event.target.value })}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={fields.blocked}
                onChange={(event) =>
                  patchFields({ blocked: event.target.checked })
                }
              />
              <span>Currently blocked</span>
            </label>
          </div>

          <fieldset className="dependency-editor">
            <legend>Dependencies</legend>
            <p>
              Select work that must be completed before this task. Circular
              relationships and non-actionable breakdown containers are safely
              rejected.
            </p>
            {dependencyOptions.length === 0 ? (
              <span className="dependency-empty">
                No other actionable tasks are available yet.
              </span>
            ) : (
              <div className="dependency-options">
                {dependencyOptions.map((candidate) => (
                  <label key={candidate.id} className="dependency-option">
                    <input
                      type="checkbox"
                      checked={fields.dependencies.includes(candidate.id)}
                      onChange={() => toggleDependency(candidate.id)}
                    />
                    <span>{candidate.title}</span>
                    <small>{candidate.estimateMinutes} min</small>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {!task.isDecomposed && task.status !== "done" && (
            <section
              className="breakdown-panel"
              aria-labelledby="breakdown-title"
            >
              <div className="breakdown-heading">
                <div>
                  <span className="eyebrow">CONFIRMED BREAKDOWN</span>
                  <h3 id="breakdown-title">Turn this into reviewed steps.</h3>
                  <p>
                    Add only the steps you want. They remain a local review
                    until you explicitly confirm creation; nothing is generated
                    automatically.
                  </p>
                </div>
                {!breakdownOpen && (
                  <button
                    className="button button-quiet button-small"
                    type="button"
                    onClick={openBreakdown}
                    disabled={isBusy}
                  >
                    <GitBranch size={15} /> Break into steps
                  </button>
                )}
              </div>

              {breakdownOpen && (
                <div className="step-review">
                  <p className="breakdown-inheritance">
                    Review each title and estimate below. Confirmed steps start
                    as unblocked to-dos and inherit this task’s priority,
                    impact, due date, cognitive load, goal alignment, and goal
                    link. Save parent edits first if you want those values
                    carried forward.
                  </p>
                  <div className="step-list">
                    {steps.map((step, index) => (
                      <div className="step-draft" key={step.id}>
                        <span className="step-number">{index + 1}</span>
                        <label>
                          Step title
                          <input
                            value={step.title}
                            onChange={(event) =>
                              patchStep(step.id, { title: event.target.value })
                            }
                            placeholder="Describe one concrete action"
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Minutes
                          <input
                            type="number"
                            min="1"
                            max="720"
                            value={step.estimateMinutes}
                            onChange={(event) =>
                              patchStep(step.id, {
                                estimateMinutes: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <button
                          className="icon-button destructive-button"
                          type="button"
                          aria-label={`Remove step ${index + 1}`}
                          onClick={() => removeStep(step.id)}
                          disabled={isBusy}
                        >
                          <Minus size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="step-review-actions">
                    <button
                      className="button button-quiet button-small"
                      type="button"
                      onClick={addStep}
                      disabled={isBusy || steps.length >= 25}
                    >
                      <Plus size={15} /> Add reviewed step
                    </button>
                    <button
                      className="button button-primary button-small"
                      type="button"
                      onClick={confirmBreakdown}
                      disabled={!breakdownCanConfirm || isBusy}
                    >
                      <Check size={15} />
                      {decomposeTask.isPending
                        ? "Creating confirmed steps…"
                        : "Confirm and create steps"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {currentError && (
            <p className="form-error" role="alert">
              <AlertCircle size={16} />
              {currentError.message}
            </p>
          )}
          <footer className="modal-actions">
            <button
              className="button button-quiet"
              type="button"
              onClick={onClose}
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={!fields.title.trim() || isBusy}
            >
              <Save size={16} />
              {updateTask.isPending ? "Saving…" : "Save task"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
