// 責務: 5 つのボタンをラジオのプリセットに見立て、state machine が現在局を表し、OLED と LED を局ごとに更新する。

const title_x = 0
const title_y = 0
const frequency_y = 12
const dial_y = 34
const left_dial_x = 22
const center_dial_x = 64
const right_dial_x = 106

ref tune_led = led#0
var requested_station = "news"
var tune_count = 0

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

state radio every 100ms initial radio.News {
  News {
    on requested_station == "jazz" -> radio.Jazz
    on requested_station == "weather" -> radio.Weather
    on requested_station == "rock" -> radio.Rock
    on requested_station == "standby" -> radio.Standby
  }
  Jazz {
    on requested_station == "news" -> radio.News
    on requested_station == "weather" -> radio.Weather
    on requested_station == "rock" -> radio.Rock
    on requested_station == "standby" -> radio.Standby
  }
  Weather {
    on requested_station == "news" -> radio.News
    on requested_station == "jazz" -> radio.Jazz
    on requested_station == "rock" -> radio.Rock
    on requested_station == "standby" -> radio.Standby
  }
  Rock {
    on requested_station == "news" -> radio.News
    on requested_station == "jazz" -> radio.Jazz
    on requested_station == "weather" -> radio.Weather
    on requested_station == "standby" -> radio.Standby
  }
  Standby {
    on requested_station == "news" -> radio.News
    on requested_station == "jazz" -> radio.Jazz
    on requested_station == "weather" -> radio.Weather
    on requested_station == "rock" -> radio.Rock
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

task apply_button_requests every 50ms {
  if news_button_presses > seen_news_button_presses {
    set requested_station = "news"
    set seen_news_button_presses = news_button_presses
    set tune_count = tune_count + 1
  } else {
  }

  if jazz_button_presses > seen_jazz_button_presses {
    set requested_station = "jazz"
    set seen_jazz_button_presses = jazz_button_presses
    set tune_count = tune_count + 1
  } else {
  }

  if weather_button_presses > seen_weather_button_presses {
    set requested_station = "weather"
    set seen_weather_button_presses = weather_button_presses
    set tune_count = tune_count + 1
  } else {
  }

  if rock_button_presses > seen_rock_button_presses {
    set requested_station = "rock"
    set seen_rock_button_presses = rock_button_presses
    set tune_count = tune_count + 1
  } else {
  }

  if standby_button_presses > seen_standby_button_presses {
    set requested_station = "standby"
    set seen_standby_button_presses = standby_button_presses
    set tune_count = tune_count + 1
  } else {
  }
}

task render_news in radio.News every 100ms {
  do tune_led.off()
  do display#0.clear()
  do display#0.text(title_x, title_y, "RADIO NEWS")
  do display#0.text(title_x, frequency_y, "88.1 FM")
  do display#0.circle(left_dial_x, dial_y, 5)
  do display#0.present()
}

task render_jazz in radio.Jazz every 100ms {
  do tune_led.toggle()
  do display#0.clear()
  do display#0.text(title_x, title_y, "RADIO JAZZ")
  do display#0.text(title_x, frequency_y, "91.5 FM")
  do display#0.circle(center_dial_x, dial_y, 9)
  do display#0.present()
}

task render_weather in radio.Weather every 100ms {
  do tune_led.on()
  do display#0.clear()
  do display#0.text(title_x, title_y, "WEATHER")
  do display#0.text(title_x, frequency_y, "102.3 FM")
  do display#0.circle(right_dial_x, dial_y, 7)
  do display#0.present()
}

task render_rock in radio.Rock every 100ms {
  do tune_led.toggle()
  do display#0.clear()
  do display#0.text(title_x, title_y, "ROCK")
  do display#0.text(title_x, frequency_y, "106.7 FM")
  do display#0.circle(center_dial_x, dial_y, 13)
  do display#0.present()
}

task render_standby in radio.Standby every 100ms {
  do tune_led.off()
  do display#0.clear()
  do display#0.text(title_x, title_y, "RADIO OFF")
  do display#0.text(title_x, frequency_y, "BTN0-3")
  do display#0.circle(left_dial_x, dial_y, 3)
  do display#0.present()
}
