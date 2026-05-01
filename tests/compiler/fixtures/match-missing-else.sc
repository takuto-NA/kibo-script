var command = "x"

task t on button#0.pressed {
  match command {
    "a" => { do led#0.on() }
  }
}
