/**
 * 責務: ブラウザ上で Rapier WASM の初期化を試み、失敗時は Noop へ退避して Script 実行を継続可能にする。
 */

import { NoopPhysicsWorld } from "./noop-physics-world";
import type { PhysicsWorld } from "./physics-world";

export async function createPhysicsWorldForBrowser(): Promise<PhysicsWorld> {
  try {
    const rapierModule = await import("./rapier-physics-world");
    return await rapierModule.RapierPhysicsWorld.create();
  } catch {
    return new NoopPhysicsWorld();
  }
}
