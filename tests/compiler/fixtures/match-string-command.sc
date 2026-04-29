state command = "on"

ref led = led#0

task apply_command on button#0.pressed {
  match command {
    "on" => { do led#0.on() }
    "off" => { do led#0.off() }
    else => { do serial#0.println("ERR") }
  }
}
