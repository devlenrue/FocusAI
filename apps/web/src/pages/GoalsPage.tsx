import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  Check,
  ChevronRight,
  CirclePlus,
  Flag,
  Link2,
  ListChecks,
  Pencil,
  Plus,
  Save,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { api } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import type {
  Goal,
  GoalStatus,
  Milestone,
  Project,
  ProjectStatus,
} from "@/lib/types";

interface ProjectDraft {
  title: string;
  description: string;
  status: ProjectStatus;
  targetDate: string;
}

interface GoalDraft {
  projectId: string | null;
  title: string;
  description: string;
  status: GoalStatus;
  targetDate: string;
}

interface MilestoneDraft {
  goalId: string;
  milestoneId: string | null;
  title: string;
  targetDate: string;
}

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_GOALS: Goal[] = [];

const emptyProjectDraft = (): ProjectDraft => ({
  title: "",
  description: "",
  status: "active",
  targetDate: "",
});

const emptyGoalDraft = (): GoalDraft => ({
  projectId: null,
  title: "",
  description: "",
  status: "active",
  targetDate: "",
});

function projectDraftFor(project: Project): ProjectDraft {
  return {
    title: project.title,
    description: project.description ?? "",
    status: project.status,
    targetDate: project.targetDate ?? "",
  };
}

function goalDraftFor(goal: Goal): GoalDraft {
  return {
    projectId: goal.projectId,
    title: goal.title,
    description: goal.description ?? "",
    status: goal.status,
    targetDate: goal.targetDate ?? "",
  };
}

function milestoneDraftFor(
  goalId: string,
  milestone?: Milestone,
): MilestoneDraft {
  return {
    goalId,
    milestoneId: milestone?.id ?? null,
    title: milestone?.title ?? "",
    targetDate: milestone?.targetDate ?? "",
  };
}

function compactDate(value: string | null): string | null {
  return value ? formatShortDate(value) : null;
}

function goalProgress(goal: Goal) {
  const total = goal.progress.totalTasks + goal.progress.totalMilestones;
  const completed =
    goal.progress.completedTasks + goal.progress.completedMilestones;
  return {
    total,
    completed,
    percentage: total ? Math.round((completed / total) * 100) : 0,
  };
}

function projectLabel(project: Project): string {
  const { totalGoals, completedGoals } = project.progress;
  if (!totalGoals) return "No goals linked yet";
  return `${completedGoals} of ${totalGoals} goals completed`;
}

export function GoalsPage() {
  const queryClient = useQueryClient();
  const [projectEditingId, setProjectEditingId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] =
    useState<ProjectDraft>(emptyProjectDraft);
  const [goalEditingId, setGoalEditingId] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(emptyGoalDraft);
  const [milestoneDraft, setMilestoneDraft] = useState<MilestoneDraft | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });
  const goalsQuery = useQuery({
    queryKey: ["goals"],
    queryFn: api.getGoals,
  });

  const refreshRecords = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["project"] }),
      queryClient.invalidateQueries({ queryKey: ["goals"] }),
      queryClient.invalidateQueries({ queryKey: ["goal"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["plan"] }),
    ]);
  };

  const saveProject = useMutation({
    mutationFn: ({
      projectId,
      draft,
    }: {
      projectId: string | null;
      draft: ProjectDraft;
    }) => {
      const input = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        status: draft.status,
        targetDate: draft.targetDate || null,
      };
      return projectId
        ? api.updateProject(projectId, input)
        : api.createProject(input);
    },
    onSuccess: async (_project, variables) => {
      setMessage(
        variables.projectId
          ? "Project updated. Its goals stay intact."
          : "Project created. Add goals only when they are meaningful.",
      );
      setProjectEditingId(null);
      setProjectDraft(emptyProjectDraft());
      await refreshRecords();
    },
  });

  const deleteProject = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: async (_result, projectId) => {
      setMessage(
        "Project removed. Its goals were preserved without a project link.",
      );
      setProjectEditingId(null);
      setProjectDraft(emptyProjectDraft());
      setGoalDraft((current) =>
        current.projectId === projectId
          ? { ...current, projectId: null }
          : current,
      );
      await refreshRecords();
    },
  });

  const saveGoal = useMutation({
    mutationFn: ({
      goalId,
      draft,
    }: {
      goalId: string | null;
      draft: GoalDraft;
    }) => {
      const input = {
        projectId: draft.projectId,
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        status: draft.status,
        targetDate: draft.targetDate || null,
      };
      return goalId ? api.updateGoal(goalId, input) : api.createGoal(input);
    },
    onSuccess: async (_goal, variables) => {
      setMessage(
        variables.goalId
          ? "Goal updated. Completion still requires real linked work and milestones."
          : "Goal created. Link tasks deliberately from the task editor.",
      );
      setGoalEditingId(null);
      setGoalDraft(emptyGoalDraft());
      await refreshRecords();
    },
  });

  const completeGoal = useMutation({
    mutationFn: (goalId: string) =>
      api.updateGoal(goalId, { status: "completed" }),
    onSuccess: async () => {
      setMessage("Goal completed with its recorded tasks and milestones.");
      await refreshRecords();
    },
  });

  const deleteGoal = useMutation({
    mutationFn: api.deleteGoal,
    onSuccess: async () => {
      setMessage(
        "Goal removed. Linked tasks were preserved and released from that goal.",
      );
      setGoalEditingId(null);
      setGoalDraft(emptyGoalDraft());
      setMilestoneDraft(null);
      await refreshRecords();
    },
  });

  const saveMilestone = useMutation({
    mutationFn: (draft: MilestoneDraft) => {
      const input = {
        title: draft.title.trim(),
        targetDate: draft.targetDate || null,
      };
      return draft.milestoneId
        ? api.updateMilestone(draft.goalId, draft.milestoneId, input)
        : api.createMilestone(draft.goalId, input);
    },
    onSuccess: async () => {
      setMessage("Milestone saved. Its completion remains an explicit action.");
      setMilestoneDraft(null);
      await refreshRecords();
    },
  });

  const toggleMilestone = useMutation({
    mutationFn: ({
      goalId,
      milestone,
    }: {
      goalId: string;
      milestone: Milestone;
    }) =>
      api.updateMilestone(goalId, milestone.id, {
        status: milestone.status === "completed" ? "pending" : "completed",
      }),
    onSuccess: async () => {
      setMessage("Milestone status updated.");
      await refreshRecords();
    },
  });

  const deleteMilestone = useMutation({
    mutationFn: ({
      goalId,
      milestoneId,
    }: {
      goalId: string;
      milestoneId: string;
    }) => api.deleteMilestone(goalId, milestoneId),
    onSuccess: async () => {
      setMessage("Milestone removed. No task or goal record was erased.");
      setMilestoneDraft(null);
      await refreshRecords();
    },
  });

  const projects = projectsQuery.data?.items ?? EMPTY_PROJECTS;
  const goals = goalsQuery.data?.items ?? EMPTY_GOALS;
  const eligibleProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.status === "active" || project.id === goalDraft.projectId,
      ),
    [goalDraft.projectId, projects],
  );
  const error =
    projectsQuery.error ??
    goalsQuery.error ??
    saveProject.error ??
    deleteProject.error ??
    saveGoal.error ??
    completeGoal.error ??
    deleteGoal.error ??
    saveMilestone.error ??
    toggleMilestone.error ??
    deleteMilestone.error ??
    null;
  const isBusy =
    saveProject.isPending ||
    deleteProject.isPending ||
    saveGoal.isPending ||
    completeGoal.isPending ||
    deleteGoal.isPending ||
    saveMilestone.isPending ||
    toggleMilestone.isPending ||
    deleteMilestone.isPending;

  function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectDraft.title.trim()) return;
    setMessage(null);
    saveProject.mutate({ projectId: projectEditingId, draft: projectDraft });
  }

  function submitGoal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goalDraft.title.trim()) return;
    setMessage(null);
    saveGoal.mutate({ goalId: goalEditingId, draft: goalDraft });
  }

  function submitMilestone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!milestoneDraft?.title.trim()) return;
    setMessage(null);
    saveMilestone.mutate(milestoneDraft);
  }

  function beginProjectEdit(project: Project) {
    setProjectEditingId(project.id);
    setProjectDraft(projectDraftFor(project));
    setMessage(null);
  }

  function beginGoalEdit(goal: Goal) {
    setGoalEditingId(goal.id);
    setGoalDraft(goalDraftFor(goal));
    setMessage(null);
  }

  function confirmDeleteProject(project: Project) {
    if (
      window.confirm(
        `Remove “${project.title}”? Its goals will be preserved without a project link.`,
      )
    ) {
      deleteProject.mutate(project.id);
    }
  }

  function confirmDeleteGoal(goal: Goal) {
    if (
      window.confirm(
        `Remove “${goal.title}”? Linked tasks stay in your workspace but lose this goal link. Its milestones will be removed.`,
      )
    ) {
      deleteGoal.mutate(goal.id);
    }
  }

  function confirmDeleteMilestone(goalId: string, milestone: Milestone) {
    if (window.confirm(`Remove milestone “${milestone.title}”?`)) {
      deleteMilestone.mutate({ goalId, milestoneId: milestone.id });
    }
  }

  if (projectsQuery.isPending || goalsQuery.isPending) {
    return <LoadingState label="Opening your goals and milestones…" />;
  }
  if (projectsQuery.isError || goalsQuery.isError) {
    return (
      <ErrorState
        message={
          projectsQuery.error?.message ??
          goalsQuery.error?.message ??
          "Goals are unavailable."
        }
        onRetry={() => {
          void projectsQuery.refetch();
          void goalsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="goals-page page-stack">
      <section className="goals-hero">
        <div>
          <span className="eyebrow">PROJECTS, GOALS & MILESTONES</span>
          <h1>
            Make the direction
            <br />
            <span>as real as the work.</span>
          </h1>
          <p>
            Organize goals under projects, link actual tasks, and mark
            milestones only when they are complete. These records add context;
            they do not invent progress or silently reprioritize a plan.
          </p>
        </div>
        <div className="goals-hero-mark" aria-hidden="true">
          <Target size={30} />
          <i />
          <i />
        </div>
      </section>

      {message && (
        <div className="inline-notice success-notice" role="status">
          <Check size={16} /> {message}
        </div>
      )}
      {error && (
        <div className="inline-notice error-notice" role="alert">
          <AlertCircle size={16} /> {error.message}
        </div>
      )}

      <section className="goals-control-grid">
        <article className="panel goal-form-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {goalEditingId ? "EDIT GOAL" : "NEW GOAL"}
              </span>
              <h2>
                {goalEditingId
                  ? "Keep the outcome honest."
                  : "Name a meaningful outcome."}
              </h2>
            </div>
            <Target size={20} className="violet-icon" />
          </div>
          <form className="goal-record-form" onSubmit={submitGoal}>
            <label>
              Goal title
              <input
                value={goalDraft.title}
                onChange={(event) =>
                  setGoalDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                maxLength={200}
                placeholder="e.g. Ship a calm, usable first release"
                required
              />
            </label>
            <label>
              Context <span className="field-optional">optional</span>
              <textarea
                value={goalDraft.description}
                onChange={(event) =>
                  setGoalDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                maxLength={10_000}
                rows={3}
                placeholder="What does completion actually mean?"
              />
            </label>
            <div className="goal-form-grid">
              <label>
                Project <span className="field-optional">optional</span>
                <select
                  value={goalDraft.projectId ?? ""}
                  onChange={(event) =>
                    setGoalDraft((current) => ({
                      ...current,
                      projectId: event.target.value || null,
                    }))
                  }
                >
                  <option value="">No project grouping</option>
                  {eligibleProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                      {project.status === "active"
                        ? ""
                        : ` · ${project.status}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target date <span className="field-optional">optional</span>
                <input
                  type="date"
                  value={goalDraft.targetDate}
                  onChange={(event) =>
                    setGoalDraft((current) => ({
                      ...current,
                      targetDate: event.target.value,
                    }))
                  }
                />
              </label>
              {goalEditingId && (
                <label>
                  State
                  <select
                    value={goalDraft.status}
                    onChange={(event) =>
                      setGoalDraft((current) => ({
                        ...current,
                        status: event.target.value as GoalStatus,
                      }))
                    }
                  >
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              )}
            </div>
            <p className="goal-form-note">
              Completing a goal is protected: linked actionable tasks and
              milestones must first be marked complete or released.
            </p>
            <footer className="goal-form-actions">
              {goalEditingId && (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => {
                    setGoalEditingId(null);
                    setGoalDraft(emptyGoalDraft());
                  }}
                  disabled={isBusy}
                >
                  <X size={16} /> Cancel edit
                </button>
              )}
              <button
                className="button button-primary"
                type="submit"
                disabled={!goalDraft.title.trim() || isBusy}
              >
                <Save size={16} />
                {saveGoal.isPending
                  ? "Saving…"
                  : goalEditingId
                    ? "Save goal"
                    : "Create goal"}
              </button>
            </footer>
          </form>
        </article>

        <article className="panel project-form-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {projectEditingId ? "EDIT PROJECT" : "PROJECTS"}
              </span>
              <h2>
                {projectEditingId
                  ? "Refine the grouping."
                  : "Group work when it helps."}
              </h2>
            </div>
            <Flag size={20} className="cyan-icon" />
          </div>
          <form
            className="goal-record-form compact-record-form"
            onSubmit={submitProject}
          >
            <label>
              Project title
              <input
                value={projectDraft.title}
                onChange={(event) =>
                  setProjectDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                maxLength={200}
                placeholder="e.g. FocusAI foundation"
                required
              />
            </label>
            <div className="goal-form-grid">
              <label>
                Target date <span className="field-optional">optional</span>
                <input
                  type="date"
                  value={projectDraft.targetDate}
                  onChange={(event) =>
                    setProjectDraft((current) => ({
                      ...current,
                      targetDate: event.target.value,
                    }))
                  }
                />
              </label>
              {projectEditingId && (
                <label>
                  State
                  <select
                    value={projectDraft.status}
                    onChange={(event) =>
                      setProjectDraft((current) => ({
                        ...current,
                        status: event.target.value as ProjectStatus,
                      }))
                    }
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              )}
            </div>
            <label>
              Context <span className="field-optional">optional</span>
              <textarea
                value={projectDraft.description}
                onChange={(event) =>
                  setProjectDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                maxLength={10_000}
                rows={2}
                placeholder="What belongs together here?"
              />
            </label>
            <footer className="goal-form-actions">
              {projectEditingId && (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => {
                    setProjectEditingId(null);
                    setProjectDraft(emptyProjectDraft());
                  }}
                  disabled={isBusy}
                >
                  <X size={16} /> Cancel
                </button>
              )}
              <button
                className="button button-quiet"
                type="submit"
                disabled={!projectDraft.title.trim() || isBusy}
              >
                <Save size={16} />
                {saveProject.isPending
                  ? "Saving…"
                  : projectEditingId
                    ? "Save project"
                    : "Add project"}
              </button>
            </footer>
          </form>
          {projects.length > 0 && (
            <div className="project-summary-list">
              {projects.map((project) => (
                <article key={project.id} className="project-summary-row">
                  <div>
                    <span className={`record-status status-${project.status}`}>
                      {project.status}
                    </span>
                    <strong>{project.title}</strong>
                    <small>{projectLabel(project)}</small>
                  </div>
                  <div className="record-row-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Edit project ${project.title}`}
                      onClick={() => beginProjectEdit(project)}
                      disabled={isBusy}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button destructive-button"
                      type="button"
                      aria-label={`Delete project ${project.title}`}
                      onClick={() => confirmDeleteProject(project)}
                      disabled={isBusy}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>

      {goals.length === 0 ? (
        <EmptyState
          eyebrow="NO GOALS RECORDED"
          title="A direction is useful when you choose it."
          body="Create one outcome, then connect actual tasks from their editor. Progress will reflect only stored completion records."
          action={
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                document
                  .querySelector<HTMLInputElement>(".goal-form-card input")
                  ?.focus();
              }}
            >
              <CirclePlus size={17} /> Create first goal
            </button>
          }
        />
      ) : (
        <section className="goal-list" aria-label="Goals">
          {goals.map((goal) => {
            const progress = goalProgress(goal);
            const isOpen = goal.status === "active";
            const editingMilestoneForGoal =
              milestoneDraft?.goalId === goal.id ? milestoneDraft : null;
            return (
              <article
                key={goal.id}
                className={`panel goal-card status-${goal.status}`}
              >
                <header className="goal-card-header">
                  <div>
                    <div className="goal-card-kicker">
                      <span className={`record-status status-${goal.status}`}>
                        {goal.status}
                      </span>
                      {goal.projectTitle && (
                        <span className="goal-project-label">
                          <Flag size={12} /> {goal.projectTitle}
                        </span>
                      )}
                    </div>
                    <h2>{goal.title}</h2>
                    {goal.description && <p>{goal.description}</p>}
                  </div>
                  <div className="goal-card-actions">
                    <Link
                      className="button button-quiet button-small"
                      to={`/tasks?goalId=${goal.id}`}
                    >
                      <Link2 size={15} /> Tasks
                    </Link>
                    {isOpen && (
                      <button
                        className="button button-primary button-small"
                        type="button"
                        onClick={() => completeGoal.mutate(goal.id)}
                        disabled={isBusy}
                      >
                        <Check size={15} /> Complete goal
                      </button>
                    )}
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Edit goal ${goal.title}`}
                      onClick={() => beginGoalEdit(goal)}
                      disabled={isBusy}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button destructive-button"
                      type="button"
                      aria-label={`Delete goal ${goal.title}`}
                      onClick={() => confirmDeleteGoal(goal)}
                      disabled={isBusy}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </header>

                <section
                  className="goal-progress"
                  aria-label={`${goal.title} progress`}
                >
                  <div className="goal-progress-heading">
                    <strong>
                      {progress.total
                        ? `${progress.completed} of ${progress.total} recorded items complete`
                        : "No linked tasks or milestones yet"}
                    </strong>
                    <span>{progress.percentage}%</span>
                  </div>
                  <div className="goal-progress-track">
                    <span style={{ width: `${progress.percentage}%` }} />
                  </div>
                  <div className="goal-progress-meta">
                    <span>
                      {goal.progress.completedTasks}/{goal.progress.totalTasks}{" "}
                      tasks
                    </span>
                    <span>
                      {goal.progress.completedMilestones}/
                      {goal.progress.totalMilestones} milestones
                    </span>
                    {compactDate(goal.targetDate) && (
                      <span>Target {compactDate(goal.targetDate)}</span>
                    )}
                  </div>
                </section>

                <section className="milestone-section">
                  <div className="milestone-section-heading">
                    <div>
                      <span className="eyebrow">MILESTONES</span>
                      <h3>Mark the moments that matter.</h3>
                    </div>
                    {isOpen && !editingMilestoneForGoal && (
                      <button
                        className="button button-quiet button-small"
                        type="button"
                        onClick={() =>
                          setMilestoneDraft(milestoneDraftFor(goal.id))
                        }
                        disabled={isBusy}
                      >
                        <Plus size={15} /> Add milestone
                      </button>
                    )}
                  </div>
                  {goal.status !== "active" && (
                    <p className="closed-record-note">
                      Reopen this goal before changing its milestones.
                    </p>
                  )}
                  {goal.milestones.length === 0 && !editingMilestoneForGoal ? (
                    <p className="milestone-empty">
                      No milestones yet. Add only a checkpoint you will review
                      deliberately.
                    </p>
                  ) : (
                    <div className="milestone-list">
                      {goal.milestones.map((milestone) => (
                        <article
                          key={milestone.id}
                          className={`milestone-row status-${milestone.status}`}
                        >
                          <button
                            className={`milestone-toggle ${
                              milestone.status === "completed"
                                ? "completed"
                                : ""
                            }`}
                            type="button"
                            aria-label={
                              milestone.status === "completed"
                                ? `Reopen milestone ${milestone.title}`
                                : `Complete milestone ${milestone.title}`
                            }
                            onClick={() =>
                              toggleMilestone.mutate({
                                goalId: goal.id,
                                milestone,
                              })
                            }
                            disabled={!isOpen || isBusy}
                          >
                            <Check size={14} />
                          </button>
                          <div>
                            <strong>{milestone.title}</strong>
                            <small>
                              {compactDate(milestone.targetDate)
                                ? `Target ${compactDate(milestone.targetDate)}`
                                : "No target date"}
                            </small>
                          </div>
                          {isOpen && (
                            <div className="record-row-actions">
                              <button
                                className="icon-button"
                                type="button"
                                aria-label={`Edit milestone ${milestone.title}`}
                                onClick={() =>
                                  setMilestoneDraft(
                                    milestoneDraftFor(goal.id, milestone),
                                  )
                                }
                                disabled={isBusy}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                className="icon-button destructive-button"
                                type="button"
                                aria-label={`Delete milestone ${milestone.title}`}
                                onClick={() =>
                                  confirmDeleteMilestone(goal.id, milestone)
                                }
                                disabled={isBusy}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}

                  {editingMilestoneForGoal && (
                    <form
                      className="milestone-editor"
                      onSubmit={submitMilestone}
                    >
                      <label>
                        Milestone title
                        <input
                          autoFocus
                          value={editingMilestoneForGoal.title}
                          onChange={(event) =>
                            setMilestoneDraft((current) =>
                              current
                                ? { ...current, title: event.target.value }
                                : current,
                            )
                          }
                          maxLength={200}
                          placeholder="Describe a reviewable checkpoint"
                          required
                        />
                      </label>
                      <label>
                        Target date{" "}
                        <span className="field-optional">optional</span>
                        <input
                          type="date"
                          value={editingMilestoneForGoal.targetDate}
                          onChange={(event) =>
                            setMilestoneDraft((current) =>
                              current
                                ? { ...current, targetDate: event.target.value }
                                : current,
                            )
                          }
                        />
                      </label>
                      <div className="milestone-editor-actions">
                        <button
                          className="button button-quiet button-small"
                          type="button"
                          onClick={() => setMilestoneDraft(null)}
                          disabled={isBusy}
                        >
                          <X size={15} /> Cancel
                        </button>
                        <button
                          className="button button-primary button-small"
                          type="submit"
                          disabled={
                            !editingMilestoneForGoal.title.trim() || isBusy
                          }
                        >
                          <Save size={15} />
                          {saveMilestone.isPending
                            ? "Saving…"
                            : "Save milestone"}
                        </button>
                      </div>
                    </form>
                  )}
                </section>

                {goal.status === "archived" && (
                  <p className="goal-archive-note">
                    <Archive size={14} /> Archived goals retain their task links
                    for context until you explicitly clear or remove them.
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}

      <section className="goals-disclosure">
        <ListChecks size={17} />
        <p>
          Goal and project records are user-owned local data. Linked task
          completion and milestone state are counted as stored facts; neither
          record type automatically changes task priority, plan order, or past
          accepted schedules.
        </p>
        <ChevronRight size={16} aria-hidden="true" />
      </section>
    </div>
  );
}
