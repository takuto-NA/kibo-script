ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
