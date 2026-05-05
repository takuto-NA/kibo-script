// Fixture: display#0.text（GLCD 5x7）+ present（runtime conformance / C++ host parity）。

task draw_text every 100ms {
  do display#0.clear()
  do display#0.text(0, 0, "Hi")
  do display#0.present()
}
