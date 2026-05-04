# 責務: USB Serial `KIBO_PKG` loader の **negative / 復旧** acceptance gate を列挙し、実機手順で再現できるようにする。

親ドキュメント: [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md)  
最終判定: [`docs/pico-runtime-risk-burn-down-summary.md`](pico-runtime-risk-burn-down-summary.md)

## ファーム側の固定上限（コード根拠）

`runtime/pico/vertical_slice/src/main.cpp` より（変更時は本文も更新すること）:

| 定数 | 値 | 意味 |
| --- | ---: | --- |
| `k_max_serial_line_characters` | 16384 | 1 行 `KIBO_PKG ...` の最大文字数（超過は行バッファ破棄寄りの扱い） |
| `k_max_decoded_package_bytes` | 12288 | Base64 decode 後の JSON バイト上限 |

**暫定ポリシー**: minified `PicoRuntimePackage` UTF-8 が **12288 bytes 以下**であることを preflight（ホスト側）で警告〜拒否できると安全。

## Positive gate（既存）

| ID | 手順 | 合格条件 |
| --- | --- | --- |
| `LOADER-PING-001` | `python .../pico_link_doctor.py --port <COM>` | `kibo_loader status=ok protocol=1 ...` が返る |
| `LOADER-PKG-OK-001` | `upload_pico_runtime_package.py --package-file <valid.json>` | `kibo_pkg_ack status=ok` の後、期待 trace が出る |

## Negative / stress gate（実機）

| ID | 入力 | 期待 | 復旧手順 |
| --- | --- | --- | --- |
| `LOADER-PKG-LEN-001` | `send_invalid_kibo_pkg_length.py`（宣言 `bytes` と実データ不一致） | `kibo_pkg_ack status=error` または明確な拒否ログ。ファームが panic しない | 続けて **valid** `KIBO_PKG` を送る |
| `LOADER-PKG-CRC-001` | ホスト側で意図的に壊した CRC（手編集 1 行） | 拒否され、**直前の active package** が実行を継続（壊れた中身に切り替わらない） | valid package を再送 |
| `LOADER-PKG-B64-001` | 不正 Base64（パディング破壊） | 拒否 | valid を再送 |
| `LOADER-PKG-JSON-001` | 正しい Base64 だが JSON が壊れている | 拒否 | valid を再送 |
| `LOADER-PKG-SCHEMA-001` | JSON はあるが `picoRuntimePackageSchemaVersion` 不一致 | 拒否 | スキーマを揃えた package を送る |
| `LOADER-PKG-SIZE-001` | `send_oversized_kibo_pkg.py`（decode 後が `k_max_decoded_package_bytes` を超える minified JSON を組み立てる） | **通常**: 1 行が `k_max_serial_line_characters` を超えるため `trace ... diag=serial_line_too_long`（`main.cpp`）。将来フレーミングが拡張されれば `kibo_pkg_ack ... package_too_large` になり得る。ファームが panic しない | valid を再送 |
| `LOADER-PKG-REPEAT-001` | 同一 valid package を **20 回連続** upload | 毎回 ack OK、trace が安定 | なし |
| `LOADER-PING-RACE-001` | シリアルモニタがポートを掴んだ状態で ping | 失敗しても **診断メッセージが分かる**（Windows は `pico_link_common` の Permission hint） | モニタ終了 → 再実行 |

## ホスト側 sender（実装済み）

| スクリプト | gate ID |
| --- | --- |
| `send_invalid_kibo_pkg_length.py` | `LOADER-PKG-LEN-001` |
| `send_invalid_kibo_pkg_crc.py` | `LOADER-PKG-CRC-001` |
| `send_oversized_kibo_pkg.py` | `LOADER-PKG-SIZE-001` |
| `send_invalid_kibo_pkg_frame.py --kind invalid_base64` | `LOADER-PKG-B64-001` |
| `send_invalid_kibo_pkg_frame.py --kind invalid_json_utf8` | `LOADER-PKG-JSON-001` |
| `send_invalid_kibo_pkg_frame.py --kind unsupported_schema` | `LOADER-PKG-SCHEMA-001` |

既定の `--port auto` と、negative 後の **valid package 再送（復旧）** は各スクリプトが `--recover-package-file`（省略時は blink-led golden）で実行する。

**注意（SIZE）**: decode 上限を超える UTF-8 を 1 行 Base64 で送ると、多くの場合 **行長上限の方が先に効く**（`serial_line_too_long`）。`send_oversized_kibo_pkg.py` は両方を合格扱いにする。

## 調査ログの記録場所

実測した「最大通過 package サイズ」「拒否メッセージ文言」は `docs/pico-bringup.md` か [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md) の実機メモに追記する。
