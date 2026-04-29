export type InteractiveCommand =
  | {
      kind: "read";
      target: string;
    }
  | {
      kind: "property_read";
      target: string;
      property: string;
    }
  | {
      kind: "do_serial_println";
      text: string;
    }
  | {
      kind: "do_display_clear";
    }
  | {
      kind: "do_display_pixel";
      x: number;
      y: number;
    }
  | {
      kind: "do_display_line";
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
  | {
      kind: "do_display_circle";
      centerX: number;
      centerY: number;
      radius: number;
    }
  | {
      kind: "do_display_present";
    }
  | {
      kind: "do_led_effect";
      ledId: number;
      ledEffect: "on" | "off" | "toggle";
    }
  | {
      kind: "do_pwm_level";
      pwmId: number;
      levelPercent: number;
    }
  | {
      kind: "list_tasks";
    }
  | {
      kind: "show_task";
      name: string;
    }
  | {
      kind: "stop_task";
      name: string;
    }
  | {
      kind: "start_task";
      name: string;
    }
  | {
      kind: "drop_task";
      name: string;
    }
  | {
      kind: "register_task_every";
      name: string;
      intervalMs: number;
      body: string;
    }
  | {
      kind: "help";
    };
