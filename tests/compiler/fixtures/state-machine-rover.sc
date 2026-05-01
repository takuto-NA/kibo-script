var command = "manual"
var manual_ticks = 0
var avoid_entries = 0
var idle_entries = 0

state rover every 100ms initial rover.Idle {
  Idle {
    on command == "manual" -> rover.Manual
  }

  Manual {
    on rover.Manual.elapsed >= 300 -> rover.Avoid
  }

  Avoid {
    on rover.Avoid.elapsed >= 200 -> rover.Idle
  }
}

task count_manual in rover.Manual every 100ms {
  set manual_ticks = manual_ticks + 1
}

task mark_avoid in rover.Avoid on enter {
  set avoid_entries = avoid_entries + 1
}

task mark_idle in rover.Idle on enter {
  set idle_entries = idle_entries + 1
}
