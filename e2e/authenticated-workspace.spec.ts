import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = "a-strong-e2e-passphrase";

function accountSuffix(testInfo: TestInfo): string {
  return `${Date.now()}-${testInfo.workerIndex}-${testInfo.retry}`;
}

function desktopNavigation(page: Page) {
  return page.locator(".desktop-nav");
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
