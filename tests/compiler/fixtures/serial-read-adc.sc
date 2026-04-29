ref port = serial#0

task monitor every 100ms {
  do port.println(read adc#0)
}
