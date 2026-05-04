import { expect, test } from "@playwright/test";

const SERIAL_PRINTLN_LINE_COUNT_FOR_TERMINAL_SCROLL_TEST = 22;
const TERMINAL_SCROLL_E2E_TEST_TIMEOUT_MILLISECONDS = 120_000;
const TERMINAL_SCROLL_E2E_VIEWPORT_WIDTH_CSS_PIXELS = 900;
const TERMINAL_SCROLL_E2E_VIEWPORT_HEIGHT_CSS_PIXELS = 520;

test("terminal keeps scroll position when scrolled up and new output arrives; Jump to latest restores bottom", async ({
  page,
}) => {
  test.setTimeout(TERMINAL_SCROLL_E2E_TEST_TIMEOUT_MILLISECONDS);
  await page.setViewportSize({
    width: TERMINAL_SCROLL_E2E_VIEWPORT_WIDTH_CSS_PIXELS,
    height: TERMINAL_SCROLL_E2E_VIEWPORT_HEIGHT_CSS_PIXELS,
  });
  await page.goto("/");

  const terminal_input = page.getByLabel("Simulator command line");
  const terminal_output = page.getByTestId("terminal-output");
  const jump_button = page.getByTestId("terminal-jump-to-latest-button");

  await terminal_input.click();

  for (let line_index = 0; line_index < SERIAL_PRINTLN_LINE_COUNT_FOR_TERMINAL_SCROLL_TEST; line_index += 1) {
    await terminal_input.fill(`do serial#0.println("scroll-test-${line_index}")`);
    await terminal_input.press("Enter");
  }

  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="terminal-output"]');
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      return element.scrollHeight > element.clientHeight;
    },
    undefined,
    { timeout: 8000 },
  );

  await terminal_output.evaluate((element) => {
    element.scrollTop = 0;
  });

  await terminal_input.fill(`do serial#0.println("after-scroll-up")`);
  await terminal_input.press("Enter");

  const scroll_top_after_new_output = await terminal_output.evaluate((element) => element.scrollTop);
  expect(scroll_top_after_new_output).toBeLessThan(20);

  await expect(jump_button).toBeVisible();

  await jump_button.click();

  const scroll_top_after_jump = await terminal_output.evaluate((element) => element.scrollTop);
  const max_scroll_top = await terminal_output.evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  );
  expect(scroll_top_after_jump).toBeGreaterThan(max_scroll_top - 8);
});
