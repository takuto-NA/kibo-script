/**
 * 責務: Rapier 3D で固定筐体（箱）を床の上に置き、左右モーター指令を前進・旋回のインパルスへ写像する。
 */

import * as RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { eulerYprMilliDegreesFromQuaternion } from "./euler-ypr-milli-degrees-from-quaternion";
import { IMU_ACCEL_MILLI_G_PER_G } from "./physics-simulator-mvp-api";
import type { PhysicsWorld, SimulatedImuSnapshot, SimulatedVehiclePose } from "./physics-world";

const MIN_MOTOR_ID = 0;
const MAX_MOTOR_ID = 1;
const SERVO_ID_FOR_MVP = 0;
const IMU_ID_FOR_MVP = 0;

const FIXED_PHYSICS_STEP_SECONDS = 1 / 60;
const FIXED_PHYSICS_STEP_MILLISECONDS = FIXED_PHYSICS_STEP_SECONDS * 1000;

const VEHICLE_INITIAL_TRANSLATION_Y = 0.6;
const VEHICLE_BOX_HALF_EXTENT_X = 0.35;
const VEHICLE_BOX_HALF_EXTENT_Y = 0.12;
const VEHICLE_BOX_HALF_EXTENT_Z = 0.22;

const GROUND_HALF_EXTENT_X = 12;
const GROUND_HALF_EXTENT_Y = 0.08;
const GROUND_HALF_EXTENT_Z = 12;
const ARENA_INNER_HALF_EXTENT_X = 5.6;
const ARENA_INNER_HALF_EXTENT_Z = 5.6;
const WALL_HALF_THICKNESS = 0.12;
const WALL_HALF_HEIGHT = 0.32;

const MAX_FORWARD_SPEED_METERS_PER_SECOND = 1.25;
const MAX_STEERING_YAW_RATE_RADIANS_PER_SECOND = 1.1;
const VEHICLE_LINEAR_DAMPING = 1.8;
const VEHICLE_ANGULAR_DAMPING = 6.5;
const MAX_YAW_ANGULAR_VELOCITY_RADIANS_PER_SECOND = 1.4;

const WORLD_UP_UNIT = new THREE.Vector3(0, 1, 0);
const VEHICLE_FORWARD_LOCAL = new THREE.Vector3(0, 0, 1);

export class RapierPhysicsWorld implements PhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly vehicleBody: RAPIER.RigidBody;
  private motorLeftPercent = 0;
  private motorRightPercent = 0;
  private servoAngleDegrees = 0;
  private accumulatorMilliseconds = 0;
  private previousLinvelWorld: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  private constructor(world: RAPIER.World, vehicleBody: RAPIER.RigidBody) {
    this.world = world;
    this.vehicleBody = vehicleBody;
  }

  public static async create(): Promise<RapierPhysicsWorld> {
    await RAPIER.init();
    const gravityVector = { x: 0, y: -9.81, z: 0 };
    const world = new RAPIER.World(gravityVector);
    world.integrationParameters.dt = FIXED_PHYSICS_STEP_SECONDS;

    const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(GROUND_HALF_EXTENT_X, GROUND_HALF_EXTENT_Y, GROUND_HALF_EXTENT_Z),
      groundBody,
    );
    createArenaWall({
      world,
      centerX: 0,
      centerZ: ARENA_INNER_HALF_EXTENT_Z + WALL_HALF_THICKNESS,
      halfExtentX: ARENA_INNER_HALF_EXTENT_X + WALL_HALF_THICKNESS,
      halfExtentZ: WALL_HALF_THICKNESS,
    });
    createArenaWall({
      world,
      centerX: 0,
      centerZ: -ARENA_INNER_HALF_EXTENT_Z - WALL_HALF_THICKNESS,
      halfExtentX: ARENA_INNER_HALF_EXTENT_X + WALL_HALF_THICKNESS,
      halfExtentZ: WALL_HALF_THICKNESS,
    });
    createArenaWall({
      world,
      centerX: ARENA_INNER_HALF_EXTENT_X + WALL_HALF_THICKNESS,
      centerZ: 0,
      halfExtentX: WALL_HALF_THICKNESS,
      halfExtentZ: ARENA_INNER_HALF_EXTENT_Z + WALL_HALF_THICKNESS,
    });
    createArenaWall({
      world,
      centerX: -ARENA_INNER_HALF_EXTENT_X - WALL_HALF_THICKNESS,
      centerZ: 0,
      halfExtentX: WALL_HALF_THICKNESS,
      halfExtentZ: ARENA_INNER_HALF_EXTENT_Z + WALL_HALF_THICKNESS,
    });

    const vehicleRigidBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, VEHICLE_INITIAL_TRANSLATION_Y, 0),
    );
    vehicleRigidBody.setLinearDamping(VEHICLE_LINEAR_DAMPING);
    vehicleRigidBody.setAngularDamping(VEHICLE_ANGULAR_DAMPING);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        VEHICLE_BOX_HALF_EXTENT_X,
        VEHICLE_BOX_HALF_EXTENT_Y,
        VEHICLE_BOX_HALF_EXTENT_Z,
      ).setDensity(1.2),
      vehicleRigidBody,
    );

    return new RapierPhysicsWorld(world, vehicleRigidBody);
  }

  public step(elapsedMilliseconds: number): void {
    this.accumulatorMilliseconds += elapsedMilliseconds;
    while (this.accumulatorMilliseconds >= FIXED_PHYSICS_STEP_MILLISECONDS) {
      this.applyMotorImpulsesForOnePhysicsStep();
      this.world.step();
      this.accumulatorMilliseconds -= FIXED_PHYSICS_STEP_MILLISECONDS;
    }
  }

  public setMotorPowerPercent(motorId: number, powerPercent: number): void {
    if (motorId === MIN_MOTOR_ID) {
      this.motorLeftPercent = powerPercent;
      return;
    }
    if (motorId === MAX_MOTOR_ID) {
      this.motorRightPercent = powerPercent;
    }
  }

  public setServoAngleDegrees(servoId: number, angleDegrees: number): void {
    if (servoId !== SERVO_ID_FOR_MVP) {
      return;
    }
    this.servoAngleDegrees = angleDegrees;
  }

  public getMotorPowerPercent(motorId: number): number {
    if (motorId === MIN_MOTOR_ID) {
      return this.motorLeftPercent;
    }
    if (motorId === MAX_MOTOR_ID) {
      return this.motorRightPercent;
    }
    return 0;
  }

  public getServoAngleDegrees(servoId: number): number {
    if (servoId !== SERVO_ID_FOR_MVP) {
      return 0;
    }
    return this.servoAngleDegrees;
  }

  public getImuSnapshot(imuId: number): SimulatedImuSnapshot {
    if (imuId !== IMU_ID_FOR_MVP) {
      return this.createZeroImuSnapshot();
    }
    const rotation = this.vehicleBody.rotation();
    const quaternionW = rotation.w;
    const quaternionX = rotation.x;
    const quaternionY = rotation.y;
    const quaternionZ = rotation.z;
    const ypr = eulerYprMilliDegreesFromQuaternion({
      quaternionW,
      quaternionX,
      quaternionY,
      quaternionZ,
    });

    const quaternion = new THREE.Quaternion(quaternionX, quaternionY, quaternionZ, quaternionW);
    const gravityInBodyMillig = WORLD_UP_UNIT.clone().multiplyScalar(IMU_ACCEL_MILLI_G_PER_G);
    gravityInBodyMillig.applyQuaternion(quaternion.clone().invert());

    const linvel = this.vehicleBody.linvel();
    const currentLinvel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const deltaLinvel = currentLinvel.clone().sub(this.previousLinvelWorld);
    const linearAccelWorld = deltaLinvel.multiplyScalar(1 / FIXED_PHYSICS_STEP_SECONDS);
    this.previousLinvelWorld.copy(currentLinvel);
    const linearAccelBodyMillig = linearAccelWorld.clone().multiplyScalar(100);
    linearAccelBodyMillig.applyQuaternion(quaternion.clone().invert());

    const accelXMilliG = Math.round(gravityInBodyMillig.x + linearAccelBodyMillig.x);
    const accelYMilliG = Math.round(gravityInBodyMillig.y + linearAccelBodyMillig.y);
    const accelZMilliG = Math.round(gravityInBodyMillig.z + linearAccelBodyMillig.z);

    return {
      rollMilliDegrees: ypr.rollMilliDegrees,
      pitchMilliDegrees: ypr.pitchMilliDegrees,
      yawMilliDegrees: ypr.yawMilliDegrees,
      accelXMilliG,
      accelYMilliG,
      accelZMilliG,
    };
  }

  public getVehiclePose(): SimulatedVehiclePose {
    const translation = this.vehicleBody.translation();
    const rotation = this.vehicleBody.rotation();
    const servoRadians = (this.servoAngleDegrees * Math.PI) / 180;
    return {
      positionX: translation.x,
      positionY: translation.y,
      positionZ: translation.z,
      quaternionW: rotation.w,
      quaternionX: rotation.x,
      quaternionY: rotation.y,
      quaternionZ: rotation.z,
      servoArmRotationYRadians: servoRadians,
    };
  }

  public dispose(): void {
    this.world.free();
  }

  private applyMotorImpulsesForOnePhysicsStep(): void {
    const rotation = this.vehicleBody.rotation();
    const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const forwardWorld = VEHICLE_FORWARD_LOCAL.clone().applyQuaternion(quaternion);
    forwardWorld.y = 0;
    if (forwardWorld.lengthSq() > 0) {
      forwardWorld.normalize();
    }

    const motorAveragePercent = (this.motorLeftPercent + this.motorRightPercent) / 2;
    const motorDifferencePercent = this.motorRightPercent - this.motorLeftPercent;

    const currentLinearVelocity = this.vehicleBody.linvel();
    const targetForwardSpeed =
      (motorAveragePercent / 100) * MAX_FORWARD_SPEED_METERS_PER_SECOND;
    this.vehicleBody.setLinvel(
      {
        x: forwardWorld.x * targetForwardSpeed,
        y: currentLinearVelocity.y,
        z: forwardWorld.z * targetForwardSpeed,
      },
      true,
    );

    const targetYawRate =
      (motorDifferencePercent / 100) * MAX_STEERING_YAW_RATE_RADIANS_PER_SECOND;
    const currentAngularVelocity = this.vehicleBody.angvel();
    this.vehicleBody.setAngvel(
      {
        x: currentAngularVelocity.x,
        y: targetYawRate,
        z: currentAngularVelocity.z,
      },
      true,
    );
    this.clampYawAngularVelocity();
  }

  private clampYawAngularVelocity(): void {
    const currentAngularVelocity = this.vehicleBody.angvel();
    if (Math.abs(currentAngularVelocity.y) <= MAX_YAW_ANGULAR_VELOCITY_RADIANS_PER_SECOND) {
      return;
    }
    const clampedYawVelocity =
      currentAngularVelocity.y > 0
        ? MAX_YAW_ANGULAR_VELOCITY_RADIANS_PER_SECOND
        : -MAX_YAW_ANGULAR_VELOCITY_RADIANS_PER_SECOND;
    this.vehicleBody.setAngvel(
      {
        x: currentAngularVelocity.x,
        y: clampedYawVelocity,
        z: currentAngularVelocity.z,
      },
      true,
    );
  }

  private createZeroImuSnapshot(): SimulatedImuSnapshot {
    return {
      rollMilliDegrees: 0,
      pitchMilliDegrees: 0,
      yawMilliDegrees: 0,
      accelXMilliG: 0,
      accelYMilliG: 0,
      accelZMilliG: 0,
    };
  }
}

function createArenaWall(params: {
  world: RAPIER.World;
  centerX: number;
  centerZ: number;
  halfExtentX: number;
  halfExtentZ: number;
}): void {
  const wallBody = params.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(params.centerX, WALL_HALF_HEIGHT, params.centerZ),
  );
  params.world.createCollider(
    RAPIER.ColliderDesc.cuboid(params.halfExtentX, WALL_HALF_HEIGHT, params.halfExtentZ),
    wallBody,
  );
}
