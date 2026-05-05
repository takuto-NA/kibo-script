// 責務: 5 ボタンで preset（0–4）を選ぶ。state machine は Tuned/Mute の 2 状態と global 遷移のみ。表示文字列は `apply_button_requests` が単一更新（IR 削減・Pico package 制限内を狙う）。

var band = 0
var label = "NW"
var news_button_presses = 0
var jazz_button_presses = 0
var weather_button_presses = 0
var rock_button_presses = 0
var standby_button_presses = 0
var seen_news_button_presses = 0
var seen_jazz_button_presses = 0
var seen_weather_button_presses = 0
var seen_rock_button_presses = 0
var seen_standby_button_presses = 0

state radio every 200ms initial radio.Tuned {
  on band == 4 -> radio.Mute
  on band == 0 -> radio.Tuned
  on band == 1 -> radio.Tuned
  on band == 2 -> radio.Tuned
  on band == 3 -> radio.Tuned

  Tuned {
  }

  Mute {
  }
}

task preset_news on button#0.pressed {
  set news_button_presses = news_button_presses + 1
}

task preset_jazz on button#1.pressed {
  set jazz_button_presses = jazz_button_presses + 1
}

task preset_weather on button#2.pressed {
  set weather_button_presses = weather_button_presses + 1
}

task preset_rock on button#3.pressed {
  set rock_button_presses = rock_button_presses + 1
}

task preset_standby on button#4.pressed {
  set standby_button_presses = standby_button_presses + 1
}

task apply_button_requests every 200ms {
  if news_button_presses > seen_news_button_presses {
    set band = 0
    set label = "NW"
    set seen_news_button_presses = news_button_presses
  } else {
  }

  if jazz_button_presses > seen_jazz_button_presses {
    set band = 1
    set label = "JZ"
    set seen_jazz_button_presses = jazz_button_presses
  } else {
  }

  if weather_button_presses > seen_weather_button_presses {
    set band = 2
    set label = "WX"
    set seen_weather_button_presses = weather_button_presses
  } else {
  }

  if rock_button_presses > seen_rock_button_presses {
    set band = 3
    set label = "RK"
    set seen_rock_button_presses = rock_button_presses
  } else {
  }

  if standby_button_presses > seen_standby_button_presses {
    set band = 4
    set label = "--"
    set seen_standby_button_presses = standby_button_presses
  } else {
  }
}

task render_radio every 200ms {
  do display#0.clear()
  do display#0.text(0, 0, label)
  do display#0.present()
}
