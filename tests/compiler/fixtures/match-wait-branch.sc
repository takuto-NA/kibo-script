state command = "on"

task t on button#0.pressed {
  match command {
    "on" => { wait 1 ms }
    else => { do led#0.off() }
  }
}
