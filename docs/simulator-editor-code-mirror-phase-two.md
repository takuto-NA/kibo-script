# 責務: シミュレータのエディタを CodeMirror 6 へ置き換えるかどうかの第2段階判断メモ

## 結論

第1段階では `textarea` のまま Examples、Help、ターミナル追従を改善する。CodeMirror 6 は第2段階で導入を再評価する。

## 第2段階で導入する場合の狙い

- 構文ハイライトと折りたたみで可読性を上げる。
- [src/diagnostics/diagnostic.ts](src/diagnostics/diagnostic.ts) の `line` / `column` を CodeMirror の lint diagnostic に接続し、エラー位置へジャンプする。
- バンドルサイズ増と E2E の入力経路（`fill` 相当）の見直しが必要になる。

## 推奨パッケージ候補

- `@codemirror/state`
- `@codemirror/view`
- `@codemirror/language`
- `@codemirror/lint`

## テストへの影響

- Playwright は `data-testid="script-runner-textarea"` を前提にしている。CodeMirror 導入時は非表示の textarea を同期するか、テスト用ヘルパーで `view.dispatch` 経由に切り替える。

## いつ着手するか

Examples / Help / Terminal の利用実績を見てから着手し、エディタ強化がボトルネックになった時点でスプリントを切る。
