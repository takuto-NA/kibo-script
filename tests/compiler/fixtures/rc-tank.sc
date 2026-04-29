task spin every 64ms {
  do motor#0.power(50)
  do motor#1.power(-20)
  temp r = read imu#0.roll
  do serial#0.println(r)
}
