/**
 * 責務: three.js で `PhysicsWorld` の車体姿勢を可視化し、`led#0` の点灯状態を筐体上の発光で表現する。
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { PhysicsWorld } from "../physics/physics-world";

const CAMERA_POSITION_X = 3.2;
const CAMERA_POSITION_Y = 2.4;
const CAMERA_POSITION_Z = 3.8;
const CAMERA_LOOK_AT_Y = 0.35;
const CAMERA_FIELD_OF_VIEW_DEGREES = 52;
const CAMERA_NEAR_PLANE = 0.05;
const CAMERA_FAR_PLANE = 200;
const MIN_CAMERA_DISTANCE = 1.2;
const MAX_CAMERA_DISTANCE = 16;

const CHASSIS_SIZE_X = 0.7;
const CHASSIS_SIZE_Y = 0.24;
const CHASSIS_SIZE_Z = 0.44;

const LED_MESH_RADIUS = 0.06;
const LED_EMISSIVE_COLOR_HEX = 0x33ff66;
const LED_OFF_EMISSIVE_INTENSITY = 0;
const LED_ON_EMISSIVE_INTENSITY = 1.2;

const SERVO_ARM_LENGTH = 0.35;
const SERVO_ARM_RADIUS = 0.04;
const GRID_SIZE_METERS = 12;
const GRID_DIVISIONS = 24;
const CAMERA_FOLLOW_LERP = 0.18;
const ARENA_INNER_HALF_EXTENT_X = 5.6;
const ARENA_INNER_HALF_EXTENT_Z = 5.6;
const WALL_THICKNESS = 0.24;
const WALL_HEIGHT = 0.64;

export type PhysicsSceneView = {
  rootElement: HTMLElement;
  syncFromPhysicsWorld(physicsWorld: PhysicsWorld): void;
  setLedLit(isLit: boolean): void;
  dispose(): void;
};

export type CreatePhysicsSceneViewParams = {
  widthCssPixels: number;
  heightCssPixels: number;
};

export function createPhysicsSceneView(params: CreatePhysicsSceneViewParams): PhysicsSceneView {
  const host = document.createElement("div");
  host.className = "simulator-physics-host";

  const title = document.createElement("div");
  title.className = "simulator-display-title";
  title.textContent = "Physics — drag to orbit / wheel to zoom / right-drag to pan";

  const viewport = document.createElement("div");
  viewport.className = "simulator-physics-viewport";

  const canvas = document.createElement("canvas");
  canvas.className = "simulator-physics-canvas";
  canvas.setAttribute("data-testid", "simulator-physics-canvas");
  canvas.width = params.widthCssPixels * window.devicePixelRatio;
  canvas.height = params.heightCssPixels * window.devicePixelRatio;

  host.appendChild(title);
  viewport.appendChild(canvas);
  host.appendChild(viewport);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(params.widthCssPixels, params.heightCssPixels, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xe8eef8, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8eef8);

  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x8fa0b7, 1.25);
  scene.add(hemisphereLight);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.7);
  keyLight.position.set(4, 8, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.75);
  fillLight.position.set(-5, 4, -4);
  scene.add(fillLight);

  const aspectRatio = params.widthCssPixels / params.heightCssPixels;
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FIELD_OF_VIEW_DEGREES,
    aspectRatio,
    CAMERA_NEAR_PLANE,
    CAMERA_FAR_PLANE,
  );
  camera.position.set(CAMERA_POSITION_X, CAMERA_POSITION_Y, CAMERA_POSITION_Z);
  camera.lookAt(0, CAMERA_LOOK_AT_Y, 0);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.maxDistance = MAX_CAMERA_DISTANCE;
  controls.target.set(0, CAMERA_LOOK_AT_Y, 0);

  const groundGeometry = new THREE.BoxGeometry(24, 0.2, 24);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xc7d2e3, roughness: 0.88, metalness: 0.02 });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.position.y = -0.1;
  scene.add(groundMesh);
  const grid = new THREE.GridHelper(GRID_SIZE_METERS, GRID_DIVISIONS, 0x5b6b84, 0xa2adbd);
  grid.position.y = 0.012;
  scene.add(grid);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x7c8da6, roughness: 0.7, metalness: 0.04 });
  const northWallMesh = createArenaWallMesh({
    width: ARENA_INNER_HALF_EXTENT_X * 2 + WALL_THICKNESS,
    depth: WALL_THICKNESS,
    material: wallMaterial,
  });
  northWallMesh.position.set(0, WALL_HEIGHT / 2, ARENA_INNER_HALF_EXTENT_Z + WALL_THICKNESS / 2);
  scene.add(northWallMesh);
  const southWallMesh = createArenaWallMesh({
    width: ARENA_INNER_HALF_EXTENT_X * 2 + WALL_THICKNESS,
    depth: WALL_THICKNESS,
    material: wallMaterial,
  });
  southWallMesh.position.set(0, WALL_HEIGHT / 2, -ARENA_INNER_HALF_EXTENT_Z - WALL_THICKNESS / 2);
  scene.add(southWallMesh);
  const eastWallMesh = createArenaWallMesh({
    width: WALL_THICKNESS,
    depth: ARENA_INNER_HALF_EXTENT_Z * 2 + WALL_THICKNESS,
    material: wallMaterial,
  });
  eastWallMesh.position.set(ARENA_INNER_HALF_EXTENT_X + WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0);
  scene.add(eastWallMesh);
  const westWallMesh = createArenaWallMesh({
    width: WALL_THICKNESS,
    depth: ARENA_INNER_HALF_EXTENT_Z * 2 + WALL_THICKNESS,
    material: wallMaterial,
  });
  westWallMesh.position.set(-ARENA_INNER_HALF_EXTENT_X - WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0);
  scene.add(westWallMesh);

  const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6fe4, roughness: 0.42, metalness: 0.18 });
  const chassisMesh = new THREE.Mesh(new THREE.BoxGeometry(CHASSIS_SIZE_X, CHASSIS_SIZE_Y, CHASSIS_SIZE_Z), chassisMaterial);
  scene.add(chassisMesh);

  const servoGroup = new THREE.Group();
  chassisMesh.add(servoGroup);
  const armMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a24d, roughness: 0.45, metalness: 0.2 });
  const armMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(SERVO_ARM_RADIUS, SERVO_ARM_RADIUS, SERVO_ARM_LENGTH, 12),
    armMaterial,
  );
  armMesh.rotation.z = Math.PI / 2;
  armMesh.position.set(SERVO_ARM_LENGTH / 2, CHASSIS_SIZE_Y * 0.55, 0);
  servoGroup.add(armMesh);

  const ledMaterial = new THREE.MeshStandardMaterial({
    color: 0x0a2a12,
    emissive: new THREE.Color(LED_EMISSIVE_COLOR_HEX),
    emissiveIntensity: LED_OFF_EMISSIVE_INTENSITY,
    roughness: 0.35,
    metalness: 0.05,
  });
  const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(LED_MESH_RADIUS, 16, 16), ledMaterial);
  ledMesh.position.set(CHASSIS_SIZE_X * 0.35, CHASSIS_SIZE_Y * 0.55, CHASSIS_SIZE_Z * 0.35);
  chassisMesh.add(ledMesh);

  const resizeObserver = new ResizeObserver(() => {
    const viewportRect = viewport.getBoundingClientRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) {
      return;
    }
    renderer.setSize(viewportRect.width, viewportRect.height, false);
    camera.aspect = viewportRect.width / viewportRect.height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  });
  resizeObserver.observe(viewport);

  function syncFromPhysicsWorld(physicsWorld: PhysicsWorld): void {
    const pose = physicsWorld.getVehiclePose();
    chassisMesh.position.set(pose.positionX, pose.positionY, pose.positionZ);
    chassisMesh.quaternion.set(pose.quaternionX, pose.quaternionY, pose.quaternionZ, pose.quaternionW);
    servoGroup.rotation.y = pose.servoArmRotationYRadians;
    controls.target.lerp(
      new THREE.Vector3(pose.positionX, pose.positionY + CAMERA_LOOK_AT_Y, pose.positionZ),
      CAMERA_FOLLOW_LERP,
    );
    controls.update();
    renderer.render(scene, camera);
  }

  function setLedLit(isLit: boolean): void {
    ledMaterial.emissiveIntensity = isLit ? LED_ON_EMISSIVE_INTENSITY : LED_OFF_EMISSIVE_INTENSITY;
  }

  function dispose(): void {
    resizeObserver.disconnect();
    controls.dispose();
    renderer.dispose();
    groundGeometry.dispose();
    groundMaterial.dispose();
    northWallMesh.geometry.dispose();
    southWallMesh.geometry.dispose();
    eastWallMesh.geometry.dispose();
    westWallMesh.geometry.dispose();
    wallMaterial.dispose();
    chassisMesh.geometry.dispose();
    chassisMaterial.dispose();
    armMesh.geometry.dispose();
    armMaterial.dispose();
    ledMesh.geometry.dispose();
    ledMaterial.dispose();
  }

  return {
    rootElement: host,
    syncFromPhysicsWorld,
    setLedLit,
    dispose,
  };
}

function createArenaWallMesh(params: {
  width: number;
  depth: number;
  material: THREE.Material;
}): THREE.Mesh<THREE.BoxGeometry, THREE.Material> {
  return new THREE.Mesh(new THREE.BoxGeometry(params.width, WALL_HEIGHT, params.depth), params.material);
}
