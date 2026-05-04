/**
 * 責務: ターミナル出力の下端付近判定と Jump ボタン表示条件を数値で固定する。
 */

import { describe, expect, it } from "vitest";
import {
  TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
  is_scroll_position_within_bottom_threshold_for_terminal_output,
  should_show_jump_to_latest_button_for_terminal_output,
} from "../../src/ui/terminal-scroll-behavior";

describe("terminal scroll behavior", () => {
  it("treats scroll position within threshold pixels of bottom as near-bottom", () => {
    const near_bottom = is_scroll_position_within_bottom_threshold_for_terminal_output({
      scroll_metrics: {
        scrollTopPixels: 952,
        clientHeightPixels: 200,
        scrollHeightPixels: 1200,
      },
      bottom_threshold_pixels: TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
    });
    expect(near_bottom).toBe(true);
  });

  it("treats scroll position above threshold as not near-bottom", () => {
    const near_bottom = is_scroll_position_within_bottom_threshold_for_terminal_output({
      scroll_metrics: {
        scrollTopPixels: 0,
        clientHeightPixels: 200,
        scrollHeightPixels: 1200,
      },
      bottom_threshold_pixels: TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
    });
    expect(near_bottom).toBe(false);
  });

  it("hides jump when there is no overflow", () => {
    const should_show = should_show_jump_to_latest_button_for_terminal_output({
      scroll_metrics: {
        scrollTopPixels: 0,
        clientHeightPixels: 200,
        scrollHeightPixels: 200,
      },
      bottom_threshold_pixels: TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
    });
    expect(should_show).toBe(false);
  });

  it("shows jump when there is overflow and viewport is not near bottom", () => {
    const should_show = should_show_jump_to_latest_button_for_terminal_output({
      scroll_metrics: {
        scrollTopPixels: 0,
        clientHeightPixels: 200,
        scrollHeightPixels: 1200,
      },
      bottom_threshold_pixels: TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
    });
    expect(should_show).toBe(true);
  });

  it("hides jump when there is overflow but viewport is near bottom", () => {
    const should_show = should_show_jump_to_latest_button_for_terminal_output({
      scroll_metrics: {
        scrollTopPixels: 952,
        clientHeightPixels: 200,
        scrollHeightPixels: 1200,
      },
      bottom_threshold_pixels: TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
    });
    expect(should_show).toBe(false);
  });
});
