import { expect, test } from "@playwright/test";

/**
 * script runner に `task on button#0.pressed` を登録し、UI の button#0 を押して LED が変わることを確認する。
 */
test("button#0 press dispatches event and updates LED from compiled task", async ({ page }) => {
  await page.goto("/");

  const script = `ref led = led#0

task on_press on button#0.pressed {
  do led.toggle()
}
`;
  await page.getByTestId("script-runner-textarea").fill(script);
  await page.getByTestId("script-runner-submit-button").click();

  const ledLamp = page.getByTestId("simulator-led-lamp");
  await expect(ledLamp).toHaveAttribute("aria-label", "LED off", { timeout: 8000 });

  await page.getByTestId("simulator-button0-press").click();

  await expect(ledLamp).toHaveAttribute("aria-label", "LED on", { timeout: 5000 });
});

test("button#4 press dispatches event and updates LED from compiled task", async ({ page }) => {
  await page.goto("/");

  const script = `ref led = led#0

task on_press on button#4.pressed {
  do led.toggle()
}
`;
  await page.getByTestId("script-runner-textarea").fill(script);
  await page.getByTestId("script-runner-submit-button").click();

  const ledLamp = page.getByTestId("simulator-led-lamp");
  await expect(ledLamp).toHaveAttribute("aria-label", "LED off", { timeout: 8000 });

  await page.getByTestId("simulator-button4-press").click();

  await expect(ledLamp).toHaveAttribute("aria-label", "LED on", { timeout: 5000 });
});
