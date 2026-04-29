import { expect, test } from "@playwright/test";

/**
 * ブラウザで script runner が compile でき、tick と連動して LED UI が変わることを最小確認する。
 */
test("default blink script compile toggles LED lamp within several ticks", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("script-runner-submit-button").click();

  const ledLamp = page.getByTestId("simulator-led-lamp");
  await expect(ledLamp).toHaveAttribute("aria-label", "LED on", { timeout: 8000 });
});
