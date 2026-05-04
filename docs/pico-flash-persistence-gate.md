# 責務: RAM loader の次に **Pico flash へ package 永続化**へ進む前の設計 gate（recovery / checksum / version）。

親ドキュメント: [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md)  
最終判定: [`docs/pico-runtime-risk-burn-down-summary.md`](pico-runtime-risk-burn-down-summary.md)

## 現状（MVP）

- Active script は **RAM 上の package 差し替え**。電源断で消える。
- 復帰手段: **埋め込み default package**（`embedded_default_pico_runtime_package.hpp`）と **UF2 再書き込み**。

## 実装前に決めるべき項目

| 項目 | 選択肢 | 推奨メモ |
| --- | --- | --- |
| 保存領域 | 専用 flash sector / ファイル風領域 | MicroPython / 他ファームと **絶対に重ならない**アドレスマップを先に固定 |
| 書き込み単位 | セクタ消去 + 書き込み | 書き込み中の電源断で「半端な JSON」が残るのを前提にする |
| 整合性 | CRC32 / SHA256 / 長さ + magic | RAM loader と同程度から開始し、強度は後で上げる |
| バージョン | `picoRuntimePackageSchemaVersion` と別の **storage layout version** | layout 変更で旧領域を無視できるようにする |
| 無効時の fallback | default embedded / 前回 good / factory | **必ずビルドインの安全動作**に戻れること |
| UF2 rescue | `RPI-RP2` 経路を壊さない | 永続領域はアプリケーション flash のみ。bootloader 領域を触らない |

## 電源断シナリオ（必須テスト設計）

| ID | 操作 | 合格条件 |
| --- | --- | --- |
| `FLASH-PWR-001` | 新 package flash 書き込み直後に電源断（何度か） | 次起動で **実行可能な状態**（default へ fallback でも可）に必ず復帰 |
| `FLASH-PWR-002` | 書き込み途中で電源断 | 破損した候補は読まれず、前回 good または default |

## Gate 判定（計画段階）

- **Go**: 上表のポリシー文書化が完了し、試作セクタレイアウトのレビューが済んだ。
- **Fix first**: RAM loader の ack / ログを少し足せば flash 化の土台になる。
- **Redesign**: アドレスが他用途と衝突、または recovery 不能な壊れ方が残る。

## bytecode との順序

- JSON が肥大化して **12288 bytes 制限**に近いなら、flash 保存より先に **bytecode 化または縮小**を検討（[`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md)）。
