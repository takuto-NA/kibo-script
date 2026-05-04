/**
 * 責務: ブラウザ上で複数行 script をコンパイルし、SimulationRuntime へ reset 登録または additive 登録するパネル。
 */

import { compileSourceAndRegisterSimulationTasks } from "../core/compile-and-register-simulation-script";
import type { CompiledProgram } from "../core/executable-task";
import type { SimulationRuntime } from "../core/simulation-runtime";
import {
  buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow,
  extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow,
  inferLiveTickIntervalMillisecondsFromCompiledProgram,
} from "../runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";
import { executeRuntimeConformanceReplayStepsAndCollectTraceLines } from "../runtime-conformance/execute-runtime-conformance-replay-steps-and-collect-trace-lines";
import { serializeCompiledProgramToRuntimeIrContractJsonText } from "../runtime-conformance/serialize-compiled-program-to-runtime-ir-contract-json-text";

const DEFAULT_SOURCE_FILE_NAME = "browser.sc";
const DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME = "kibo-runtime-ir-contract.json";
const DEFAULT_PICO_RUNTIME_PACKAGE_DOWNLOAD_FILE_NAME = "kibo-pico-runtime-package.json";
const KIBO_USB_SERIAL_BAUD_RATE = 115200;
const KIBO_SERIAL_PING_COMMAND_TEXT = "KIBO_PING";
const KIBO_LOADER_STATUS_OK_PREFIX = "kibo_loader status=ok";
const KIBO_PACKAGE_ACK_OK_TEXT = "kibo_pkg_ack status=ok";
const KIBO_PACKAGE_LINE_SCHEMA_VERSION = 1;
const KIBO_LOADER_PROTOCOL_VERSION = 1;
const SERIAL_PING_TIMEOUT_MILLISECONDS = 2500;
const SERIAL_ACK_TIMEOUT_MILLISECONDS = 5000;
const SERIAL_TRACE_VERIFY_TIMEOUT_MILLISECONDS = 8000;
const CRC32_POLYNOMIAL = 0xedb88320;
const CRC32_INITIAL_VALUE = 0xffffffff;
const BYTE_VALUE_MASK = 0xff;
const CRC32_FINAL_XOR_VALUE = 0xffffffff;
const CRC32_BITS_PER_BYTE = 8;
const HEX_RADIX = 16;
const CRC32_HEX_DIGIT_COUNT = 8;
const BASE64_BINARY_CHUNK_SIZE_BYTES = 0x8000;
const SERIAL_STATUS_PREVIEW_LINE_COUNT = 12;

type SerialReadResult = ReadableStreamReadResult<Uint8Array>;

type KiboSerialPort = {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};

type KiboSerialApi = {
  requestPort(): Promise<KiboSerialPort>;
};

type NavigatorWithKiboSerial = Navigator & {
  readonly serial?: KiboSerialApi;
};

export type ScriptRunnerPanel = {
  rootElement: HTMLElement;
};

function split_comma_separated_trace_var_names_or_undefined(trace_var_names_text: string): readonly string[] | undefined {
  const names = trace_var_names_text
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    return undefined;
  }
  return names;
}

function build_pico_link_check_command_hint_text(params: {
  readonly pico_runtime_package_download_file_name: string;
  readonly trace_var_names_text: string;
}): string {
  const trace_var_flag =
    params.trace_var_names_text.trim().length > 0 ? ` --trace-var ${params.trace_var_names_text.trim()}` : "";
  return (
    `Pico one-shot (host): python scripts/pico/runtime_vertical_slice/tools/pico_link_check.py --port auto --runtime-ir ${DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME}\n` +
    `Pico one-shot (host, after downloading package file): python scripts/pico/runtime_vertical_slice/tools/pico_link_check.py --port auto --package-file ${params.pico_runtime_package_download_file_name}${trace_var_flag}\n` +
    `Preflight only: python scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py --port auto`
  );
}

function resolve_browser_serial_api_or_undefined(): KiboSerialApi | undefined {
  return (navigator as NavigatorWithKiboSerial).serial;
}

function build_crc32_table(): readonly number[] {
  const table: number[] = [];
  for (let byte = 0; byte <= BYTE_VALUE_MASK; byte += 1) {
    let crc = byte;
    for (let bit_index = 0; bit_index < CRC32_BITS_PER_BYTE; bit_index += 1) {
      const least_significant_bit_is_set = (crc & 1) === 1;
      crc = least_significant_bit_is_set ? (crc >>> 1) ^ CRC32_POLYNOMIAL : crc >>> 1;
    }
    table.push(crc >>> 0);
  }
  return table;
}

const CRC32_TABLE = build_crc32_table();

function compute_crc32_lower_hex8(bytes: Uint8Array): string {
  let crc = CRC32_INITIAL_VALUE;
  for (const byte of bytes) {
    const table_index = (crc ^ byte) & BYTE_VALUE_MASK;
    crc = (crc >>> 8) ^ (CRC32_TABLE[table_index] ?? 0);
  }
  const final_crc = (crc ^ CRC32_FINAL_XOR_VALUE) >>> 0;
  return final_crc.toString(HEX_RADIX).padStart(CRC32_HEX_DIGIT_COUNT, "0");
}

function encode_utf8_bytes_to_base64(bytes: Uint8Array): string {
  let binary_text = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_BINARY_CHUNK_SIZE_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_BINARY_CHUNK_SIZE_BYTES);
    binary_text += String.fromCharCode(...chunk);
  }
  return btoa(binary_text);
}

function build_kibo_package_serial_line(package_text: string): string {
  const package_bytes = new TextEncoder().encode(package_text);
  const crc32_text = compute_crc32_lower_hex8(package_bytes);
  const base64_payload_text = encode_utf8_bytes_to_base64(package_bytes);
  return `KIBO_PKG schema=${KIBO_PACKAGE_LINE_SCHEMA_VERSION} bytes=${package_bytes.length} crc32=${crc32_text} b64=${base64_payload_text}\n`;
}

function split_non_empty_lines_from_serial_text(text: string): readonly string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function extract_trace_lines_from_serial_lines(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.startsWith("trace "));
}

function contains_expected_trace_sequence(params: {
  readonly actual_trace_lines: readonly string[];
  readonly expected_trace_lines: readonly string[];
}): boolean {
  if (params.expected_trace_lines.length === 0) {
    return true;
  }
  const last_possible_start_index = params.actual_trace_lines.length - params.expected_trace_lines.length;
  for (let start_index = 0; start_index <= last_possible_start_index; start_index += 1) {
    const window_matches = params.expected_trace_lines.every((expected_line, offset) => {
      return params.actual_trace_lines[start_index + offset] === expected_line;
    });
    if (window_matches) {
      return true;
    }
  }
  return false;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function write_text_to_serial_port(params: {
  readonly port: KiboSerialPort;
  readonly text: string;
}): Promise<void> {
  if (params.port.writable === null) {
    throw new Error("Selected serial port is not writable.");
  }
  const writer = params.port.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(params.text));
  } finally {
    writer.releaseLock();
  }
}

async function read_serial_lines_until_or_timeout(params: {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly timeout_milliseconds: number;
  readonly stop_when: (lines: readonly string[]) => boolean;
}): Promise<readonly string[]> {
  const decoder = new TextDecoder();
  const deadline_milliseconds = Date.now() + params.timeout_milliseconds;
  let received_text = "";
  while (Date.now() < deadline_milliseconds) {
    const remaining_milliseconds = Math.max(0, deadline_milliseconds - Date.now());
    const read_promise: Promise<SerialReadResult | undefined> = params.reader.read();
    read_promise.catch(() => undefined);
    const read_result = await Promise.race([
      read_promise,
      delay(remaining_milliseconds).then(() => undefined),
    ]);
    if (read_result === undefined) {
      break;
    }
    if (read_result.done === true) {
      break;
    }
    received_text += decoder.decode(read_result.value, { stream: true });
    const lines = split_non_empty_lines_from_serial_text(received_text);
    if (params.stop_when(lines)) {
      return lines;
    }
  }
  received_text += decoder.decode();
  return split_non_empty_lines_from_serial_text(received_text);
}

function find_loader_protocol_ok_line(lines: readonly string[]): string | undefined {
  return lines.find((line) => {
    return (
      line.startsWith(KIBO_LOADER_STATUS_OK_PREFIX) &&
      line.includes(`protocol=${KIBO_LOADER_PROTOCOL_VERSION}`)
    );
  });
}

function format_serial_lines_for_status(lines: readonly string[]): string {
  if (lines.length === 0) {
    return "(no serial lines captured)";
  }
  return lines.slice(-SERIAL_STATUS_PREVIEW_LINE_COUNT).join("\n");
}

export function createScriptRunnerPanel(params: {
  simulationRuntime: SimulationRuntime;
  onAfterScriptLoaded: () => void;
}): ScriptRunnerPanel {
  const rootElement = document.createElement("div");
  rootElement.className = "script-runner";

  const title = document.createElement("div");
  title.className = "script-runner-title";
  title.textContent = "StaticCore Script (compile)";

  const sourceTextArea = document.createElement("textarea");
  sourceTextArea.className = "script-runner-textarea";
  sourceTextArea.setAttribute("data-testid", "script-runner-textarea");
  sourceTextArea.rows = 8;
  sourceTextArea.setAttribute("aria-label", "Multiline script source");
  sourceTextArea.spellcheck = false;
  sourceTextArea.value = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
`;

  const buttonRow = document.createElement("div");
  buttonRow.className = "script-runner-button-row";

  const resetRunButton = document.createElement("button");
  resetRunButton.type = "button";
  resetRunButton.className = "script-runner-button";
  resetRunButton.setAttribute("data-testid", "script-runner-submit-button");
  resetRunButton.textContent = "Reset & run on simulator";

  const addToRuntimeButton = document.createElement("button");
  addToRuntimeButton.type = "button";
  addToRuntimeButton.className = "script-runner-button script-runner-button-secondary";
  addToRuntimeButton.setAttribute("data-testid", "script-runner-add-button");
  addToRuntimeButton.textContent = "Add to runtime";

  const resultPre = document.createElement("pre");
  resultPre.className = "script-runner-result";
  resultPre.setAttribute("role", "status");

  let last_successful_reset_compiled_program: CompiledProgram | undefined;

  const exportRow = document.createElement("div");
  exportRow.className = "script-runner-button-row";

  const copyRuntimeIrButton = document.createElement("button");
  copyRuntimeIrButton.type = "button";
  copyRuntimeIrButton.className = "script-runner-button script-runner-button-secondary";
  copyRuntimeIrButton.setAttribute("data-testid", "script-runner-copy-runtime-ir-button");
  copyRuntimeIrButton.textContent = "Copy runtime IR (reset compile)";

  const downloadRuntimeIrButton = document.createElement("button");
  downloadRuntimeIrButton.type = "button";
  downloadRuntimeIrButton.className = "script-runner-button script-runner-button-secondary";
  downloadRuntimeIrButton.setAttribute("data-testid", "script-runner-download-runtime-ir-button");
  downloadRuntimeIrButton.textContent = "Download runtime IR (reset compile)";

  const traceVarLabel = document.createElement("label");
  traceVarLabel.className = "script-runner-trace-var-label";
  traceVarLabel.textContent = "Pico trace vars (comma-separated, optional):";
  traceVarLabel.setAttribute("for", "script-runner-trace-vars-input");

  const traceVarInput = document.createElement("input");
  traceVarInput.id = "script-runner-trace-vars-input";
  traceVarInput.className = "script-runner-trace-var-input";
  traceVarInput.setAttribute("data-testid", "script-runner-trace-vars-input");
  traceVarInput.type = "text";
  traceVarInput.setAttribute("aria-label", "Comma-separated script variable names for Pico trace export");
  traceVarInput.placeholder = "circle_x (leave blank to use defaults)";

  const downloadPicoPackageButton = document.createElement("button");
  downloadPicoPackageButton.type = "button";
  downloadPicoPackageButton.className = "script-runner-button script-runner-button-secondary";
  downloadPicoPackageButton.setAttribute("data-testid", "script-runner-download-pico-package-button");
  downloadPicoPackageButton.textContent = "Download Pico package (reset compile)";

  const writePicoButton = document.createElement("button");
  writePicoButton.type = "button";
  writePicoButton.className = "script-runner-button script-runner-button-primary-action";
  writePicoButton.setAttribute("data-testid", "script-runner-write-pico-button");
  writePicoButton.textContent = "Run simulator & write to Pico";
  if (resolve_browser_serial_api_or_undefined() === undefined) {
    writePicoButton.disabled = true;
    writePicoButton.title =
      "Web Serial is not available in this browser. Use Chrome/Edge on localhost, or use pico_link_check.py.";
  }

  const mvpNote = document.createElement("div");
  mvpNote.className = "script-runner-mvp-note";
  mvpNote.textContent =
    "Pico MVP: export/write infers live tick from the first `every` task interval (or defaults), replay steps from every/on_event tasks, and includes `circle_x` in trace when declared. Browser write uses Web Serial; if unavailable, use the CLI hint below.";

  const cliHintPre = document.createElement("pre");
  cliHintPre.className = "script-runner-cli-hint";
  cliHintPre.textContent =
    "Pico MVP: build a package in the UI, or use npm script + pyserial.\n" +
    "  npm run build-pico-runtime-package -- --input kibo-runtime-ir-contract.json --output package.json\n" +
    "  python scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package.py --port auto --package-file package.json\n" +
    "Golden packages for the three MVP fixtures live under tests/runtime-conformance/golden/pico-runtime-packages/.";

  function runCompile(registrationMode: "reset" | "add"): void {
    const loadResult = compileSourceAndRegisterSimulationTasks({
      sourceText: sourceTextArea.value,
      sourceFileName: DEFAULT_SOURCE_FILE_NAME,
      simulationRuntime: params.simulationRuntime,
      registrationMode,
    });

    if (loadResult.ok === false) {
      resultPre.textContent = JSON.stringify(loadResult.report, null, 2);
      return;
    }

    if (registrationMode === "reset") {
      last_successful_reset_compiled_program = loadResult.compiledProgram;
    }

    const modeLabel = registrationMode === "reset" ? "reset+registered" : "add+registered";
    resultPre.textContent = `ok (${modeLabel}) compiled task(s): ${loadResult.registeredTaskNames.join(", ")}`;
    params.onAfterScriptLoaded();
  }

  function resolve_runtime_ir_contract_json_text_or_set_error_pre(): string | undefined {
    if (last_successful_reset_compiled_program === undefined) {
      resultPre.textContent =
        "No successful reset compile yet. Click “Reset & run on simulator” before exporting runtime IR.";
      return undefined;
    }
    return serializeCompiledProgramToRuntimeIrContractJsonText(last_successful_reset_compiled_program);
  }

  async function copy_runtime_ir_contract_json_text_to_clipboard_or_set_error_pre(): Promise<void> {
    const json_text = resolve_runtime_ir_contract_json_text_or_set_error_pre();
    if (json_text === undefined) {
      return;
    }
    try {
      await navigator.clipboard.writeText(json_text);
      resultPre.textContent = "ok: runtime IR contract JSON copied to clipboard.";
    } catch {
      resultPre.textContent =
        "Clipboard write failed. Use Download runtime IR instead, or grant clipboard permission for this origin.";
    }
  }

  function download_runtime_ir_contract_json_text_or_set_error_pre(): void {
    const json_text = resolve_runtime_ir_contract_json_text_or_set_error_pre();
    if (json_text === undefined) {
      return;
    }
    const blob = new Blob([json_text], { type: "application/json;charset=utf-8" });
    const object_url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = object_url;
    anchor.download = DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME;
    anchor.click();
    URL.revokeObjectURL(object_url);
    resultPre.textContent = `ok: downloaded ${DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME}`;
  }

  function download_pico_runtime_package_json_text_or_set_error_pre(): void {
    if (last_successful_reset_compiled_program === undefined) {
      resultPre.textContent =
        "No successful reset compile yet. Click “Reset & run on simulator” before downloading a Pico package.";
      return;
    }

    const trace_var_names_override = split_comma_separated_trace_var_names_or_undefined(traceVarInput.value);
    let package_text: string;
    try {
      package_text = buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
        compiledProgram: last_successful_reset_compiled_program,
        scriptVarNamesToIncludeInTraceOverride: trace_var_names_override,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resultPre.textContent = `FAIL: could not build PicoRuntimePackage from compiled program: ${message}`;
      return;
    }

    const live_tick_interval_milliseconds = inferLiveTickIntervalMillisecondsFromCompiledProgram(
      last_successful_reset_compiled_program,
    );
    const first_every_interval_milliseconds =
      last_successful_reset_compiled_program.everyTasks.length > 0
        ? String(last_successful_reset_compiled_program.everyTasks[0].intervalMilliseconds)
        : "(no every tasks; default live tick used)";

    const blob = new Blob([package_text], { type: "application/json;charset=utf-8" });
    const object_url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = object_url;
    anchor.download = DEFAULT_PICO_RUNTIME_PACKAGE_DOWNLOAD_FILE_NAME;
    anchor.click();
    URL.revokeObjectURL(object_url);

    const pico_link_hint = build_pico_link_check_command_hint_text({
      pico_runtime_package_download_file_name: DEFAULT_PICO_RUNTIME_PACKAGE_DOWNLOAD_FILE_NAME,
      trace_var_names_text: traceVarInput.value,
    });

    resultPre.textContent = [
      `ok: downloaded ${DEFAULT_PICO_RUNTIME_PACKAGE_DOWNLOAD_FILE_NAME}`,
      `Inferred live.tickIntervalMilliseconds=${live_tick_interval_milliseconds} (first every interval: ${first_every_interval_milliseconds})`,
      "",
      pico_link_hint,
    ].join("\n");
  }

  function set_pico_write_controls_enabled(enabled: boolean): void {
    resetRunButton.disabled = !enabled;
    addToRuntimeButton.disabled = !enabled;
    copyRuntimeIrButton.disabled = !enabled;
    downloadRuntimeIrButton.disabled = !enabled;
    downloadPicoPackageButton.disabled = !enabled;
    const serial_is_supported = resolve_browser_serial_api_or_undefined() !== undefined;
    writePicoButton.disabled = !enabled || !serial_is_supported;
  }

  function build_pico_runtime_package_text_from_compiled_program_or_set_error_pre(
    compiled_program: CompiledProgram,
  ): string | undefined {
    const trace_var_names_override = split_comma_separated_trace_var_names_or_undefined(traceVarInput.value);
    try {
      return buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
        compiledProgram: compiled_program,
        scriptVarNamesToIncludeInTraceOverride: trace_var_names_override,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resultPre.textContent = `FAIL: could not build PicoRuntimePackage from compiled program: ${message}`;
      return undefined;
    }
  }

  async function write_current_script_to_pico_or_set_error_pre(): Promise<void> {
    const serial_api = resolve_browser_serial_api_or_undefined();
    if (serial_api === undefined) {
      resultPre.textContent =
        "Web Serial is not available. Use Chrome/Edge on localhost, or run pico_link_check.py from the CLI.";
      return;
    }

    set_pico_write_controls_enabled(false);
    let port: KiboSerialPort | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      resultPre.textContent = "Compiling and running the current script on the simulator...";
      const loadResult = compileSourceAndRegisterSimulationTasks({
        sourceText: sourceTextArea.value,
        sourceFileName: DEFAULT_SOURCE_FILE_NAME,
        simulationRuntime: params.simulationRuntime,
        registrationMode: "reset",
      });
      if (loadResult.ok === false) {
        resultPre.textContent = JSON.stringify(loadResult.report, null, 2);
        return;
      }

      last_successful_reset_compiled_program = loadResult.compiledProgram;
      params.onAfterScriptLoaded();

      const package_text = build_pico_runtime_package_text_from_compiled_program_or_set_error_pre(
        loadResult.compiledProgram,
      );
      if (package_text === undefined) {
        return;
      }
      const replay_inputs = extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow(JSON.parse(package_text));
      const expected_trace_lines = executeRuntimeConformanceReplayStepsAndCollectTraceLines({
        compiledProgram: replay_inputs.compiledProgram,
        scriptVarNamesToIncludeInTrace: replay_inputs.scriptVarNamesToIncludeInTrace,
        replaySteps: replay_inputs.replaySteps,
      });

      resultPre.textContent = "Select the Pico serial port in the browser dialog...";
      port = await serial_api.requestPort();
      await port.open({ baudRate: KIBO_USB_SERIAL_BAUD_RATE });
      if (port.readable === null) {
        throw new Error("Selected serial port is not readable.");
      }
      reader = port.readable.getReader();

      resultPre.textContent = "Checking Pico loader with KIBO_PING...";
      await write_text_to_serial_port({ port, text: `${KIBO_SERIAL_PING_COMMAND_TEXT}\n` });
      const ping_lines = await read_serial_lines_until_or_timeout({
        reader,
        timeout_milliseconds: SERIAL_PING_TIMEOUT_MILLISECONDS,
        stop_when: (lines) => find_loader_protocol_ok_line(lines) !== undefined,
      });
      const loader_line = find_loader_protocol_ok_line(ping_lines);
      if (loader_line === undefined) {
        throw new Error(
          `Pico loader did not respond with protocol=${KIBO_LOADER_PROTOCOL_VERSION}.\n${format_serial_lines_for_status(ping_lines)}`,
        );
      }

      resultPre.textContent = `Loader ready: ${loader_line}\nUploading Pico package...`;
      await write_text_to_serial_port({
        port,
        text: build_kibo_package_serial_line(package_text),
      });
      const ack_lines = await read_serial_lines_until_or_timeout({
        reader,
        timeout_milliseconds: SERIAL_ACK_TIMEOUT_MILLISECONDS,
        stop_when: (lines) => lines.some((line) => line.includes(KIBO_PACKAGE_ACK_OK_TEXT)),
      });
      if (!ack_lines.some((line) => line.includes(KIBO_PACKAGE_ACK_OK_TEXT))) {
        throw new Error(`Pico did not acknowledge the package.\n${format_serial_lines_for_status(ack_lines)}`);
      }

      resultPre.textContent = "Package written. Verifying Pico trace against simulator replay...";
      const trace_lines = await read_serial_lines_until_or_timeout({
        reader,
        timeout_milliseconds: SERIAL_TRACE_VERIFY_TIMEOUT_MILLISECONDS,
        stop_when: (lines) => {
          const actual_trace_lines = extract_trace_lines_from_serial_lines(lines);
          return contains_expected_trace_sequence({ actual_trace_lines, expected_trace_lines });
        },
      });
      const actual_trace_lines = extract_trace_lines_from_serial_lines(trace_lines);
      if (!contains_expected_trace_sequence({ actual_trace_lines, expected_trace_lines })) {
        throw new Error(
          [
            "Pico trace did not match simulator replay within the timeout.",
            "--- expected ---",
            expected_trace_lines.join("\n"),
            "--- actual trace ---",
            actual_trace_lines.join("\n"),
          ].join("\n"),
        );
      }

      resultPre.textContent = [
        `ok: simulator and Pico matched (${loadResult.registeredTaskNames.join(", ")})`,
        `loader: ${loader_line}`,
        `trace lines verified: ${expected_trace_lines.length}`,
      ].join("\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resultPre.textContent = `FAIL: Pico write/verify failed.\n${message}`;
    } finally {
      if (reader !== undefined) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (port !== undefined) {
        await port.close().catch(() => undefined);
      }
      set_pico_write_controls_enabled(true);
    }
  }

  resetRunButton.addEventListener("click", () => {
    runCompile("reset");
  });

  addToRuntimeButton.addEventListener("click", () => {
    runCompile("add");
  });

  copyRuntimeIrButton.addEventListener("click", () => {
    void copy_runtime_ir_contract_json_text_to_clipboard_or_set_error_pre();
  });

  downloadRuntimeIrButton.addEventListener("click", () => {
    download_runtime_ir_contract_json_text_or_set_error_pre();
  });

  downloadPicoPackageButton.addEventListener("click", () => {
    download_pico_runtime_package_json_text_or_set_error_pre();
  });

  writePicoButton.addEventListener("click", () => {
    void write_current_script_to_pico_or_set_error_pre();
  });

  buttonRow.appendChild(resetRunButton);
  buttonRow.appendChild(addToRuntimeButton);

  exportRow.appendChild(copyRuntimeIrButton);
  exportRow.appendChild(downloadRuntimeIrButton);
  exportRow.appendChild(traceVarLabel);
  exportRow.appendChild(traceVarInput);
  exportRow.appendChild(downloadPicoPackageButton);
  exportRow.appendChild(writePicoButton);

  rootElement.appendChild(title);
  rootElement.appendChild(sourceTextArea);
  rootElement.appendChild(buttonRow);
  rootElement.appendChild(exportRow);
  rootElement.appendChild(mvpNote);
  rootElement.appendChild(cliHintPre);
  rootElement.appendChild(resultPre);

  return { rootElement };
}
