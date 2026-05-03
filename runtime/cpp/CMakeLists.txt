cmake_minimum_required(VERSION 3.20)

project(kibo_runtime_replay LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(kibo_runtime_replay
  src/kibo_runtime_replay_main.cpp
  src/kibo_runtime_replay_runner.cpp
  src/kibo_host_runtime.cpp
)

target_include_directories(kibo_runtime_replay PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
  "${CMAKE_CURRENT_SOURCE_DIR}/vendor"
)

if (MSVC)
  target_compile_options(kibo_runtime_replay PRIVATE /W4 /permissive-)
else()
  target_compile_options(kibo_runtime_replay PRIVATE -Wall -Wextra -Wpedantic)
endif()
