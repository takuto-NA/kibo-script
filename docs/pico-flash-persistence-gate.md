# 責務: RAM loader の次に **Pico flash へ package 永続化**へ進む前の設計 gate（recovery / checksum / version）。

親ドキュメント: [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md)  
最終判定: [`docs/pico-runtime-risk-burn-down-summary.md`](pico-runtime-risk-burn-down-summary.md)

## 現状（MVP）

- Active script は **RAM 上の package 差し替え**。電源断で消える。
- 復帰手段: **埋め込み default package**（`embedded_default_pico_runtime_package.hpp`）と **UF2 再書き込み**。
- **前提（順序固定）**: [`docs/kibo-device-protocol-roadmap.md`](kibo-device-protocol-roadmap.md) の **Kibo Device Protocol v1（chunked `file_*` + `run_package`）** が実機で安定するまで、flash 永続化実装に着手しない（通信・staging・実行経路の切り分けを先に閉じる）。

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

## Gate 判定（採用方針: 2026-05-04）

| 観点 | 採用 | 補足 |
| --- | --- | --- |
| 本 gate の実装タイミング | **Defer until bytecode または JSON decode 上限の 80% 接近** | RAM loader + `KIBO_PKG` で開発速度を優先。flash 書き込みはリスクが高いため、bytecode 縮小や JSON 肥大の見通しが付いてから着手。 |
| 保存レイアウト（試作前提） | **2 セクタ A/B + 同一 layout** | 常に「非 active」へ全文書き込み → CRC + 必須フィールド検証 OK 後に active ポインタを切替（RAM 上の gating と同じ JSON schema）。 |
| Header | **magic 4B + `storageLayoutVersion` uint32 + `payloadByteLength` uint32 + `payloadCrc32` uint32** | `picoRuntimePackageSchemaVersion` とは別の storage version を持ち、未知 layout は無視して embedded default へ。 |
| 電源断 | **active ポインタと blob CRC の二段** | 書き込み途中のセクタは active にしない。CRC 不一致・長さ不一致は候補を破棄し **前回 good または embedded default** へ。 |
| UF2 / BOOTSEL | **触らない** | アプリ flash のみ。bootloader 領域は変更禁止。 |
| MicroPython 共存 | **リンカスクリプトで Kibo 専用セクタを明示予約** | 他ファームの filesystem と重ならないことを **UF2 マップ表で先に固定**してから実装（本ドキュメントでは座標は未割当）。 |

### プロトタイプ開始条件（explicit gate）

1. [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) の「着手条件」のいずれかが満たされ、縮小・parser コストの見通しが付いたこと。  
2. `runtime/pico/vertical_slice` の linker script に **専用 flash 範囲**を割り当てるレビューが完了したこと。  
3. `FLASH-PWR-001` / `FLASH-PWR-002` を実機で再現する harness（電源断シミュレートまたは手動）の手順が用意されたこと。

### 旧ラベルとの対応（監査用）

- **Go（設計）**: 上記「採用方針」表を満たし、プロトタイプ開始条件がレビュー済みであること。  
- **Fix first**: RAM loader の ack / ログ強化など、flash 前にホスト側で潰す小項目。  
- **Redesign**: アドレス衝突や recovery 不能パターンが残る場合は、本表を破棄して再設計。  
- **Defer（実装）**: 上記「本 gate の実装タイミング」のとおり、**方針は確定・実装は保留**。

## bytecode との順序

- JSON が肥大化して **12288 bytes 制限**に近いなら、flash 保存より先に **bytecode 化または縮小**を検討（[`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md)）。
