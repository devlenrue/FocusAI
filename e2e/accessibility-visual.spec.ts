import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "a-strong-e2e-passphrase";
const desktopViewport = { width: 1440, height: 960 };
const mobileViewport = { width: 390, height: 844 };

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator("html").evaluate((element) => {
        return element.scrollWidth <= element.clientWidth;
      }),
    )
    .toBe(true);
}

async function registerVisualReviewer(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Focus, safely yours." }),
  ).toBeVisible();
  await page.getByLabel("Your name").fill("Visual reviewer");
  await page.getByLabel("Email address").fill("visual-reviewer@example.test");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Find the next clear move/ }),
  ).toBeVisible();
}

async function createVisualGoal(
  page: Page,
): Promise<ReturnType<Page["locator"]>> {
  await page
    .locator(".desktop-nav")
    .getByRole("link", { name: "Goals & milestones" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Make the direction/ }),
  ).toBeVisible();

  const projectForm = page.locator(".project-form-card");
  await projectForm.getByLabel("Project title").fill("Visual review project");
  await projectForm.getByRole("button", { name: "Add project" }).click();

  const goalForm = page.locator(".goal-form-card");
  const projectSelect = goalForm.getByRole("combobox", { name: /Project/ });
  await expect(projectSelect).toContainText("Visual review project");
  await projectSelect.selectOption({ label: "Visual review project" });
  await goalForm.getByLabel("Goal title").fill("Keep the workspace clear");
  await goalForm.getByRole("button", { name: "Create goal" }).click();

  const goalCard = page.locator(".goal-card").filter({
    has: page.getByRole("heading", {
      name: "Keep the workspace clear",
      exact: true,
    }),
  });
  await expect(goalCard).toBeVisible();
  await goalCard.getByRole("button", { name: "Add milestone" }).click();
  await goalCard.getByLabel("Milestone title").fill("Review the first week");
  await goalCard.getByRole("button", { name: "Save milestone" }).click();
  await expect(goalCard.getByText("Review the first week")).toBeVisible();
  return goalCard;
}

test.describe("responsive visual and accessibility review", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test("keeps account access tabs and visual hierarchy keyboard-readable", async ({
    page,
  }) => {
    await page.setViewportSize(desktopViewport);
    await page.goto("/");

    const createAccountTab = page.getByRole("tab", {
      name: "Create account",
    });
    const signInTab = page.getByRole("tab", { name: "Sign in" });
    const accountPanel = page.getByRole("tabpanel");
    await expect(createAccountTab).toHaveAttribute("aria-selected", "true");
    await expect(signInTab).toHaveAttribute("aria-selected", "false");

    const registerPanelId =
      await createAccountTab.getAttribute("aria-controls");
    expect(registerPanelId).not.toBeNull();
    await createAccountTab.press("ArrowRight");
    await expect(signInTab).toBeFocused();
    await expect(signInTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Your name")).toHaveCount(0);
    const signInTabId = await signInTab.getAttribute("id");
    const signInPanelId = await signInTab.getAttribute("aria-controls");
    expect(signInTabId).not.toBeNull();
    expect(signInPanelId).not.toBeNull();
    await expect(accountPanel).toHaveAttribute("id", signInPanelId ?? "");
    await expect(accountPanel).toHaveAttribute(
      "aria-labelledby",
      signInTabId ?? "",
    );

    await signInTab.press("ArrowRight");
    await expect(createAccountTab).toBeFocused();
    await expect(createAccountTab).toHaveAttribute("aria-selected", "true");
    await expect(accountPanel).toHaveAttribute("id", registerPanelId ?? "");
    await createAccountTab.press("End");
    await expect(signInTab).toBeFocused();
    await expect(signInTab).toHaveAttribute("aria-selected", "true");
    await signInTab.press("Home");
    await expect(createAccountTab).toBeFocused();
    await expect(createAccountTab).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot("auth-desktop.png");

    await page.setViewportSize(mobileViewport);
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot("auth-mobile.png");
  });

  test("traps modal focus and preserves populated goals at desktop and mobile", async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize(desktopViewport);
    await registerVisualReviewer(page);

    const captureTrigger = page.getByRole("button", {
      name: "Capture a task",
    });
    await captureTrigger.click();
    const captureDialog = page.getByRole("dialog", {
      name: "Make space in your mind.",
    });
    const closeCapture = captureDialog.getByRole("button", {
      name: "Close quick capture",
    });
    const cancelCapture = captureDialog.getByRole("button", { name: "Cancel" });
    await expect(
      captureDialog.getByLabel("What needs your attention?"),
    ).toBeFocused();
    await closeCapture.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(cancelCapture).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeCapture).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(captureDialog).toBeHidden();
    await expect(captureTrigger).toBeFocused();

    const goalCard = await createVisualGoal(page);
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page).toHaveScreenshot("goals-desktop-top.png");
    await goalCard.scrollIntoViewIfNeeded();
    await expect(goalCard).toHaveScreenshot("goals-card-desktop.png");

    await page.setViewportSize(mobileViewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(
      page.getByRole("navigation", { name: "Mobile primary navigation" }),
    ).toBeVisible();
    await expect(page.locator(".side-rail")).toBeHidden();
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot("goals-mobile-top.png");

    await goalCard.scrollIntoViewIfNeeded();
    await expect(goalCard).toHaveScreenshot("goals-card-mobile.png");
    await expectNoAxeViolations(page);
  });
});
