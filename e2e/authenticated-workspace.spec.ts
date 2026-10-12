import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = "a-strong-e2e-passphrase";

function accountSuffix(testInfo: TestInfo): string {
  return `${Date.now()}-${testInfo.workerIndex}-${testInfo.retry}`;
}

function desktopNavigation(page: Page) {
  return page.locator(".desktop-nav");
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function register(page: Page, testInfo: TestInfo): Promise<void> {
  const suffix = accountSuffix(testInfo);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Focus, safely yours." }),
  ).toBeVisible();

  await page.getByLabel("Your name").fill(`E2E Person ${suffix}`);
  await page.getByLabel("Email address").fill(`e2e-${suffix}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create private workspace" }).click();

  await expect(
    page.getByRole("heading", { name: /Find the next clear move/ }),
  ).toBeVisible();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function browserApi(
  page: Page,
  path: string,
  method: "GET" | "PATCH" | "POST",
  payload?: unknown,
) {
  return page.evaluate(
    async ({ path, method, payload }) => {
      const csrf = document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("focusai_csrf="))
        ?.split("=")
        .slice(1)
        .join("=");
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: "include",
        headers: {
          accept: "application/json",
          ...(payload ? { "content-type": "application/json" } : {}),
          ...(csrf && method !== "GET" ? { "x-csrf-token": csrf } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      return {
        status: response.status,
        payload: await response.json(),
      };
    },
    { path, method, payload },
  );
}

test.describe("authenticated workspace browser flows", () => {
  test("renders an accessible account-creation experience", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Focus, safely yours." }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("offers an explicit, non-punitive recovery choice after planned time has passed", async ({
    page,
  }, testInfo) => {
    test.slow();
    await register(page, testInfo);

    const taskTitle = `E2E recovery task ${accountSuffix(testInfo)}`;
    const captureTrigger = page.getByRole("button", {
      name: "Capture a task",
    });
    await captureTrigger.click();
    const captureDialog = page.getByRole("dialog", {
      name: "Make space in your mind.",
    });
    await captureDialog
      .getByLabel("What needs your attention?")
      .fill(taskTitle);
    await captureDialog.getByLabel("Estimate (minutes)").fill("5");
    await captureDialog.getByRole("button", { name: "Capture task" }).click();
    await expect(captureDialog).toBeHidden();

    const preferences = await browserApi(page, "/preferences", "PATCH", {
      timezone: "UTC",
      transitionMinutes: 0,
    });
    expect(preferences.status).toBe(200);
    const tasks = (await browserApi(page, "/tasks", "GET")) as {
      status: number;
      payload: { items: Array<{ id: string; title: string }> };
    };
    expect(tasks.status).toBe(200);
    const task = tasks.payload.items.find((item) => item.title === taskTitle);
    expect(task).toBeTruthy();
    if (!task) throw new Error("Expected the captured recovery task.");

    const referenceTime = Date.now();
    const planDate = new Date(referenceTime).toISOString().slice(0, 10);
    const generatedPlan = await browserApi(page, "/plans/generate", "POST", {
      planDate,
      readiness: "steady",
      now: new Date(referenceTime - 25 * 60_000).toISOString(),
      availability: [
        {
          startAt: new Date(referenceTime - 20 * 60_000).toISOString(),
          endAt: new Date(referenceTime - 5 * 60_000).toISOString(),
        },
      ],
    });
    expect(generatedPlan.status).toBe(201);

    await page.goto("/");
    const recoverySignal = page.locator(".recovery-signal");
    await expect(recoverySignal).toBeVisible();
    await expect(recoverySignal).toContainText(taskTitle);
    await expect(recoverySignal).toContainText(
      "Nothing was marked as failed or moved automatically.",
    );
    await expect(
      page.getByRole("progressbar", { name: "Task completion progress" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await expectNoAxeViolations(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.locator("html").evaluate((element) => {
          return element.scrollWidth <= element.clientWidth;
        }),
      )
      .toBe(true);
    await expect(recoverySignal).toBeVisible();
    await recoverySignal
      .getByRole("link", { name: "Review remaining day" })
      .click();
    await expect(page).toHaveURL(/\/plan\?[^#]*recovery=1/);
    await expect(
      page.getByText("Pause and re-plan, without a penalty."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create recovery draft" }),
    ).toBeVisible();
  });

  test("plans around a protected commitment, saves an explicit draft adjustment, and records focus", async ({
    page,
  }, testInfo) => {
    test.slow();
    await register(page, testInfo);

    const planningDate = addUtcDays(new Date().toISOString().slice(0, 10), 2);
    const commitmentTitle = `E2E protected time ${accountSuffix(testInfo)}`;
    const taskTitle = `E2E planned focus task ${accountSuffix(testInfo)}`;

    await desktopNavigation(page)
      .getByRole("link", { name: "Schedule & capacity" })
      .click();
    await expect(
      page.getByRole("heading", { name: /Protect the time/ }),
    ).toBeVisible();

    await page.getByLabel("Time zone").fill("UTC");
    await page.getByLabel("Workday starts").fill("09:00");
    await page.getByLabel("Workday ends").fill("11:00");
    await page.getByLabel("Transition buffer").fill("0");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(
      page.getByText(
        "Planning preferences saved. New plans will use this schedule.",
      ),
    ).toBeVisible();

    const commitmentForm = page.locator(".commitment-form");
    await commitmentForm
      .getByLabel("What is this time for?")
      .fill(commitmentTitle);
    await commitmentForm
      .getByLabel("Starts in UTC")
      .fill(`${planningDate}T09:30`);
    await commitmentForm
      .getByLabel("Ends in UTC")
      .fill(`${planningDate}T10:00`);
    await commitmentForm
      .getByRole("button", { name: "Add commitment" })
      .click();
    await expect(
      page.getByText(
        "Commitment saved. Fixed time is now protected in future plan drafts.",
      ),
    ).toBeVisible();
    const commitmentItem = page.locator(".commitment-item").filter({
      has: page.getByRole("heading", { name: commitmentTitle, exact: true }),
    });
    await expect(commitmentItem).toContainText("Protected");
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Capture a task" }).click();
    const captureDialog = page.getByRole("dialog", {
      name: "Make space in your mind.",
    });
    await captureDialog
      .getByLabel("What needs your attention?")
      .fill(taskTitle);
    await captureDialog.getByLabel("Estimate (minutes)").fill("30");
    await captureDialog.getByRole("button", { name: "Capture task" }).click();
    await expect(captureDialog).toBeHidden();

    await desktopNavigation(page)
      .getByRole("link", { name: "Planning studio" })
      .click();
    await expect(
      page.getByRole("heading", { name: /Make a day that can/ }),
    ).toBeVisible();
    await page.getByLabel("Planning date").fill(planningDate);
    await page.getByRole("button", { name: "Generate plan" }).click();
    await expect(page.getByText("SCHEDULE DRAFT")).toBeVisible();
    const capacityCard = page.locator(".plan-capacity-card");
    await expect(capacityCard).toContainText("30m");
    await expect(capacityCard).toContainText("of 1h 30m available");
    await expect(page.getByRole("heading", { name: taskTitle })).toBeVisible();

    await page.getByRole("button", { name: "Edit schedule" }).click();
    const draftStart = page.getByLabel("Starts in UTC");
    await expect(draftStart).toHaveValue(`${planningDate}T09:00`);
    await draftStart.fill(`${planningDate}T10:00`);
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(
      page.getByText(
        "Your reviewed schedule changes were saved. Feasibility was checked again before anything moved.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("This draft includes saved manual schedule adjustments."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Approve plan" }).click();
    await expect(page.getByText("APPROVED PLAN")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit schedule" }),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);

    await desktopNavigation(page)
      .getByRole("link", { name: "Focus studio" })
      .click();
    await expect(
      page.getByRole("heading", { name: /One thing/ }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: /Linked task/ })
      .selectOption({ label: `${taskTitle} · 30m` });
    await page.getByLabel("Focus minutes").fill("5");
    await page
      .getByLabel(/A small intention/)
      .fill("Draft the opening without forcing the whole task.");
    await page.getByRole("button", { name: "Start focus" }).click();
    const activeStage = page.locator(".focus-stage-active");
    await expect(activeStage).toContainText(taskTitle);
    await expect(
      activeStage.getByRole("button", { name: "Pause" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("SESSION HELD")).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("SESSION IN PROGRESS")).toBeVisible();
    await page.getByRole("button", { name: "Record complete" }).click();
    await expect(
      page.getByText(
        "Session recorded. Complete the linked task separately only if the work itself is finished.",
      ),
    ).toBeVisible();
    const historyRow = page.locator(".session-history-row").filter({
      hasText: taskTitle,
    });
    await expect(historyRow).toContainText("completed");
    await expectNoAxeViolations(page);

    await desktopNavigation(page)
      .getByRole("link", { name: "Task workspace" })
      .click();
    const taskRow = page.locator(".task-row").filter({
      has: page.getByRole("heading", { name: taskTitle, exact: true }),
    });
    await expect(
      taskRow.getByRole("button", { name: `Mark ${taskTitle} complete` }),
    ).toBeVisible();
  });

  test("keeps daylight-saving calendar input explicit in a non-UTC planning zone", async ({
    page,
  }, testInfo) => {
    await register(page, testInfo);

    await desktopNavigation(page)
      .getByRole("link", { name: "Schedule & capacity" })
      .click();
    await page.getByLabel("Time zone").fill("America/New_York");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(
      page.getByText(
        "Planning preferences saved. New plans will use this schedule.",
      ),
    ).toBeVisible();

    const commitmentForm = page.locator(".commitment-form");
    await commitmentForm
      .getByLabel("What is this time for?")
      .fill("DST transition check");
    await commitmentForm
      .getByLabel("Starts in America/New_York")
      .fill("2026-03-08T02:30");
    await commitmentForm
      .getByLabel("Ends in America/New_York")
      .fill("2026-03-08T03:30");
    await commitmentForm
      .getByRole("button", { name: "Add commitment" })
      .click();
    const daylightSavingError = page.getByRole("alert");
    await expect(daylightSavingError).toContainText(
      "That local time is unavailable or ambiguous in the selected time zone.",
    );

    await commitmentForm
      .getByLabel("Starts in America/New_York")
      .fill("2026-11-01T01:30");
    await commitmentForm
      .getByLabel("Ends in America/New_York")
      .fill("2026-11-01T02:30");
    await commitmentForm
      .getByRole("button", { name: "Add commitment" })
      .click();
    await expect(daylightSavingError).toContainText(
      "That local time is unavailable or ambiguous in the selected time zone.",
    );
    await expect(
      page.getByText("DST transition check", { exact: true }),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("supports keyboard navigation and an explicit project-to-goal task flow", async ({
    page,
  }, testInfo) => {
    test.slow();
    await register(page, testInfo);

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", {
      name: "Skip to workspace content",
    });
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    const projectTitle = `E2E Project ${accountSuffix(testInfo)}`;
    const goalTitle = `E2E Goal ${accountSuffix(testInfo)}`;
    const milestoneTitle = `E2E Milestone ${accountSuffix(testInfo)}`;
    const taskTitle = `E2E Task ${accountSuffix(testInfo)}`;

    await desktopNavigation(page)
      .getByRole("link", { name: "Goals & milestones" })
      .click();
    await expect(
      page.getByRole("heading", { name: /Make the direction/ }),
    ).toBeVisible();

    const projectForm = page.locator(".project-form-card");
    await projectForm.getByLabel("Project title").fill(projectTitle);
    await projectForm.getByRole("button", { name: "Add project" }).click();
    await expect(
      page.getByText(
        "Project created. Add goals only when they are meaningful.",
      ),
    ).toBeVisible();

    const goalForm = page.locator(".goal-form-card");
    const projectSelect = goalForm.getByRole("combobox", { name: /Project/ });
    await expect(projectSelect).toContainText(projectTitle);
    await projectSelect.selectOption({ label: projectTitle });
    await goalForm.getByLabel("Goal title").fill(goalTitle);
    await goalForm.getByRole("button", { name: "Create goal" }).click();
    await expect(
      page.getByText(
        "Goal created. Link tasks deliberately from the task editor.",
      ),
    ).toBeVisible();

    const goalCard = page.locator(".goal-card").filter({
      has: page.getByRole("heading", { name: goalTitle, exact: true }),
    });
    await expect(goalCard).toBeVisible();
    await goalCard.getByRole("button", { name: "Add milestone" }).click();
    await goalCard.getByLabel("Milestone title").fill(milestoneTitle);
    await goalCard.getByRole("button", { name: "Save milestone" }).click();
    await expect(goalCard.getByText(milestoneTitle)).toBeVisible();

    await desktopNavigation(page)
      .getByRole("link", { name: "Task workspace" })
      .click();
    await expect(
      page.getByRole("heading", { name: /Keep the work visible/ }),
    ).toBeVisible();
    const taskCaptureTrigger = page.getByRole("button", {
      name: "Capture task",
    });
    await taskCaptureTrigger.click();

    const captureDialog = page.getByRole("dialog", {
      name: "Make space in your mind.",
    });
    await captureDialog
      .getByLabel("What needs your attention?")
      .fill(taskTitle);
    await captureDialog.getByRole("button", { name: "Capture task" }).click();
    await expect(captureDialog).toBeHidden();
    await expect(taskCaptureTrigger).toBeFocused();

    const taskRow = page.locator(".task-row").filter({
      has: page.getByRole("heading", { name: taskTitle, exact: true }),
    });
    await expect(taskRow).toBeVisible();
    const taskEditTrigger = taskRow.getByRole("button", {
      name: `Edit ${taskTitle}`,
    });
    await taskEditTrigger.click();

    const editorDialog = page.getByRole("dialog", {
      name: "Shape the work deliberately.",
    });
    await expect(editorDialog.getByLabel("Task title")).toBeFocused();
    await editorDialog
      .getByRole("combobox", { name: /^Goal/ })
      .selectOption({ label: goalTitle });
    await editorDialog.getByLabel("Goal alignment (0–1)").fill("0.7");
    await editorDialog.getByRole("button", { name: "Save task" }).click();
    await expect(editorDialog).toBeHidden();
    await expect(taskEditTrigger).toBeFocused();
    await expect(taskRow.getByTitle(goalTitle)).toBeVisible();

    await taskRow.getByRole("button", { name: `Edit ${taskTitle}` }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Shape the work deliberately." })
        .getByLabel("Goal alignment (0–1)"),
    ).toHaveValue("0.7");
    await page
      .getByRole("dialog", { name: "Shape the work deliberately." })
      .getByRole("button", { name: "Cancel" })
      .click();

    await desktopNavigation(page)
      .getByRole("link", { name: "Goals & milestones" })
      .click();
    await expect(goalCard).toBeVisible();
    await goalCard.getByRole("button", { name: "Complete goal" }).click();
    await expect(page.getByRole("alert")).toContainText("Finish or unlink");

    await goalCard.getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks\?goalId=/);
    await expect(page.getByText("LINKED GOAL WORK")).toBeVisible();
    await taskRow
      .getByRole("button", { name: `Mark ${taskTitle} complete` })
      .click();
    await expect(
      taskRow.getByRole("button", { name: `${taskTitle} is complete` }),
    ).toBeVisible();

    await desktopNavigation(page)
      .getByRole("link", { name: "Goals & milestones" })
      .click();
    await expect(goalCard).toBeVisible();
    await goalCard.getByRole("button", { name: "Complete goal" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Complete or remove milestone",
    );

    await goalCard
      .getByRole("button", { name: `Complete milestone ${milestoneTitle}` })
      .click();
    await goalCard.getByRole("button", { name: "Complete goal" }).click();
    await expect(
      page.getByText("Goal completed with its recorded tasks and milestones."),
    ).toBeVisible();
    await expect(goalCard).toContainText("100%");

    await expectNoAxeViolations(page);
  });
});
