import { expect, test, type Page } from "@playwright/test";

/**
 * 責務: script textarea で登録した target-driven animator が、button#0 でフェード目標を往復できることを UI で検証する。
 */

const TOGGLE_FADE_SCRIPT = `ref led = pwm#0
ref button = button#0

var led_level = 0%
var led_target = 0%
var next_target = "on"

animator fade = ramp over 1200ms ease ease_in_out

task toggle on button.pressed {
  match next_target {
    "on" => {
      set led_target = 100%
      set next_target = "off"
    }
    "off" => {
      set led_target = 0%
      set next_target = "on"
    }
    else => { set next_target = "on" }
  }
}

task apply every 16ms {
  set led_level = step fade with led_target dt
  do led.level(led_level)
}
`;

async function readDisplayedPwmPercent(page: Page): Promise<number> {
  const rawText = await page.getByTestId("simulator-pwm-level-text").innerText();
  const digitsOnlyText = rawText.replace(/[^0-9-]/g, "");
  return Number.parseInt(digitsOnlyText, 10);
}

/**
 * target-driven animator: 1 回目の Press で pwm が 0 から上がり、2 回目の Press で前回より下がる（タイミング非依存の poll）。
 */
test("button press toggles pwm fade target up then down", async ({ page }) => {
  await page.goto("/");

  const levelLocator = page.getByTestId("simulator-pwm-level-text");
  await expect(levelLocator).toHaveText("0%");

  await page.getByTestId("script-runner-textarea").fill(TOGGLE_FADE_SCRIPT);
  await page.getByTestId("script-runner-submit-button").click();

  await page.getByTestId("simulator-button0-press").click();

  await expect.poll(async () => readDisplayedPwmPercent(page), { timeout: 15000 }).toBeGreaterThan(0);

  const peakPercent = await readDisplayedPwmPercent(page);

  await page.getByTestId("simulator-button0-press").click();

  await expect.poll(async () => readDisplayedPwmPercent(page), { timeout: 15000 }).toBeLessThan(peakPercent);
});
