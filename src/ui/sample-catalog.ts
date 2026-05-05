/**
 * 責務: `examples/pico-runtime-samples` のマニフェストと Vite でバンドルした `.sc` 本文を突き合わせ、シミュレータが使う Sample Catalog を供給する。
 */

import pico_runtime_samples_manifest from "../../examples/pico-runtime-samples/samples.json";
import button_mode_dashboard_sc_raw_text from "../../examples/pico-runtime-samples/button-mode-dashboard.sc?raw";
import button_led_toggle_sc_raw_text from "../../examples/pico-runtime-samples/button-led-toggle.sc?raw";
import circle_sweep_sc_raw_text from "../../examples/pico-runtime-samples/circle-sweep.sc?raw";
import countdown_marquee_sc_raw_text from "../../examples/pico-runtime-samples/countdown-marquee.sc?raw";
import growing_circle_sc_raw_text from "../../examples/pico-runtime-samples/growing-circle.sc?raw";
import led_heartbeat_sc_raw_text from "../../examples/pico-runtime-samples/led-heartbeat.sc?raw";
import looped_pulse_train_sc_raw_text from "../../examples/pico-runtime-samples/looped-pulse-train.sc?raw";
import pwm_servo_light_show_sc_raw_text from "../../examples/pico-runtime-samples/pwm-servo-light-show.sc?raw";
import rover_scan_sweep_sc_raw_text from "../../examples/pico-runtime-samples/rover-scan-sweep.sc?raw";
import sensor_alert_dashboard_sc_raw_text from "../../examples/pico-runtime-samples/sensor-alert-dashboard.sc?raw";
import serial_heartbeat_log_sc_raw_text from "../../examples/pico-runtime-samples/serial-heartbeat-log.sc?raw";
import string_command_router_sc_raw_text from "../../examples/pico-runtime-samples/string-command-router.sc?raw";
import two_circle_chase_sc_raw_text from "../../examples/pico-runtime-samples/two-circle-chase.sc?raw";
import waited_status_beacon_sc_raw_text from "../../examples/pico-runtime-samples/waited-status-beacon.sc?raw";

export type SampleCatalogEntry = {
  readonly sampleName: string;
  readonly sourceFileName: string;
  readonly sourceText: string;
  readonly traceVarNames: readonly string[];
};

type SampleManifestRow = {
  readonly name: string;
  readonly sourceFile: string;
  readonly traceVars: readonly string[];
};

type SampleManifestJson = {
  readonly samples: readonly SampleManifestRow[];
};

const SOURCE_TEXT_BY_SOURCE_FILE_NAME: Readonly<Record<string, string>> = {
  "button-mode-dashboard.sc": button_mode_dashboard_sc_raw_text,
  "button-led-toggle.sc": button_led_toggle_sc_raw_text,
  "circle-sweep.sc": circle_sweep_sc_raw_text,
  "countdown-marquee.sc": countdown_marquee_sc_raw_text,
  "growing-circle.sc": growing_circle_sc_raw_text,
  "led-heartbeat.sc": led_heartbeat_sc_raw_text,
  "looped-pulse-train.sc": looped_pulse_train_sc_raw_text,
  "pwm-servo-light-show.sc": pwm_servo_light_show_sc_raw_text,
  "rover-scan-sweep.sc": rover_scan_sweep_sc_raw_text,
  "sensor-alert-dashboard.sc": sensor_alert_dashboard_sc_raw_text,
  "serial-heartbeat-log.sc": serial_heartbeat_log_sc_raw_text,
  "string-command-router.sc": string_command_router_sc_raw_text,
  "two-circle-chase.sc": two_circle_chase_sc_raw_text,
  "waited-status-beacon.sc": waited_status_beacon_sc_raw_text,
};

function normalize_line_endings_to_lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function resolve_source_text_for_manifest_row_or_throw(params: {
  readonly source_file_name: string;
}): string {
  const raw_text = SOURCE_TEXT_BY_SOURCE_FILE_NAME[params.source_file_name];
  if (raw_text === undefined) {
    throw new Error(
      `Sample catalog: no bundled source text for sourceFile "${params.source_file_name}". Add a ?raw import and map it in SOURCE_TEXT_BY_SOURCE_FILE_NAME.`,
    );
  }
  const normalized_text = normalize_line_endings_to_lf(raw_text);
  if (normalized_text.trim().length === 0) {
    throw new Error(`Sample catalog: bundled source text is empty for "${params.source_file_name}".`);
  }
  return normalized_text;
}

function build_sample_catalog_entries_from_manifest_or_throw(
  manifest: SampleManifestJson,
): readonly SampleCatalogEntry[] {
  const entries: SampleCatalogEntry[] = [];
  for (const row of manifest.samples) {
    const source_text = resolve_source_text_for_manifest_row_or_throw({
      source_file_name: row.sourceFile,
    });
    entries.push({
      sampleName: row.name,
      sourceFileName: row.sourceFile,
      sourceText: source_text,
      traceVarNames: [...row.traceVars],
    });
  }
  return entries;
}

const parsed_manifest = pico_runtime_samples_manifest as SampleManifestJson;

/**
 * リポジトリの `examples/pico-runtime-samples/samples.json` と同一順序のカタログ。
 */
export const PICO_RUNTIME_SAMPLE_CATALOG_ENTRIES: readonly SampleCatalogEntry[] =
  build_sample_catalog_entries_from_manifest_or_throw(parsed_manifest);
