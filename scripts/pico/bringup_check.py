# pyright: reportMissingImports=false
"""
Responsibility: run Raspberry Pi Pico bring-up checks for Kibo Script hardware notes.

This script is a MicroPython-only verification tool, not the future Pico runtime.
It intentionally keeps the SSD1306 driver code in this file so a first-time
MicroPython reader can see how GPIO, I2C, framebuffer drawing, and OLED refresh
fit together.

Run it from the host with:

    uvx mpremote connect COM10 run scripts/pico/bringup_check.py
"""

# `machine` is a MicroPython module. It exposes Pico hardware such as GPIO pins
# and I2C buses. Desktop Python does not provide it.
from machine import Pin, SoftI2C

# `framebuf` is MicroPython's small 1-bit/8-bit framebuffer drawing helper.
# We draw into RAM first, then send the framebuffer to the OLED with `show()`.
import framebuf
import time


DISPLAY_WIDTH_PIXELS = 128
DISPLAY_HEIGHT_PIXELS = 64
I2C_ADDRESS_SSD1306 = 0x3C

# OLED wiring confirmed on this board:
# physical PIN21 = GP16 = SDA, physical PIN22 = GP17 = SCL.
OLED_SDA_GPIO_PIN_NUMBER = 16
OLED_SCL_GPIO_PIN_NUMBER = 17

# Pico's onboard LED is GP25 on the original Raspberry Pi Pico.
ONBOARD_LED_GPIO_PIN_NUMBER = 25

# Buttons are wired to ground, so the internal pull-up reads 1 normally and 0
# while pressed.
BUTTON_PRESSED_VALUE = 0

# SSD1306 I2C protocol control bytes:
# 0x80 means "the following byte is a command".
# 0x40 means "the following bytes are framebuffer data".
SSD1306_CONTROL_BYTE_COMMAND = 0x80
SSD1306_CONTROL_BYTE_DATA = b"\x40"

LED_BLINK_COUNT = 4
LED_BLINK_INTERVAL_SECONDS = 0.15
SCREEN_SHORT_CHECK_SECONDS = 4
SCREEN_LONG_CHECK_SECONDS = 8
BUTTON_MONITOR_SECONDS = 30
BUTTON_POLL_INTERVAL_SECONDS = 0.08

BUTTON_INPUTS = [
    # Tuples are `(label shown on OLED, Pico GPIO number)`.
    # These labels are physical pin labels from the board wiring notes.
    ("PIN24", 18),
    ("PIN25", 19),
    ("PIN26", 20),
    ("PIN27", 21),
    ("PIN29", 22),
]


class SSD1306Display:
    """Tiny SSD1306 helper for bring-up checks.

    Kibo Script's simulator keeps a draft display buffer and only makes it
    visible when `present()` runs. This class mirrors that shape: drawing
    methods only update `self.buffer`; `show()` sends the buffer to the OLED.
    """

    def __init__(self, width_pixels, height_pixels, i2c_bus, i2c_address):
        self.width_pixels = width_pixels
        self.height_pixels = height_pixels
        self.i2c_bus = i2c_bus
        self.i2c_address = i2c_address

        # SSD1306 stores pixels in pages of 8 vertical pixels. A 128x64 display
        # therefore has 8 pages, each containing 128 bytes.
        self.page_count = self.height_pixels // 8
        self.buffer = bytearray(self.page_count * self.width_pixels)

        # MONO_VLSB is the SSD1306-friendly bit layout: each byte represents a
        # vertical column of 8 pixels, least significant bit at the top.
        self.framebuffer = framebuf.FrameBuffer(
            self.buffer,
            self.width_pixels,
            self.height_pixels,
            framebuf.MONO_VLSB,
        )
        self.initialize_display()

    def write_command(self, command):
        self.i2c_bus.writeto(
            self.i2c_address,
            bytearray([SSD1306_CONTROL_BYTE_COMMAND, command]),
        )

    def initialize_display(self):
        # These are standard SSD1306 setup commands for a 128x64 module:
        # addressing mode, segment/com scan direction, contrast, charge pump,
        # and finally display-on. Keeping the list explicit makes hardware
        # bring-up easier to compare with datasheets and examples.
        initialization_commands = [
            0xAE,
            0x20,
            0x00,
            0x40,
            0xA1,
            0xA8,
            self.height_pixels - 1,
            0xC8,
            0xD3,
            0x00,
            0xDA,
            0x12,
            0xD5,
            0x80,
            0xD9,
            0xF1,
            0xDB,
            0x30,
            0x81,
            0xCF,
            0xA4,
            0xA6,
            0x8D,
            0x14,
            0xAF,
        ]
        for command in initialization_commands:
            self.write_command(command)
        self.fill(0)
        self.show()

    def fill(self, color):
        self.framebuffer.fill(color)

    def text(self, text, x_position, y_position, color=1):
        self.framebuffer.text(text, x_position, y_position, color)

    def pixel(self, x_position, y_position, color=1):
        # Guard: simulator display#0 ignores out-of-range pixels, so the Pico
        # bring-up script does the same instead of raising an exception.
        if x_position < 0 or x_position >= self.width_pixels:
            return
        if y_position < 0 or y_position >= self.height_pixels:
            return
        self.framebuffer.pixel(x_position, y_position, color)

    def line(self, x_start, y_start, x_end, y_end, color=1):
        self.framebuffer.line(x_start, y_start, x_end, y_end, color)

    def rect(self, x_position, y_position, width_pixels, height_pixels, color=1):
        self.framebuffer.rect(x_position, y_position, width_pixels, height_pixels, color)

    def fill_rect(self, x_position, y_position, width_pixels, height_pixels, color=1):
        self.framebuffer.fill_rect(
            x_position,
            y_position,
            width_pixels,
            height_pixels,
            color,
        )

    def show(self):
        # `show()` is the physical equivalent of simulator `display#0.present()`.
        # It copies the RAM framebuffer to the OLED over I2C, one 8-pixel page
        # at a time. Until this runs, drawing operations are not visible.
        for page_index in range(self.page_count):
            self.write_command(0xB0 | page_index)
            self.write_command(0x00)
            self.write_command(0x10)
            start_index = self.width_pixels * page_index
            end_index = start_index + self.width_pixels
            self.i2c_bus.writeto(
                self.i2c_address,
                SSD1306_CONTROL_BYTE_DATA + self.buffer[start_index:end_index],
            )


def blink_onboard_led():
    """Verify that MicroPython can control a basic GPIO output."""

    led_pin = Pin(ONBOARD_LED_GPIO_PIN_NUMBER, Pin.OUT)
    for _ in range(LED_BLINK_COUNT):
        led_pin.toggle()
        time.sleep(LED_BLINK_INTERVAL_SECONDS)
    led_pin.off()
    print("led_check_done")


def create_i2c_bus():
    """Create an I2C bus using software bit-banging on the confirmed pins.

    SoftI2C is slower than a hardware I2C peripheral but very convenient for
    bring-up because the selected GPIO pins are explicit and easy to change.
    """

    return SoftI2C(
        sda=Pin(OLED_SDA_GPIO_PIN_NUMBER),
        scl=Pin(OLED_SCL_GPIO_PIN_NUMBER),
        freq=400000,
    )


def scan_i2c_devices(i2c_bus):
    """List device addresses visible on the I2C bus.

    A working SSD1306 module usually appears as 0x3C or 0x3D. This board was
    confirmed at 0x3C.
    """

    device_addresses = i2c_bus.scan()
    hex_addresses = [hex(device_address) for device_address in device_addresses]
    print("i2c_addresses", hex_addresses)
    return device_addresses


def create_display(i2c_bus):
    return SSD1306Display(
        DISPLAY_WIDTH_PIXELS,
        DISPLAY_HEIGHT_PIXELS,
        i2c_bus,
        I2C_ADDRESS_SSD1306,
    )


def draw_corner_marker(display, center_x, center_y):
    display.rect(center_x - 2, center_y - 2, 5, 5, 1)
    display.pixel(center_x, center_y, 0)


def show_coordinate_check(display):
    """Display labels that prove simulator and OLED coordinates match."""

    display.fill(0)
    display.rect(0, 0, DISPLAY_WIDTH_PIXELS, DISPLAY_HEIGHT_PIXELS, 1)
    display.line(0, 0, DISPLAY_WIDTH_PIXELS - 1, DISPLAY_HEIGHT_PIXELS - 1, 1)
    display.line(0, DISPLAY_HEIGHT_PIXELS - 1, DISPLAY_WIDTH_PIXELS - 1, 0, 1)
    display.line(64, 0, 64, DISPLAY_HEIGHT_PIXELS - 1, 1)
    display.line(0, 32, DISPLAY_WIDTH_PIXELS - 1, 32, 1)
    draw_corner_marker(display, 3, 3)
    draw_corner_marker(display, 124, 3)
    draw_corner_marker(display, 3, 60)
    draw_corner_marker(display, 124, 60)
    display.text("0,0", 8, 2)
    display.text("127,0", 82, 2)
    display.text("0,63", 8, 54)
    display.text("127,63", 74, 54)
    display.text("CENTER", 40, 28)
    display.show()
    print("coordinate_check_displayed")
    time.sleep(SCREEN_LONG_CHECK_SECONDS)


def show_present_check(display):
    """Check that draft framebuffer updates are invisible until `show()`."""

    display.fill(0)
    display.rect(0, 0, DISPLAY_WIDTH_PIXELS, DISPLAY_HEIGHT_PIXELS, 1)
    display.text("PRESENT CHECK", 8, 8)
    display.text("visible BEFORE", 8, 26)
    display.show()
    print("present_before_visible")
    time.sleep(SCREEN_SHORT_CHECK_SECONDS)

    display.fill(0)
    display.fill_rect(0, 0, DISPLAY_WIDTH_PIXELS, DISPLAY_HEIGHT_PIXELS, 1)
    display.text("DRAFT WRITTEN", 8, 8, 0)
    display.text("not visible yet", 8, 26, 0)
    display.text("until show()", 20, 44, 0)
    print("present_draft_written")
    time.sleep(SCREEN_SHORT_CHECK_SECONDS)

    display.show()
    print("present_after_show")
    time.sleep(SCREEN_SHORT_CHECK_SECONDS)


def draw_circle_midpoint(display, center_x, center_y, radius):
    """Draw the same midpoint-circle style primitive used by the simulator."""

    if radius < 0:
        return
    x_position = 0
    y_position = radius
    decision = 1 - radius
    while x_position <= y_position:
        plot_circle_points(display, center_x, center_y, x_position, y_position)
        x_position += 1
        if decision < 0:
            decision += 2 * x_position + 1
            continue
        y_position -= 1
        decision += 2 * (x_position - y_position) + 1


def plot_circle_points(display, center_x, center_y, x_offset, y_offset):
    display.pixel(center_x + x_offset, center_y + y_offset)
    display.pixel(center_x - x_offset, center_y + y_offset)
    display.pixel(center_x + x_offset, center_y - y_offset)
    display.pixel(center_x - x_offset, center_y - y_offset)
    display.pixel(center_x + y_offset, center_y + x_offset)
    display.pixel(center_x - y_offset, center_y + x_offset)
    display.pixel(center_x + y_offset, center_y - x_offset)
    display.pixel(center_x - y_offset, center_y - x_offset)


def show_primitives_check(display):
    """Show the current simulator display primitives on the physical OLED."""

    display.fill(0)
    display.text("Primitives", 24, 0)
    for x_position, y_position in [
        (0, 0),
        (127, 0),
        (0, 63),
        (127, 63),
        (10, 20),
        (64, 32),
        (100, 45),
    ]:
        display.pixel(x_position, y_position)
    display.line(0, 12, 127, 12)
    display.line(0, 63, 127, 20)
    display.line(0, 20, 127, 63)
    display.line(64, 14, 64, 63)
    draw_circle_midpoint(display, 32, 40, 8)
    draw_circle_midpoint(display, 96, 40, 14)
    draw_circle_midpoint(display, 127, 32, 10)
    display.show()
    print("primitives_check_displayed")
    time.sleep(SCREEN_LONG_CHECK_SECONDS)


def show_button_monitor(display):
    """Display button states live on the OLED and print changes to the host."""

    button_pins = [
        # Pin.IN reads the voltage. Pin.PULL_UP enables Pico's internal resistor
        # so an unpressed button reads 1 without needing an external pull-up.
        (button_label, Pin(gpio_pin_number, Pin.IN, Pin.PULL_UP))
        for button_label, gpio_pin_number in BUTTON_INPUTS
    ]
    start_time = time.ticks_ms()
    last_console_line = ""
    print("button_monitor_start")
    while time.ticks_diff(time.ticks_ms(), start_time) < BUTTON_MONITOR_SECONDS * 1000:
        elapsed_seconds = time.ticks_diff(time.ticks_ms(), start_time) // 1000
        remaining_seconds = BUTTON_MONITOR_SECONDS - elapsed_seconds
        display.fill(0)
        display.text("Buttons", 36, 0)
        display.text("left {:02d}s".format(remaining_seconds), 40, 54)
        console_states = []
        for row_index, (button_label, button_pin) in enumerate(button_pins):
            is_pressed = button_pin.value() == BUTTON_PRESSED_VALUE
            draw_button_state(display, row_index, button_label, is_pressed)
            console_states.append(button_label + (":ON" if is_pressed else ":off"))
        display.show()
        console_line = " ".join(console_states)
        if console_line != last_console_line:
            print(console_line)
            last_console_line = console_line
        time.sleep(BUTTON_POLL_INTERVAL_SECONDS)
    print("button_monitor_done")


def draw_button_state(display, row_index, button_label, is_pressed):
    row_y_position = 12 + row_index * 10
    display.text(button_label, 4, row_y_position)
    display.text("ON" if is_pressed else "off", 54, row_y_position)
    display.rect(92, row_y_position - 1, 22, 9, 1)
    display.fill_rect(94, row_y_position + 1, 18, 5, 1 if is_pressed else 0)


def main():
    """Run checks from simple hardware outward: GPIO, I2C, OLED, then buttons."""

    print("pico_bringup_check_start")
    blink_onboard_led()
    i2c_bus = create_i2c_bus()
    scan_i2c_devices(i2c_bus)
    display = create_display(i2c_bus)
    show_coordinate_check(display)
    show_present_check(display)
    show_primitives_check(display)
    show_button_monitor(display)
    print("pico_bringup_check_done")


main()
