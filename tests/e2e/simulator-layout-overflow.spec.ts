import { expect, test, type Page } from "@playwright/test";

/**
 * 責務: シミュレータUIの主要パネルが代表的な画面幅で横にはみ出さないことを固定する。
 */

const DESKTOP_VIEWPORT_WIDTH_CSS_PIXELS = 1366;
const DESKTOP_VIEWPORT_HEIGHT_CSS_PIXELS = 768;
const NARROW_VIEWPORT_WIDTH_CSS_PIXELS = 390;
const NARROW_VIEWPORT_HEIGHT_CSS_PIXELS = 844;
const ALLOWED_LAYOUT_ROUNDING_ERROR_CSS_PIXELS = 2;

async function expect_page_to_have_no_horizontal_document_overflow(page: Page): Promise<void> {
  const overflow_pixels = await page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  expect(overflow_pixels).toBeLessThanOrEqual(ALLOWED_LAYOUT_ROUNDING_ERROR_CSS_PIXELS);
}

async function expect_visible_elements_to_fit_viewport_width(page: Page): Promise<void> {
  const overflowing_elements = await page.evaluate((allowed_rounding_error_css_pixels) => {
    const viewport_width = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return false;
        }
        return rect.right > viewport_width + allowed_rounding_error_css_pixels || rect.left < -allowed_rounding_error_css_pixels;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tagName: element.tagName.toLowerCase(),
          className: element.className,
          testId: element.getAttribute("data-testid"),
          left: rect.left,
          right: rect.right,
          viewportWidth: viewport_width,
        };
      });
  }, ALLOWED_LAYOUT_ROUNDING_ERROR_CSS_PIXELS);

  expect(overflowing_elements).toEqual([]);
}

test("simulator layout does not overflow horizontally on desktop", async ({ page }) => {
  await page.setViewportSize({
    width: DESKTOP_VIEWPORT_WIDTH_CSS_PIXELS,
    height: DESKTOP_VIEWPORT_HEIGHT_CSS_PIXELS,
  });
  await page.goto("/");

  await page.getByTestId("script-runner-help-details").locator("summary").click();
  await page.getByTestId("script-runner-help-cli-details").locator("summary").click();

  await expect_page_to_have_no_horizontal_document_overflow(page);
  await expect_visible_elements_to_fit_viewport_width(page);
});

test("simulator layout does not overflow horizontally on narrow viewport", async ({ page }) => {
  await page.setViewportSize({
    width: NARROW_VIEWPORT_WIDTH_CSS_PIXELS,
    height: NARROW_VIEWPORT_HEIGHT_CSS_PIXELS,
  });
  await page.goto("/");

  await page.getByTestId("script-runner-help-details").locator("summary").click();
  await page.getByTestId("script-runner-help-cli-details").locator("summary").click();

  await expect_page_to_have_no_horizontal_document_overflow(page);
  await expect_visible_elements_to_fit_viewport_width(page);
});
