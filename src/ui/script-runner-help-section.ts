/**
 * 責務: Script runner パネル内の Help 領域を構築する。repo 相対パスの表示、パスコピー、CLI 手順の折りたたみを担当する。
 */

import { DOCUMENTATION_LINK_ITEMS_FOR_SIMULATOR_UI } from "./documentation-links";

const INSTALL_PICO_LOADER_SCRIPT_RELATIVE_PATH = "scripts/pico/runtime_vertical_slice/tools/install_pico_loader.py";
const UPLOAD_PICO_RUNTIME_PACKAGE_SCRIPT_RELATIVE_PATH =
  "scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package.py";

export type ScriptRunnerHelpSection = {
  readonly rootElement: HTMLElement;
};

function build_cli_reference_text(): string {
  return [
    "Pico: build a package in this UI, or use npm script + pyserial.",
    `Loader install (Windows UF2 helper): python ${INSTALL_PICO_LOADER_SCRIPT_RELATIVE_PATH}`,
    "  npm run build-pico-runtime-package -- --input kibo-runtime-ir-contract.json --output package.json",
    `  python ${UPLOAD_PICO_RUNTIME_PACKAGE_SCRIPT_RELATIVE_PATH} --port auto --package-file package.json`,
    "Golden packages for MVP fixtures live under tests/runtime-conformance/golden/pico-runtime-packages/.",
    `Preflight: python scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py --port auto`,
  ].join("\n");
}

async function copy_text_to_clipboard_or_throw(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function create_script_runner_help_section(): ScriptRunnerHelpSection {
  const rootElement = document.createElement("div");
  rootElement.className = "script-runner-help";

  const summary_line = document.createElement("div");
  summary_line.className = "script-runner-help-summary-line";
  summary_line.textContent =
    "Compile here, then export runtime IR or a Pico package. Web Serial needs Chrome or Edge on http://localhost.";

  const docs_details = document.createElement("details");
  docs_details.className = "script-runner-help-docs-details";
  docs_details.setAttribute("data-testid", "script-runner-help-details");

  const docs_summary = document.createElement("summary");
  docs_summary.className = "script-runner-help-docs-summary";
  docs_summary.textContent = "Documentation paths (repo-relative)";

  const docs_container = document.createElement("div");
  docs_container.className = "script-runner-help-docs-list";

  DOCUMENTATION_LINK_ITEMS_FOR_SIMULATOR_UI.forEach((item, item_index) => {
    const row = document.createElement("div");
    row.className = "script-runner-help-doc-row";

    const label = document.createElement("div");
    label.className = "script-runner-help-doc-label";
    label.textContent = item.displayLabelText;

    const path_code = document.createElement("code");
    path_code.className = "script-runner-help-doc-path";
    path_code.textContent = item.repositoryRelativeMarkdownPath;

    const description = document.createElement("div");
    description.className = "script-runner-help-doc-description";
    description.textContent = item.shortDescriptionText;

    const copy_button = document.createElement("button");
    copy_button.type = "button";
    copy_button.className = "script-runner-help-copy-path-button";
    copy_button.setAttribute("data-testid", `script-runner-copy-doc-path-button-${item_index}`);
    copy_button.textContent = "Copy path";
    copy_button.addEventListener("click", () => {
      void copy_text_to_clipboard_or_throw(item.repositoryRelativeMarkdownPath).catch(() => {
        window.alert("Clipboard copy failed. Select the path in the status area manually.");
      });
    });

    row.appendChild(label);
    row.appendChild(path_code);
    row.appendChild(description);
    row.appendChild(copy_button);
    docs_container.appendChild(row);
  });

  docs_details.appendChild(docs_summary);
  docs_details.appendChild(docs_container);

  const cli_details = document.createElement("details");
  cli_details.className = "script-runner-help-cli-details";
  cli_details.setAttribute("data-testid", "script-runner-help-cli-details");

  const cli_summary = document.createElement("summary");
  cli_summary.className = "script-runner-help-cli-summary";
  cli_summary.textContent = "CLI reference (advanced)";

  const cli_pre = document.createElement("pre");
  cli_pre.className = "script-runner-help-cli-pre";
  cli_pre.textContent = build_cli_reference_text();

  cli_details.appendChild(cli_summary);
  cli_details.appendChild(cli_pre);

  rootElement.appendChild(summary_line);
  rootElement.appendChild(docs_details);
  rootElement.appendChild(cli_details);

  return { rootElement };
}
