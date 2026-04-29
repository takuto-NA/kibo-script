ref led = led#0

task toggle_led on button#0.pressed {
  do led.toggle()
}
