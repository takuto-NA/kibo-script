ref led = led#0

task blink every 1000deg {
  do led.toggle()
}
