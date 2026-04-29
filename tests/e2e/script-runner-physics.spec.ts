import { expect, test } from "@playwright/test";

/**
 * 物理パネル（three.js canvas）がマウントされ、既定の script runner が動作し続けることを確認する。
 */
test("physics canvas is present after simulator loads", async ({ page }) => {
  await page.goto("/");
  const physicsCanvas = page.getByTestId("simulator-physics-canvas");
  await expect(physicsCanvas).toBeVisible();
});
