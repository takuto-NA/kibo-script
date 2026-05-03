// 責務: `replay.json` を読み、C++ host runtime で trace 行を stdout に出力する CLI（TypeScript conformance と突き合わせる）。

#include "kibo_runtime_replay_runner.hpp"

#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

#include <nlohmann/json.hpp>

namespace {

std::string read_text_file_or_throw(const std::string& file_path) {
  std::ifstream input_stream(file_path, std::ios::binary);
  if (!input_stream) {
    std::ostringstream oss;
    oss << "Failed to open file: " << file_path;
    throw std::runtime_error(oss.str());
  }
  std::ostringstream buffer;
  buffer << input_stream.rdbuf();
  return buffer.str();
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: kibo_runtime_replay <replay.json path>\n";
    return 2;
  }

  try {
    const std::string file_path = argv[1];
    const std::string file_text = read_text_file_or_throw(file_path);
    const nlohmann::json replay_document = nlohmann::json::parse(file_text);

    kibo::runtime::run_runtime_conformance_replay_document(replay_document, [](const std::string& trace_line) {
      std::cout << trace_line << '\n';
    });

    return 0;
  } catch (const std::exception& exception) {
    std::cerr << "kibo_runtime_replay failed: " << exception.what() << '\n';
    return 1;
  }
}
