#!/usr/bin/env node
// 責務: USB Serial で受信したログから `trace ` 行だけを抽出し、期待 trace ファイルと一致するかを検証する（Pico acceptance の手動/半自動用）。
//
// 使い方（例）:
//   node scripts/pico/runtime_vertical_slice/tools/compare_usb_serial_trace_lines.mjs --capturePort COM11 --captureSeconds 8 --expectedTraceFile tests/runtime-conformance/golden/circle-animation.conformance.trace.txt
//
// 注意:
// - Windows PowerShell では `&&` が使えないことがある。`;` で区切ること。

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function parse_cli_arguments_or_exit(argv) {
  const args = [...argv].slice(2);
  const get_value = (flag_name) => {
    const index = args.indexOf(flag_name);
    if (index === -1) {
      return undefined;
    }
    const value = args[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${flag_name}`);
    }
    return value;
  };

  const capture_port = get_value("--capturePort");
  const capture_seconds_text = get_value("--captureSeconds");
  const expected_trace_file = get_value("--expectedTraceFile");
  const baud_rate_text = get_value("--baudRate") ?? "115200";

  if (capture_port === undefined) {
    throw new Error("Missing required flag: --capturePort");
  }
  if (capture_seconds_text === undefined) {
    throw new Error("Missing required flag: --captureSeconds");
  }
  if (expected_trace_file === undefined) {
    throw new Error("Missing required flag: --expectedTraceFile");
  }

  const capture_seconds = Number.parseInt(capture_seconds_text, 10);
  if (!Number.isFinite(capture_seconds) || capture_seconds <= 0) {
    throw new Error(`Invalid --captureSeconds: ${capture_seconds_text}`);
  }

  const baud_rate = Number.parseInt(baud_rate_text, 10);
  if (!Number.isFinite(baud_rate) || baud_rate <= 0) {
    throw new Error(`Invalid --baudRate: ${baud_rate_text}`);
  }

  return {
    capture_port,
    capture_seconds,
    expected_trace_file,
    baud_rate,
  };
}

function split_non_empty_lines_from_text(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function extract_trace_lines_from_serial_lines(serial_lines) {
  const trace_lines = [];
  for (const line of serial_lines) {
    if (line.startsWith("trace ")) {
      trace_lines.push(line);
    }
  }
  return trace_lines;
}

function load_serialport_constructors_or_exit() {
  try {
    // serialport はこのリポジトリの package.json には未追加のため、実行環境にインストールされている場合のみ動く。
    const { SerialPort } = require("serialport");
    const { ReadlineParser } = require("@serialport/parser-readline");
    return { SerialPort, ReadlineParser };
  } catch {
    // eslint-disable-next-line no-console
    console.error(
      [
        "serialport が見つかりません。次を実行してから再試行してください:",
        "  npm install --save-dev serialport @serialport/parser-readline",
      ].join("\n"),
    );
    process.exit(2);
  }
}

async function capture_serial_lines_for_seconds_or_throw(params) {
  const { SerialPort, ReadlineParser } = load_serialport_constructors_or_exit();

  const serial_port = new SerialPort({
    path: params.capture_port,
    baudRate: params.baud_rate,
    autoOpen: true,
  });

  const parser = serial_port.pipe(new ReadlineParser({ delimiter: "\n" }));
  const lines = [];

  parser.on("data", (line) => {
    lines.push(String(line));
  });

  await new Promise((resolve, reject) => {
    const timeout_handle = setTimeout(() => {
      serial_port.close(() => resolve(undefined));
    }, params.capture_seconds * 1000);

    serial_port.on("error", (error) => {
      clearTimeout(timeout_handle);
      reject(error);
    });
  });

  return lines;
}

async function main() {
  const cli = parse_cli_arguments_or_exit(process.argv);
  const expected_text = readFileSync(cli.expected_trace_file, "utf-8");
  const expected_trace_lines = extract_trace_lines_from_text_file(expected_text);

  // eslint-disable-next-line no-console
  console.log(
    `Capturing serial from ${cli.capture_port} for ${cli.capture_seconds}s (baud=${cli.baud_rate})...`,
  );
  const captured_lines = await capture_serial_lines_for_seconds_or_throw({
    capture_port: cli.capture_port,
    baud_rate: cli.baud_rate,
    capture_seconds: cli.capture_seconds,
  });

  const actual_trace_lines = extract_trace_lines_from_serial_lines(captured_lines);

  if (actual_trace_lines.join("\n") !== expected_trace_lines.join("\n")) {
    // eslint-disable-next-line no-console
    console.error("Mismatch: expected trace lines !== captured trace lines");
    // eslint-disable-next-line no-console
    console.error("--- expected ---");
    // eslint-disable-next-line no-console
    console.error(expected_trace_lines.join("\n"));
    // eslint-disable-next-line no-console
    console.error("--- actual ---");
    // eslint-disable-next-line no-console
    console.error(actual_trace_lines.join("\n"));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("OK: captured trace lines match expected file.");
}

function extract_trace_lines_from_text_file(file_text) {
  const lines = split_non_empty_lines_from_text(file_text);
  return extract_trace_lines_from_serial_lines(lines);
}

await main();
