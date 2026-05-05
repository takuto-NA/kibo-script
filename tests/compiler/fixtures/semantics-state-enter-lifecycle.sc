// 責務: `sm.B` への遷移時に `on enter` が同期実行され、`flag` が trace で確認できる最小例。

var flag = 0

state sm every 100ms initial sm.A {
  A {
    on 1 -> sm.B
  }
  B {}
}

task mark in sm.B on enter {
  set flag = 1
}
