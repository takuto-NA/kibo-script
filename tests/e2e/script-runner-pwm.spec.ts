import { expect, test } from "@playwright/test";

const FADE_SCRIPT = `ref led = pwm#0
state led_level = 0%
animator fade_in = ramp from 0% to 100% over 800ms ease linear

task fade every 100ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
`;

/**
 * ブラウザで PWM フェード script を走らせ、表示上のレベルが 0% から変化することを確認する。
 */
test("compile fade script and pwm#0 level display changes from 0%", async ({ page }) => {
  await page.goto("/");

  const levelText = page.getByTestId("simulator-pwm-level-text");
  await expect(levelText).toHaveText("0%");

  await page.getByTestId("script-runner-textarea").fill(FADE_SCRIPT);
  await page.getByTestId("script-runner-submit-button").click();

  await expect(levelText).not.toHaveText("0%", { timeout: 15000 });
});
