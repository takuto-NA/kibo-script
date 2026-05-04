/**
 * 責務: シミュレータUIの Help パネルで案内するドキュメントの repo 相対パスと短い説明を集約する。
 */

export type DocumentationLinkItem = {
  readonly displayLabelText: string;
  readonly repositoryRelativeMarkdownPath: string;
  readonly shortDescriptionText: string;
};

export const DOCUMENTATION_LINK_ITEMS_FOR_SIMULATOR_UI: readonly DocumentationLinkItem[] = [
  {
    displayLabelText: "Runtime / Pico handoff",
    repositoryRelativeMarkdownPath: "docs/runtime-pico-handoff.md",
    shortDescriptionText: "Simulator から Pico へのデータフローと運用手順の全体像。",
  },
  {
    displayLabelText: "Simulator to Pico UX audit",
    repositoryRelativeMarkdownPath: "docs/pico-simulator-to-pico-ux-audit.md",
    shortDescriptionText: "Web Serial と CLI の成功・失敗パターンと回復アクション。",
  },
  {
    displayLabelText: "Pico flash persistence gate",
    repositoryRelativeMarkdownPath: "docs/pico-flash-persistence-gate.md",
    shortDescriptionText: "フラッシュ永続化に関するゲートと制約のメモ。",
  },
];
