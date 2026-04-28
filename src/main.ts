/**
 * StaticCore Script browser simulator — entry: mounts DOM UI and embed bridge.
 */

import { createSimulatorView } from "./ui/simulator-view";

createSimulatorView({
  rootElementId: "app",
});
