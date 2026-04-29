state n = 1

task t on button#0.pressed {
  match n {
    else => { do led#0.on() }
  }
}
