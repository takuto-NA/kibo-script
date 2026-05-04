import { expect, test } from "@playwright/test";

test("help panel keeps CLI collapsed until expanded", async ({ page }) => {
  await page.goto("/");

  const outer_help_details = page.getByTestId("script-runner-help-details");
  const cli_details = page.getByTestId("script-runner-help-cli-details");

  await expect(outer_help_details).not.toHaveAttribute("open");
  await expect(cli_details).not.toHaveAttribute("open");

  await outer_help_details.locator("summary").click();
  await expect(outer_help_details).toHaveAttribute("open", "");
  await expect(page.getByText("docs/runtime-pico-handoff.md")).toBeVisible();

  await cli_details.locator("summary").click();
  await expect(cli_details).toHaveAttribute("open", "");
  await expect(page.getByText("pico_link_doctor.py", { exact: false })).toBeVisible();
});
