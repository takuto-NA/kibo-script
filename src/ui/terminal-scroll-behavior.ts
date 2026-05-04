/**
 * 責務: ターミナル出力領域の下端付近判定など、スクロール追従ロジックを DOM から切り離して単体テスト可能にする。
 */

export const TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS = 48;

export type ScrollMetricsForTerminalOutput = {
  readonly scrollTopPixels: number;
  readonly clientHeightPixels: number;
  readonly scrollHeightPixels: number;
};

/**
 * ユーザーが「ログ末尾付近」を見ているとみなす下端からの距離が閾値以内か。
 */
export function is_scroll_position_within_bottom_threshold_for_terminal_output(params: {
  readonly scroll_metrics: ScrollMetricsForTerminalOutput;
  readonly bottom_threshold_pixels: number;
}): boolean {
  const distance_from_bottom_pixels =
    params.scroll_metrics.scrollHeightPixels -
    params.scroll_metrics.scrollTopPixels -
    params.scroll_metrics.clientHeightPixels;
  return distance_from_bottom_pixels <= params.bottom_threshold_pixels;
}

/**
 * 出力領域にスクロールバーが出るほどコンテンツがあるか。
 */
export function does_terminal_output_have_scrollable_overflow(params: {
  readonly scroll_metrics: ScrollMetricsForTerminalOutput;
}): boolean {
  return params.scroll_metrics.scrollHeightPixels > params.scroll_metrics.clientHeightPixels;
}

/**
 * スクロールバーがあり、かつ末尾付近にいないときに「Jump to latest」を出す。
 */
export function should_show_jump_to_latest_button_for_terminal_output(params: {
  readonly scroll_metrics: ScrollMetricsForTerminalOutput;
  readonly bottom_threshold_pixels: number;
}): boolean {
  if (
    !does_terminal_output_have_scrollable_overflow({
      scroll_metrics: params.scroll_metrics,
    })
  ) {
    return false;
  }
  return !is_scroll_position_within_bottom_threshold_for_terminal_output({
    scroll_metrics: params.scroll_metrics,
    bottom_threshold_pixels: params.bottom_threshold_pixels,
  });
}
