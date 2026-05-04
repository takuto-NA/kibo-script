# 責務: **最後の gate** として実施する長時間試験とリソース計測の合格条件（短時間 gate の後にだけ実行）。

理由: 先に semantics / loader / UX / persistence / bytecode 方針を固めないと、長時間失敗の原因切り分けが高コストになる（Pico Runtime Risk Burn-down Plan Phase 7）。

## 前提

- 直前までに [`docs/pico-loader-protocol-gates.md`](pico-loader-protocol-gates.md) の `LOADER-PKG-REPEAT-001` が通過していること。
- 短時間 trace 一致（`pico_link_check.py` または `run_pico_runtime_samples.py`）が通っていること。

## 長時間シナリオ

| ID | シナリオ | 最低時間 | 合格条件 |
| --- | --- | ---: | --- |
| `SOAK-LED-001` | `led-heartbeat` を実機実行 | 30 分 | USB Serial が途切れない、LED が周期を維持、異常リセットなし |
| `SOAK-OLED-001` | `circle-sweep` または `two-circle-chase` | 30 分 | OLED の更新が固まらない・ゴミ化しない |
| `SOAK-UPLOAD-001` | 小さめ valid package を **100 回**連続 upload | （数分〜十分） | 毎回 `kibo_pkg_ack status=ok`、その後の trace が期待通り |
| `SOAK-PARSE-001` | 5 サンプルそれぞれについて upload 〜 最初の trace まで | 計測のみ | 人間許容の upload+parse 時間（チームで閾値 ms を固定） |

## リソース baseline（記録項目）

| 項目 | 取得方法 |
| --- | --- |
| Flash / RAM 使用率 | `pio run` サマリ（ツールチェーン更新で変動するため **日付つきで記録**） |
| minified package UTF-8 サイズ | ホストで `json.dumps(..., separators=(',', ':'))` 後の byte 長 |
| `KIBO_PKG` 1 行の文字数 | Base64 化後の行長（`k_max_serial_line_characters` との余裕） |

記録先: [`docs/pico-bringup.md`](pico-bringup.md) または [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md) の実機メモ。

## Exit criteria（この gate を終えたら）

- 長時間で新規不具合が **0 件**、または **既知 issue として起票済み**で再現手順が残っている。
- Flash/RAM/package サイズの表が 1 枚にまとまっている（summary へ転記）。
