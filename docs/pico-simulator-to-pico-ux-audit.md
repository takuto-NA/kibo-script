# 責務: Simulator UI（Web Serial）と CLI fallback の **成功 / 失敗 / 再接続** を実機手順として洗い出す。

実装参照: [`src/ui/script-runner-view.ts`](../src/ui/script-runner-view.ts)  
診断 CLI: [`scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py`](../scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py)

## 主経路と fallback

| 経路 | 前提 | 正とする用途 |
| --- | --- | --- |
| **ブラウザ Web Serial** | Chromium 系、`navigator.serial`、ユーザーがポート選択 | インタラクティブ開発の主経路 |
| **Python CLI** | `pyserial`、COM パス、`KIBO_PING` / `KIBO_PKG` | CI に載せない **確実な one-shot**、権限・競合の切り分け |

## 成功ケース（実機チェックリスト）

| ID | 手順 | 合格条件 |
| --- | --- | --- |
| `UX-OK-001` | `led-heartbeat.sc` を貼り付け → Reset & run → **Run simulator & write to Pico** | 最終メッセージに `simulator and Pico matched` |
| `UX-OK-002` | `circle-sweep.sc`（`circle_x` 宣言あり） | 同上 + OLED が sweep 相当に動く（目視） |
| `UX-OK-003` | `button-led-toggle.sc` | 書き込み後、物理ボタンで LED がトグル（目視） |

## 失敗ケース（UI が出すメッセージ / 次アクション）

| ID | 状況 | ユーザーに見える挙動 | 次アクション |
| --- | --- | --- | --- |
| `UX-FAIL-NO-SERIAL` | Firefox 等、`serial` 無し | `Run simulator & write to Pico` が **disabled**。tooltip で Chrome/Edge + CLI 誘導 | `pico_link_check.py` を使用 |
| `UX-FAIL-NO-RESET-COMPILE` | 一度も Reset 成功していない状態で export | `No successful reset compile yet...` | 先に Reset & run |
| `UX-FAIL-PKG-BUILD` | 推定 package 化できない script | `FAIL: could not build PicoRuntimePackage...` | IR 対応範囲を確認（handoff matrix） |
| `UX-FAIL-LOADER` | `KIBO_PING` 後も `protocol=1` 行が無い | `Pico loader did not respond...` + 直近シリアル行 | UF2 を再書き込み（`install_pico_loader.py`）、他ツールのポート占有を解除 |
| `UX-FAIL-ACK` | package 送信後 ack なし | `Pico did not acknowledge...` | 行長超過・旧 FW・ボーレート不一致を疑う |
| `UX-FAIL-TRACE` | ack は OK だが trace が一致しない | `Pico trace did not match simulator replay...` expected / actual を表示 | TS replay golden と Pico の `live.tick` / `replay.steps` の推定がズレていないか確認 |
| `UX-FAIL-PORT` | 誤ポートを選択 | loader 行が出ない / 無関係デバイスのゴミ | `pico_link_doctor.py --port auto` で再特定 |

## 競合: シリアルモニタ

| ID | 状況 | 期待 |
| --- | --- | --- |
| `UX-RACE-MONITOR-001` | PlatformIO Serial Monitor がオープン | Web Serial / CLI のいずれも **Permission / open 失敗**しうる | モニタを閉じる旨を README / UI に明示（CLI は `pico_link_common` が Windows hint を出す） |

## E2E に載せるべき smoke（提案）

- **UI なし**: 既存 Playwright の範囲でコンパイルとシミュレータ表示。
- **実機あり**（任意ジョブ）: `pico_link_check.py --package-file ...` を 1 本だけ回す。

## `Fix first` 候補（メッセージ改善リスト）

- ~~loader 不在時に **UF2 手順 URL / コマンド**を result パネルへ常時同梱（現状はエラー文のみ）。~~ → **対応済み**（`script-runner-view.ts` の recovery フッタ + 常時 CLI hint）。
- ~~trace 不一致時に **`--trace-var` の CLI 例**を自動で併記（download package フローと揃える）。~~ → **対応済み**（trace mismatch 時に `pico_link_check.py --repo-root .` + `--trace-var` を併記）。
