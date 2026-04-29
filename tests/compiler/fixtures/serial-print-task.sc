ref port = serial#0

task talk every 500ms {
  do port.println("hi")
}
