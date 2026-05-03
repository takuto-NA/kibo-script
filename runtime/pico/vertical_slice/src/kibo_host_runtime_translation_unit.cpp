// 責務: PlatformIO が `runtime/cpp` の共通 host runtime 実装を vertical slice firmware にリンクできるようにする。
//
// 注意: ここでは実装を複製せず、共通ソースを 1 translation unit として取り込む。

#include "../../../cpp/src/kibo_host_runtime.cpp"
