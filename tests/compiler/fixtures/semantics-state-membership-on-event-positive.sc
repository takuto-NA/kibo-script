// 責務: `sm.On` 遷移後に `button#0.pressed` で LED が toggle することを trace で確定する（positive path）。
// 内容は `semantics-state-membership-on-event.sc` と同一。replay 手順のみ fixture 定義側で区別する。

ref status_led = led#0

state sm every 100ms initial sm.Off {
  Off {
    on sm.Off.elapsed >= 100 -> sm.On
  }
  On {
  }
}

task toggle_when_on in sm.On on button#0.pressed {
  do status_led.toggle()
}
