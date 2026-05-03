// 責務: Raspberry Pi Pico 上で C++17 言語機能と標準ライブラリの可否を確認し、簡易 microbenchmark を USB Serial に出力する。
//
// 注意:
// - Arduino framework は USB Serial / micros() / setup-loop の薄い harness としてだけ使う。
// - timed loop 内では Serial 出力をしない。測定の前後にだけ出力する。

#include <Arduino.h>

#include <array>
#include <cstdint>
#include <functional>
#include <optional>
#include <string_view>
#include <tuple>
#include <variant>

volatile uint32_t g_benchmarkSink = 0;

namespace {

constexpr uint32_t SERIAL_BAUD_RATE = 115200;
constexpr uint32_t SERIAL_STABILIZE_DELAY_MILLISECONDS = 500;

constexpr char FEATURE_MATRIX_LINE_TEXT[] =
    "feature_matrix language=cpp17 stdlib=array,optional,variant,string_view,tuple,function";

constexpr uint32_t BENCHMARK_WARMUP_ITERATIONS = 200;
constexpr uint32_t BENCHMARK_TRIAL_COUNT = 7;
constexpr uint32_t BENCHMARK_WORK_ITERATIONS = 200000;

constexpr size_t BYTECODE_DISPATCH_TABLE_SIZE = 256;
constexpr uint32_t BYTECODE_DISPATCH_REPEAT_COUNT = 200000;

constexpr size_t VARIANT_CASE_COUNT = 8;
constexpr uint32_t VARIANT_VISIT_REPEAT_COUNT = 200000;

constexpr size_t FUNCTION_DISPATCH_TABLE_SIZE = 8;
constexpr uint32_t FUNCTION_DISPATCH_REPEAT_COUNT = 200000;

constexpr size_t VIRTUAL_DISPATCH_TABLE_SIZE = 8;
constexpr uint32_t VIRTUAL_DISPATCH_REPEAT_COUNT = 200000;

constexpr size_t SCHEDULER_TASK_COUNT = 8;
constexpr uint32_t SCHEDULER_TICK_REPEAT_COUNT = 200000;

constexpr uint32_t ONBOARD_LED_GPIO_PIN_NUMBER = 25;
constexpr uint32_t ONBOARD_LED_BLINK_HALF_PERIOD_MILLISECONDS = 120;
constexpr uint32_t ONBOARD_LED_BLINK_CYCLE_COUNT = 6;

constexpr size_t PROBE_USB_SUMMARY_BUFFER_RESERVE_CAPACITY_BYTES = 2048;
constexpr uint32_t PROBE_USB_SUMMARY_REPEAT_INTERVAL_MILLISECONDS = 1000;

constexpr size_t BENCHMARK_RESULT_LINE_RESERVE_CAPACITY_BYTES = 192;
constexpr uint64_t NANOSECONDS_FRACTION_PART_PAD_THRESHOLD_HUNDREDTHS = 100;
constexpr uint64_t NANOSECONDS_FRACTION_PART_PAD_THRESHOLD_TENTHS = 10;

// ---- C++17 compile-time checks (language) ----

constexpr int constexprAdd(int left, int right) {
  return left + right;
}

static_assert(constexprAdd(2, 3) == 5, "constexprAdd must match expected sum.");

template <typename... Values>
constexpr int constexprFoldSum(Values... values) {
  return (0 + ... + static_cast<int>(values));
}

static_assert(constexprFoldSum(1, 2, 3, 4) == 10, "fold expression sum must match expected total.");

template <int value>
constexpr int sumDownToZero() {
  int accumulator = 0;
  for (int current = value; current > 0; current -= 1) {
    accumulator += current;
  }
  return accumulator;
}

static_assert(sumDownToZero<3>() == 6, "compile-time loop sum must match expected total.");

constexpr int compileTimeIfConstexprSelectedSum() {
  constexpr int leftOperand = 3;
  constexpr int rightOperand = 4;
  if constexpr (leftOperand < rightOperand) {
    return leftOperand + rightOperand;
  }
  return 0;
}

static_assert(compileTimeIfConstexprSelectedSum() == 7,
              "if constexpr selected branch must return expected sum.");

struct DeducedTemplateArgumentTag {};

template <typename Type>
struct Wrapper {
  Type value;
};

void classTemplateArgumentDeductionSmoke() {
  Wrapper<DeducedTemplateArgumentTag> wrapper{DeducedTemplateArgumentTag{}};
  static_cast<void>(wrapper);
}

void structuredBindingsSmoke() {
  const std::tuple<int, int> point{10, 20};
  const auto [x, y] = point;
  static_cast<void>(x);
  static_cast<void>(y);
}

void ifConstexprRuntimeSmoke() {
  constexpr int leftOperand = 3;
  constexpr int rightOperand = 4;
  int branchResult = 0;
  if constexpr (leftOperand < rightOperand) {
    branchResult = leftOperand + rightOperand;
  } else {
    branchResult = 0;
  }
  static_cast<void>(branchResult);
}

// ---- C++17 compile-time checks (standard library) ----

void standardLibraryTypeSmoke() {
  const std::array<int, 3> values{1, 2, 3};
  static_cast<void>(values);

  const std::optional<int> maybeValue = 42;
  static_cast<void>(maybeValue.has_value());

  using Payload = std::variant<int, float>;
  const Payload payload = 3.14F;
  static_cast<void>(payload.index());

  const std::string_view label = "kibo_cpp17_probe";
  static_cast<void>(label.size());

  const std::function<int(int)> doubler = [](int value) { return value * 2; };
  static_cast<void>(doubler(21));
}

// ---- Benchmark helpers ----

uint32_t elapsedMicrosecondsSince(uint32_t startMicroseconds) {
  const uint32_t nowMicroseconds = micros();
  return nowMicroseconds - startMicroseconds;
}

uint32_t measureMicrosecondsForIterations(const std::function<void()> &workBody, uint32_t iterationCount) {
  for (uint32_t warmupIndex = 0; warmupIndex < BENCHMARK_WARMUP_ITERATIONS; warmupIndex += 1) {
    workBody();
  }

  uint32_t bestElapsedMicroseconds = UINT32_MAX;
  for (uint32_t trialIndex = 0; trialIndex < BENCHMARK_TRIAL_COUNT; trialIndex += 1) {
    const uint32_t startMicroseconds = micros();
    for (uint32_t iterationIndex = 0; iterationIndex < iterationCount; iterationIndex += 1) {
      workBody();
    }
    const uint32_t elapsedMicroseconds = elapsedMicrosecondsSince(startMicroseconds);
    if (elapsedMicroseconds < bestElapsedMicroseconds) {
      bestElapsedMicroseconds = elapsedMicroseconds;
    }
  }

  return bestElapsedMicroseconds;
}

uint32_t measureEmptyLoopMicroseconds(uint32_t iterationCount) {
  const auto emptyLoopBody = [&]() {
    // Intentionally empty: measures loop overhead only.
  };
  return measureMicrosecondsForIterations(emptyLoopBody, iterationCount);
}

String buildBenchmarkResultLineText(const char *benchmarkName,
                                    uint32_t iterationCount,
                                    uint32_t grossMicroseconds,
                                    uint32_t emptyLoopMicroseconds) {
  if (iterationCount == 0) {
    return String("benchmark_error iteration_count_is_zero");
  }

  const uint32_t netMicroseconds = grossMicroseconds - emptyLoopMicroseconds;
  const uint64_t totalNanoseconds =
      static_cast<uint64_t>(netMicroseconds) * static_cast<uint64_t>(1000);
  const uint64_t nanosecondsPerIterationTimes1000 =
      (totalNanoseconds * static_cast<uint64_t>(1000)) / static_cast<uint64_t>(iterationCount);
  const uint64_t nanosecondsPerIterationIntegerPart = nanosecondsPerIterationTimes1000 / static_cast<uint64_t>(1000);
  const uint64_t nanosecondsPerIterationFractionPart = nanosecondsPerIterationTimes1000 % static_cast<uint64_t>(1000);

  String line;
  line.reserve(BENCHMARK_RESULT_LINE_RESERVE_CAPACITY_BYTES);
  line.concat("benchmark ");
  line.concat(benchmarkName);
  line.concat(" iterations=");
  line.concat(static_cast<unsigned int>(iterationCount));
  line.concat(" gross_us=");
  line.concat(static_cast<unsigned int>(grossMicroseconds));
  line.concat(" empty_loop_us=");
  line.concat(static_cast<unsigned int>(emptyLoopMicroseconds));
  line.concat(" net_us=");
  line.concat(static_cast<unsigned int>(netMicroseconds));
  line.concat(" ns_per_iteration=");
  line.concat(static_cast<unsigned int>(nanosecondsPerIterationIntegerPart));
  line.concat(".");
  if (nanosecondsPerIterationFractionPart < NANOSECONDS_FRACTION_PART_PAD_THRESHOLD_HUNDREDTHS) {
    line.concat("0");
  }
  if (nanosecondsPerIterationFractionPart < NANOSECONDS_FRACTION_PART_PAD_THRESHOLD_TENTHS) {
    line.concat("0");
  }
  line.concat(static_cast<unsigned int>(nanosecondsPerIterationFractionPart));
  return line;
}

void emitBenchmarkResultLineToSerialAndOptionalSummary(String *summaryBuilderOptional,
                                                       const char *benchmarkName,
                                                       uint32_t iterationCount,
                                                       uint32_t grossMicroseconds,
                                                       uint32_t emptyLoopMicroseconds) {
  const String line =
      buildBenchmarkResultLineText(benchmarkName, iterationCount, grossMicroseconds, emptyLoopMicroseconds);
  Serial.println(line);
  if (summaryBuilderOptional == nullptr) {
    // Guard: allow Serial-only emission if a future call site does not need the USB summary buffer.
    return;
  }
  summaryBuilderOptional->concat(line.c_str());
  summaryBuilderOptional->concat("\n");
}

void runArrayScanBenchmark(uint32_t emptyLoopMicroseconds, String *summaryBuilder) {
  std::array<uint8_t, BYTECODE_DISPATCH_TABLE_SIZE> table{};
  for (size_t tableIndex = 0; tableIndex < table.size(); tableIndex += 1) {
    table[tableIndex] = static_cast<uint8_t>(tableIndex & 0xFF);
  }

  const auto workBody = [&]() {
    uint32_t accumulator = 0;
    for (size_t tableIndex = 0; tableIndex < table.size(); tableIndex += 1) {
      accumulator += table[tableIndex];
    }
    g_benchmarkSink ^= accumulator;
  };

  const uint32_t grossMicroseconds =
      measureMicrosecondsForIterations(workBody, BENCHMARK_WORK_ITERATIONS);
  emitBenchmarkResultLineToSerialAndOptionalSummary(
      summaryBuilder, "array_scan", BENCHMARK_WORK_ITERATIONS, grossMicroseconds, emptyLoopMicroseconds);
}

void runBytecodeSwitchBenchmark(uint32_t emptyLoopMicroseconds, String *summaryBuilder) {
  std::array<uint8_t, BYTECODE_DISPATCH_TABLE_SIZE> opcodes{};
  for (size_t opcodeIndex = 0; opcodeIndex < opcodes.size(); opcodeIndex += 1) {
    opcodes[opcodeIndex] = static_cast<uint8_t>(opcodeIndex % 7);
  }

  const auto workBody = [&]() {
    uint32_t accumulator = 0;
    for (uint32_t repeatIndex = 0; repeatIndex < BYTECODE_DISPATCH_REPEAT_COUNT; repeatIndex += 1) {
      const uint8_t opcode = opcodes[repeatIndex & (BYTECODE_DISPATCH_TABLE_SIZE - 1)];
      switch (opcode) {
        case 0:
          accumulator += 1;
          break;
        case 1:
          accumulator += 2;
          break;
        case 2:
          accumulator += 3;
          break;
        case 3:
          accumulator += 4;
          break;
        case 4:
          accumulator += 5;
          break;
        case 5:
          accumulator += 6;
          break;
        default:
          accumulator += 7;
          break;
      }
    }
    g_benchmarkSink ^= accumulator;
  };

  const uint32_t grossMicroseconds = measureMicrosecondsForIterations(workBody, 1);
  emitBenchmarkResultLineToSerialAndOptionalSummary(summaryBuilder,
                                                     "bytecode_switch",
                                                     BYTECODE_DISPATCH_REPEAT_COUNT,
                                                     grossMicroseconds,
                                                     emptyLoopMicroseconds);
}

void runVariantVisitBenchmark(uint32_t emptyLoopMicroseconds, String *summaryBuilder) {
  std::array<std::variant<uint8_t, uint16_t, uint32_t>, VARIANT_CASE_COUNT> cases{};
  for (size_t caseIndex = 0; caseIndex < cases.size(); caseIndex += 1) {
    if ((caseIndex % 3) == 0) {
      cases[caseIndex] = static_cast<uint8_t>(caseIndex);
      continue;
    }
    if ((caseIndex % 3) == 1) {
      cases[caseIndex] = static_cast<uint16_t>(caseIndex + 10);
      continue;
    }
    cases[caseIndex] = static_cast<uint32_t>(caseIndex + 1000);
  }

  const auto workBody = [&]() {
    uint32_t accumulator = 0;
    for (uint32_t repeatIndex = 0; repeatIndex < VARIANT_VISIT_REPEAT_COUNT; repeatIndex += 1) {
      const auto &payload = cases[repeatIndex & (VARIANT_CASE_COUNT - 1)];
      accumulator += std::visit(
          [](auto value) -> uint32_t { return static_cast<uint32_t>(value); },
          payload);
    }
    g_benchmarkSink ^= accumulator;
  };

  const uint32_t grossMicroseconds = measureMicrosecondsForIterations(workBody, 1);
  emitBenchmarkResultLineToSerialAndOptionalSummary(
      summaryBuilder, "variant_visit", VARIANT_VISIT_REPEAT_COUNT, grossMicroseconds, emptyLoopMicroseconds);
}

void runStdFunctionDispatchBenchmark(uint32_t emptyLoopMicroseconds, String *summaryBuilder) {
  std::array<std::function<uint32_t(uint32_t)>, FUNCTION_DISPATCH_TABLE_SIZE> table{};
  for (size_t tableIndex = 0; tableIndex < table.size(); tableIndex += 1) {
    const uint32_t multiplier = static_cast<uint32_t>(tableIndex + 1);
    table[tableIndex] = [multiplier](uint32_t value) { return value * multiplier; };
  }

  const auto workBody = [&]() {
    uint32_t accumulator = 0;
    for (uint32_t repeatIndex = 0; repeatIndex < FUNCTION_DISPATCH_REPEAT_COUNT; repeatIndex += 1) {
      const size_t tableIndex = repeatIndex & (FUNCTION_DISPATCH_TABLE_SIZE - 1);
      accumulator += table[tableIndex](static_cast<uint32_t>(repeatIndex & 0xFF));
    }
    g_benchmarkSink ^= accumulator;
  };

  const uint32_t grossMicroseconds = measureMicrosecondsForIterations(workBody, 1);
  emitBenchmarkResultLineToSerialAndOptionalSummary(summaryBuilder,
                                                    "std_function_dispatch",
                                                    FUNCTION_DISPATCH_REPEAT_COUNT,
                                                    grossMicroseconds,
                                                    emptyLoopMicroseconds);
}

struct VirtualCallableBase {
  virtual ~VirtualCallableBase() = default;
  virtual uint32_t evaluate(uint32_t value) const = 0;
};

struct VirtualCallableMultiply final : public VirtualCallableBase {
  explicit VirtualCallableMultiply(uint32_t multiplier) : multiplier(multiplier) {}
  uint32_t evaluate(uint32_t value) const final { return value * multiplier; }
  uint32_t multiplier;
};

void runVirtualDispatchBenchmark(uint32_t emptyLoopMicroseconds, String *summaryBuilder) {
  std::array<VirtualCallableMultiply, VIRTUAL_DISPATCH_TABLE_SIZE> objects{
      VirtualCallableMultiply{1},
      VirtualCallableMultiply{2},
      VirtualCallableMultiply{3},
      VirtualCallableMultiply{4},
      VirtualCallableMultiply{5},
      VirtualCallableMultiply{6},
      VirtualCallableMultiply{7},
      VirtualCallableMultiply{8},
  };

  std::array<const VirtualCallableBase *, VIRTUAL_DISPATCH_TABLE_SIZE> table{};
  for (size_t tableIndex = 0; tableIndex < table.size(); tableIndex += 1) {
    table[tableIndex] = &objects[tableIndex];
  }

  const auto workBody = [&]() {
    uint32_t accumulator = 0;
    for (uint32_t repeatIndex = 0; repeatIndex < VIRTUAL_DISPATCH_REPEAT_COUNT; repeatIndex += 1) {
      const size_t tableIndex = repeatIndex & (VIRTUAL_DISPATCH_TABLE_SIZE - 1);
      accumulator += table[tableIndex]->evaluate(static_cast<uint32_t>(repeatIndex & 0xFF));
    }
    g_benchmarkSink ^= accumulator;
  };

  const uint32_t grossMicroseconds = measureMicrosecondsForIterations(workBody, 1);
  emitBenchmarkResultLineToSerialAndOptionalSummary(summaryBuilder,
                                                    "virtual_dispatch",
                                                    VIRTUAL_DISPATCH_REPEAT_COUNT,
                                                    grossMicroseconds,
                                                    emptyLoopMicroseconds);
}

void runSchedulerTickBenchmark(uint32_t emptyLoopMicroseconds, String *summaryBuilder) {
  std::array<uint32_t, SCHEDULER_TASK_COUNT> taskAccumulators{};
  for (size_t taskIndex = 0; taskIndex < taskAccumulators.size(); taskIndex += 1) {
    taskAccumulators[taskIndex] = static_cast<uint32_t>(taskIndex + 1);
  }

  const auto workBody = [&]() {
    uint32_t tickSum = 0;
    for (uint32_t tickIndex = 0; tickIndex < SCHEDULER_TICK_REPEAT_COUNT; tickIndex += 1) {
      for (size_t taskIndex = 0; taskIndex < taskAccumulators.size(); taskIndex += 1) {
        taskAccumulators[taskIndex] += static_cast<uint32_t>(taskIndex + 1);
        tickSum += taskAccumulators[taskIndex];
      }
    }
    g_benchmarkSink ^= tickSum;
  };

  const uint32_t grossMicroseconds = measureMicrosecondsForIterations(workBody, 1);
  const uint32_t innerOperationCount =
      SCHEDULER_TICK_REPEAT_COUNT * SCHEDULER_TASK_COUNT * SCHEDULER_TASK_COUNT;
  emitBenchmarkResultLineToSerialAndOptionalSummary(
      summaryBuilder, "scheduler_tick", innerOperationCount, grossMicroseconds, emptyLoopMicroseconds);
}

void blinkOnboardLedDone() {
  pinMode(ONBOARD_LED_GPIO_PIN_NUMBER, OUTPUT);
  for (uint32_t blinkIndex = 0; blinkIndex < ONBOARD_LED_BLINK_CYCLE_COUNT; blinkIndex += 1) {
    digitalWrite(ONBOARD_LED_GPIO_PIN_NUMBER, HIGH);
    delay(ONBOARD_LED_BLINK_HALF_PERIOD_MILLISECONDS);
    digitalWrite(ONBOARD_LED_GPIO_PIN_NUMBER, LOW);
    delay(ONBOARD_LED_BLINK_HALF_PERIOD_MILLISECONDS);
  }
}

} // namespace

// Guard: USB serial hosts often attach after `setup()` begins. If we only print once, the host can
// miss the entire transcript. Keep a copy of the final summary and re-print it outside benchmarks.
String g_probeSummaryText;

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  delay(SERIAL_STABILIZE_DELAY_MILLISECONDS);

  Serial.println("kibo_cpp17_probe_start");

  classTemplateArgumentDeductionSmoke();
  structuredBindingsSmoke();
  ifConstexprRuntimeSmoke();
  standardLibraryTypeSmoke();

  Serial.println(FEATURE_MATRIX_LINE_TEXT);

  String summaryBuilder{};
  summaryBuilder.reserve(PROBE_USB_SUMMARY_BUFFER_RESERVE_CAPACITY_BYTES);
  summaryBuilder.concat(FEATURE_MATRIX_LINE_TEXT);
  summaryBuilder.concat("\n");

  const uint32_t emptyLoopMicrosecondsForWorkIterations =
      measureEmptyLoopMicroseconds(BENCHMARK_WORK_ITERATIONS);
  const uint32_t emptyLoopMicrosecondsForSingleIteration = measureEmptyLoopMicroseconds(1);

  runArrayScanBenchmark(emptyLoopMicrosecondsForWorkIterations, &summaryBuilder);
  runBytecodeSwitchBenchmark(emptyLoopMicrosecondsForSingleIteration, &summaryBuilder);
  runVariantVisitBenchmark(emptyLoopMicrosecondsForSingleIteration, &summaryBuilder);
  runStdFunctionDispatchBenchmark(emptyLoopMicrosecondsForSingleIteration, &summaryBuilder);
  runVirtualDispatchBenchmark(emptyLoopMicrosecondsForSingleIteration, &summaryBuilder);
  runSchedulerTickBenchmark(emptyLoopMicrosecondsForSingleIteration, &summaryBuilder);

  Serial.print("benchmark_sink=");
  Serial.println(g_benchmarkSink);

  Serial.println("kibo_cpp17_probe_done");
  Serial.println("note_check_firmware_size_with_pio_run_t_size");

  summaryBuilder.concat("benchmark_sink=");
  summaryBuilder.concat(static_cast<unsigned int>(g_benchmarkSink));
  summaryBuilder.concat("\n");
  summaryBuilder.concat("kibo_cpp17_probe_done\n");
  summaryBuilder.concat("note_check_firmware_size_with_pio_run_t_size\n");

  g_probeSummaryText = summaryBuilder;

  blinkOnboardLedDone();
}

void loop() {
  delay(PROBE_USB_SUMMARY_REPEAT_INTERVAL_MILLISECONDS);
  if (g_probeSummaryText.length() == 0) {
    return;
  }

  Serial.println("kibo_cpp17_probe_summary_repeat");
  Serial.print(g_probeSummaryText);
  Serial.flush();
}
