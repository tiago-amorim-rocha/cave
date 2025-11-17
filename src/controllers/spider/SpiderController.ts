/**
 * Spider Controller for Box2D
 * 1-to-1 port from Unity SpiderController.cs
 *
 * Uses Jacobian transpose inverse kinematics to control a 2-legged spider.
 * Each leg has 3 segments (hip, knee, ankle) connected by revolute joints.
 * Feet are kinematic (pinned to ground).
 *
 * From Unity SpiderController.cs (lines 23-655)
 */

import type { b2World } from '@box2d/core';
import type { SpiderAssembly, SpiderConfig, ControllerLeg } from './SpiderTypes';
import { DEFAULT_SPIDER_CONFIG } from './SpiderTypes';
import { buildSpider } from './SpiderBuilder';
import { clamp, radToDeg, degToRad, deltaAngle, computeJointLimitTorque, applyMirrorIfNeeded } from './SpiderMath';

/**
 * Spider Controller
 *
 * Main controller class that manages spider physics and movement.
 * Reads input, computes forces, and applies torques to joints.
 */
export class SpiderController {
  private world: b2World;
  private spider: SpiderAssembly;
  public config: SpiderConfig;
  private frameCount: number = 0;
  private verticalInput: number = 0;
  private horizontalInput: number = 0;

  constructor(world: b2World, x: number, y: number, config?: SpiderConfig) {
    this.world = world;
    this.config = config || DEFAULT_SPIDER_CONFIG;
    this.spider = buildSpider(world, x, y, this.config);
  }

  /**
   * Set input (normalized to [-1, 1])
   *
   * @param vertical - Vertical input (positive = up)
   * @param horizontal - Horizontal input (positive = right)
   */
  setInput(vertical: number, horizontal: number): void {
    this.verticalInput = clamp(vertical, -1, 1);
    this.horizontalInput = clamp(horizontal, -1, 1);
  }

  /**
   * Update controller - Main physics update loop
   * Called every physics timestep (60 Hz)
   *
   * From Unity SpiderController.cs FixedUpdate() (lines 416-440)
   */
  update(dt: number): void {
    this.frameCount++;

    // 1. Compute desired forces on each leg
    const { leftForce, rightForce } = this.computeLegForces(this.verticalInput, this.horizontalInput);

    // 2. Apply torques to joints using Jacobian transpose
    // Note: Negate forces (equal-and-opposite reaction)
    this.applyLegTorques(this.spider.leftLeg, -leftForce.x, -leftForce.y);
    this.applyLegTorques(this.spider.rightLeg, -rightForce.x, -rightForce.y);
  }

  /**
   * Compute leg forces from input
   *
   * Distributes desired body forces between left and right legs.
   * Optionally includes rotation stabilization.
   *
   * From Unity SpiderController.cs ComputeLegForces() (lines 475-506)
   *
   * @param verticalInput - Vertical input [-1, 1] (positive = up)
   * @param horizontalInput - Horizontal input [-1, 1] (positive = right)
   * @returns Object with leftForce and rightForce vectors
   */
  private computeLegForces(
    verticalInput: number,
    horizontalInput: number
  ): { leftForce: { x: number; y: number }; rightForce: { x: number; y: number } } {
    const body = this.spider.body;

    // Desired vertical force: input × gain × mass
    let desiredFy = verticalInput * this.config.verticalAccelGain * body.GetMass();
    desiredFy = clamp(desiredFy, -this.config.maxTotalFootForceY, this.config.maxTotalFootForceY);

    // Desired horizontal force: input × gain × mass
    let desiredFx = horizontalInput * this.config.horizontalAccelGain * body.GetMass();
    desiredFx = clamp(desiredFx, -this.config.maxTotalFootForceX, this.config.maxTotalFootForceX);

    // Split forces evenly between legs (50% each)
    const perLegForce = {
      x: desiredFx * 0.5,
      y: desiredFy * 0.5,
    };

    let leftForce = { ...perLegForce };
    let rightForce = { ...perLegForce };

    // === Rotation Stabilization (optional) ===
    // From Unity SpiderController.cs lines 489-506
    if (this.config.stabilizeRotation) {
      const bodyAngle = radToDeg(body.GetAngle());
      const angleError = deltaAngle(bodyAngle, this.config.targetBodyAngle);
      const angVel = body.GetAngularVelocity();
      const desiredTorque = this.config.rotationStiffness * angleError - this.config.rotationDamping * angVel;

      if (Math.abs(desiredTorque) > 0.0001) {
        // Lever arm = horizontal distance between hips
        const leftHipPos = this.spider.leftLeg.hip.GetWorldCenter();
        const rightHipPos = this.spider.rightLeg.hip.GetWorldCenter();
        const lever = leftHipPos.x - rightHipPos.x;

        if (Math.abs(lever) > 0.0001) {
          const deltaFy = desiredTorque / lever;
          leftForce.y += deltaFy;
          rightForce.y -= deltaFy;
        }
      }
    }

    return { leftForce, rightForce };
  }

  /**
   * Apply torques to leg joints using Jacobian transpose
   *
   * Converts desired foot force into joint torques for hip, knee, and ankle.
   * Uses Jacobian transpose method for inverse kinematics.
   *
   * From Unity SpiderController.cs ApplyLegTorques() (lines 508-611)
   *
   * @param leg - Leg to apply torques to
   * @param Fx - Desired horizontal force at foot (N)
   * @param Fy - Desired vertical force at foot (N)
   */
  private applyLegTorques(leg: ControllerLeg, Fx: number, Fy: number): void {
    const hip = leg.hip;
    const knee = leg.knee;
    const ankle = leg.ankle;

    // === Read Joint Angles ===
    // Box2D uses radians, convert to degrees for debugging
    const hipRotRad = hip.GetAngle();
    const kneeRotRad = knee.GetAngle();
    const ankleRotRad = ankle.GetAngle();

    const hipRotDeg = radToDeg(hipRotRad);
    const kneeRotDeg = radToDeg(kneeRotRad);
    const ankleRotDeg = radToDeg(ankleRotRad);

    // Unity convention:
    // - thetaA: hip absolute rotation (world space)
    // - thetaB: knee relative to hip
    // - thetaC: ankle relative to knee
    const thetaA = hipRotRad;
    const thetaB = degToRad(kneeRotDeg - hipRotDeg);
    const thetaC = degToRad(ankleRotDeg - kneeRotDeg);

    // === Segment Lengths ===
    const l1 = this.config.segmentLength1; // 1.3m
    const l2 = this.config.segmentLength2; // 1.0m
    const l3 = this.config.segmentLength3; // 0.7m

    // === Jacobian Matrix Computation ===
    // From Unity SpiderController.cs lines 525-542
    const sA = Math.sin(thetaA);
    const cA = Math.cos(thetaA);
    const sAB = Math.sin(thetaA + thetaB);
    const cAB = Math.cos(thetaA + thetaB);
    const sABC = Math.sin(thetaA + thetaB + thetaC);
    const cABC = Math.cos(thetaA + thetaB + thetaC);

    // Jacobian transpose terms
    const j11 = -l1 * sA - l2 * sAB - l3 * sABC;
    const j12 = -l2 * sAB - l3 * sABC;
    const j13 = -l3 * sABC;

    const j21 = l1 * cA + l2 * cAB + l3 * cABC;
    const j22 = l2 * cAB + l3 * cABC;
    const j23 = l3 * cABC;

    // === Compute Joint Torques ===
    // τ = J^T × F
    let tauA = j11 * Fx + j21 * Fy; // Hip torque
    let tauB = j12 * Fx + j22 * Fy; // Knee torque
    let tauC = j13 * Fx + j23 * Fy; // Ankle torque

    // Save pre-gain torques for logging
    const tauA_preGain = tauA;
    const tauB_preGain = tauB;
    const tauC_preGain = tauC;

    // === Joint Limit Springs (optional) ===
    // From Unity SpiderController.cs lines 544-596
    const bodyAngle = radToDeg(this.spider.body.GetAngle());
    const bodyAngVel = this.spider.body.GetAngularVelocity();

    // Compute radial parent orientation for hip
    let hipParentDeg = bodyAngle;
    let hipParentAngVel = bodyAngVel;
    {
      const bodyPos = this.spider.body.GetWorldCenter();
      const hipPos = hip.GetWorldCenter();
      const radialX = hipPos.x - bodyPos.x;
      const radialY = hipPos.y - bodyPos.y;
      if (radialX * radialX + radialY * radialY > 0.0001) {
        hipParentDeg = radToDeg(Math.atan2(radialY, radialX));
      }
    }

    // Get hip limit range (mirrored for left/right legs)
    const hipRange = { min: this.config.hipLimitFreeMin, max: this.config.hipLimitFreeMax };
    applyMirrorIfNeeded(leg.isLeft, hipRange);

    // Compute hip limit torque
    let hipLimitTau = 0;
    if (this.config.enableHipJointLimits) {
      hipLimitTau = computeJointLimitTorque(
        hipParentDeg,
        hipRotDeg,
        hipRange.min,
        hipRange.max,
        this.config.jointLimitKp,
        this.config.jointLimitKd,
        hipParentAngVel,
        hip.GetAngularVelocity()
      );
      tauA += hipLimitTau;
    }

    // Get knee/ankle limit ranges (mirrored for left/right legs)
    const kneeRange = { min: this.config.kneeLimitFreeMin, max: this.config.kneeLimitFreeMax };
    const ankleRange = { min: this.config.ankleLimitFreeMin, max: this.config.ankleLimitFreeMax };
    applyMirrorIfNeeded(leg.isLeft, kneeRange);
    applyMirrorIfNeeded(leg.isLeft, ankleRange);

    // Compute knee/ankle limit torques
    let kneeLimitTau = 0;
    let ankleLimitTau = 0;
    if (this.config.enableKneeAnkleJointLimits) {
      kneeLimitTau = computeJointLimitTorque(
        hipRotDeg,
        kneeRotDeg,
        kneeRange.min,
        kneeRange.max,
        this.config.jointLimitKp,
        this.config.jointLimitKd,
        hip.GetAngularVelocity(),
        knee.GetAngularVelocity()
      );

      ankleLimitTau = computeJointLimitTorque(
        kneeRotDeg,
        ankleRotDeg,
        ankleRange.min,
        ankleRange.max,
        this.config.jointLimitKp,
        this.config.jointLimitKd,
        knee.GetAngularVelocity(),
        ankle.GetAngularVelocity()
      );

      tauB += kneeLimitTau;
      tauC += ankleLimitTau;
    }

    // === Scale and Clamp Torques ===
    // From Unity SpiderController.cs lines 604-606
    tauA = clamp(tauA * this.config.torqueGain, -this.config.maxJointTorque, this.config.maxJointTorque);
    tauB = clamp(tauB * this.config.torqueGain, -this.config.maxJointTorque, this.config.maxJointTorque);
    tauC = clamp(tauC * this.config.torqueGain, -this.config.maxJointTorque, this.config.maxJointTorque);

    // === Apply Torques ===
    // From Unity SpiderController.cs lines 608-610
    // Box2D API: ApplyTorque(torque, wake)
    hip.ApplyTorque(tauA, true);
    knee.ApplyTorque(tauB, true);
    ankle.ApplyTorque(tauC, true);
  }

  /**
   * Get spider body position
   */
  getBodyPosition(): { x: number; y: number } {
    const pos = this.spider.body.GetPosition();
    return { x: pos.x, y: pos.y };
  }

  /**
   * Get spider body velocity
   */
  getBodyVelocity(): { x: number; y: number } {
    const vel = this.spider.body.GetLinearVelocity();
    return { x: vel.x, y: vel.y };
  }

  /**
   * Get spider body rotation (radians)
   */
  getBodyRotation(): number {
    return this.spider.body.GetAngle();
  }

  /**
   * Get spider body angular velocity (rad/s)
   */
  getBodyAngularVelocity(): number {
    return this.spider.body.GetAngularVelocity();
  }

  /**
   * Get spider render data for visualization
   */
  getRenderData(): any {
    const getSegmentData = (body: any, length: number) => {
      const pos = body.GetPosition();
      const angle = body.GetAngle();
      return {
        x: pos.x,
        y: pos.y,
        rotation: angle,  // Changed from 'angle' to 'rotation' to match Renderer interface
        length: length,
        width: this.config.legSegmentWidth,
      };
    };

    const renderData = {
      body: {
        x: this.spider.body.GetPosition().x,
        y: this.spider.body.GetPosition().y,
        rotation: this.spider.body.GetAngle(),  // Changed from 'angle' to 'rotation'
        width: 1.0,
        height: 1.0,
      },
      leftLeg: {
        hip: getSegmentData(this.spider.leftLeg.hip, this.config.segmentLength1),
        knee: getSegmentData(this.spider.leftLeg.knee, this.config.segmentLength2),
        ankle: getSegmentData(this.spider.leftLeg.ankle, this.config.segmentLength3),
        foot: {
          x: this.spider.leftLeg.foot!.GetPosition().x,
          y: this.spider.leftLeg.foot!.GetPosition().y,
        },
      },
      rightLeg: {
        hip: getSegmentData(this.spider.rightLeg.hip, this.config.segmentLength1),
        knee: getSegmentData(this.spider.rightLeg.knee, this.config.segmentLength2),
        ankle: getSegmentData(this.spider.rightLeg.ankle, this.config.segmentLength3),
        foot: {
          x: this.spider.rightLeg.foot!.GetPosition().x,
          y: this.spider.rightLeg.foot!.GetPosition().y,
        },
      },
    };

    // Debug logging for spider position and rotation
    console.log('=== SPIDER DEBUG ===');
    console.log('Body:', {
      x: renderData.body.x.toFixed(3),
      y: renderData.body.y.toFixed(3),
      rotation: renderData.body.rotation.toFixed(3) + ' rad (' + (renderData.body.rotation * 180 / Math.PI).toFixed(1) + '°)'
    });
    console.log('Left Leg:');
    console.log('  Hip:', {
      x: renderData.leftLeg.hip.x.toFixed(3),
      y: renderData.leftLeg.hip.y.toFixed(3),
      rotation: renderData.leftLeg.hip.rotation.toFixed(3) + ' rad (' + (renderData.leftLeg.hip.rotation * 180 / Math.PI).toFixed(1) + '°)'
    });
    console.log('  Knee:', {
      x: renderData.leftLeg.knee.x.toFixed(3),
      y: renderData.leftLeg.knee.y.toFixed(3),
      rotation: renderData.leftLeg.knee.rotation.toFixed(3) + ' rad (' + (renderData.leftLeg.knee.rotation * 180 / Math.PI).toFixed(1) + '°)'
    });
    console.log('  Ankle:', {
      x: renderData.leftLeg.ankle.x.toFixed(3),
      y: renderData.leftLeg.ankle.y.toFixed(3),
      rotation: renderData.leftLeg.ankle.rotation.toFixed(3) + ' rad (' + (renderData.leftLeg.ankle.rotation * 180 / Math.PI).toFixed(1) + '°)'
    });
    console.log('  Foot:', {
      x: renderData.leftLeg.foot.x.toFixed(3),
      y: renderData.leftLeg.foot.y.toFixed(3)
    });
    console.log('Right Leg:');
    console.log('  Hip:', {
      x: renderData.rightLeg.hip.x.toFixed(3),
      y: renderData.rightLeg.hip.y.toFixed(3),
      rotation: renderData.rightLeg.hip.rotation.toFixed(3) + ' rad (' + (renderData.rightLeg.hip.rotation * 180 / Math.PI).toFixed(1) + '°)'
    });
    console.log('  Knee:', {
      x: renderData.rightLeg.knee.x.toFixed(3),
      y: renderData.rightLeg.knee.y.toFixed(3),
      rotation: renderData.rightLeg.knee.rotation.toFixed(3) + ' rad (' + (renderData.rightLeg.knee.rotation * 180 / Math.PI).toFixed(1) + '°)'
    });
    console.log('  Ankle:', {
      x: renderData.rightLeg.ankle.x.toFixed(3),
      y: renderData.rightLeg.ankle.y.toFixed(3),
      rotation: renderData.rightLeg.ankle.rotation.toFixed(3) + ' rad (' + (renderData.rightLeg.ankle.rotation * 180 / Math.PI).toFixed(1) + '°)'
    });
    console.log('  Foot:', {
      x: renderData.rightLeg.foot.x.toFixed(3),
      y: renderData.rightLeg.foot.y.toFixed(3)
    });
    console.log('===================');

    return renderData;
  }

  /**
   * Respawn spider at new position
   * Destroys old spider bodies and creates new ones
   *
   * @param x - New X position
   * @param y - New Y position
   */
  respawn(x: number, y: number): void {
    // Destroy old spider bodies
    const destroyBody = (body: any) => {
      if (body) {
        this.world.DestroyBody(body);
      }
    };

    // Destroy all bodies in spider assembly
    destroyBody(this.spider.body);
    destroyBody(this.spider.leftLeg.hip);
    destroyBody(this.spider.leftLeg.knee);
    destroyBody(this.spider.leftLeg.ankle);
    destroyBody(this.spider.leftLeg.foot);
    destroyBody(this.spider.rightLeg.hip);
    destroyBody(this.spider.rightLeg.knee);
    destroyBody(this.spider.rightLeg.ankle);
    destroyBody(this.spider.rightLeg.foot);

    // Build new spider at new position
    this.spider = buildSpider(this.world, x, y, this.config);

    // Reset state
    this.frameCount = 0;
    this.verticalInput = 0;
    this.horizontalInput = 0;
  }

  /**
   * Get spider position (alias for getBodyPosition)
   */
  getPosition(): { x: number; y: number } {
    return this.getBodyPosition();
  }

  /**
   * Apply config changes to existing spider bodies
   * Called when debug UI sliders are changed
   *
   * Updates physics properties in real-time without respawning
   */
  applyConfigChanges(): void {
    // Update main body properties
    this.spider.body.SetLinearDamping(this.config.bodyLinearDamping);
    this.spider.body.SetAngularDamping(this.config.bodyAngularDamping);
    this.spider.body.SetGravityScale(this.config.gravityScale);

    // Update body mass and inertia
    this.updateBodyMassAndInertia(
      this.spider.body,
      1.0, // 1m × 1m square area
      1.0, // base density
      this.config.bodyMassScale,
      this.config.bodyInertiaScale,
      this.config.contactFrictionScale
    );

    // Update leg segments
    const updateLeg = (leg: any, segment1Length: number, segment2Length: number, segment3Length: number, width: number) => {
      // Hip segment
      leg.hip.SetLinearDamping(this.config.legLinearDamping);
      leg.hip.SetAngularDamping(this.config.legAngularDamping);
      leg.hip.SetGravityScale(this.config.gravityScale);
      this.updateBodyMassAndInertia(
        leg.hip,
        segment1Length * width,
        0.2 / (segment1Length * width),
        this.config.legMassScale,
        this.config.legInertiaScale,
        this.config.contactFrictionScale
      );

      // Knee segment
      leg.knee.SetLinearDamping(this.config.legLinearDamping);
      leg.knee.SetAngularDamping(this.config.legAngularDamping);
      leg.knee.SetGravityScale(this.config.gravityScale);
      this.updateBodyMassAndInertia(
        leg.knee,
        segment2Length * width,
        0.15384616 / (segment2Length * width),
        this.config.legMassScale,
        this.config.legInertiaScale,
        this.config.contactFrictionScale
      );

      // Ankle segment
      leg.ankle.SetLinearDamping(this.config.legLinearDamping);
      leg.ankle.SetAngularDamping(this.config.legAngularDamping);
      leg.ankle.SetGravityScale(this.config.gravityScale);
      this.updateBodyMassAndInertia(
        leg.ankle,
        segment3Length * width,
        0.118343204 / (segment3Length * width),
        this.config.legMassScale,
        this.config.legInertiaScale,
        this.config.contactFrictionScale
      );
    };

    updateLeg(this.spider.leftLeg, this.config.segmentLength1, this.config.segmentLength2, this.config.segmentLength3, this.config.legSegmentWidth);
    updateLeg(this.spider.rightLeg, this.config.segmentLength1, this.config.segmentLength2, this.config.segmentLength3, this.config.legSegmentWidth);
  }

  /**
   * Update mass, inertia, and friction for a body
   *
   * @param body - Box2D body to update
   * @param area - Shape area (m²)
   * @param baseDensity - Base density (kg/m²)
   * @param massScale - Mass scale multiplier
   * @param inertiaScale - Inertia scale multiplier
   * @param frictionScale - Friction scale multiplier
   */
  private updateBodyMassAndInertia(
    body: any,
    area: number,
    baseDensity: number,
    massScale: number,
    inertiaScale: number,
    frictionScale: number
  ): void {
    // Get current mass data
    const massData = body.GetMassData();

    // Calculate new mass (density × area × massScale)
    const newMass = baseDensity * area * massScale;

    // Scale inertia proportionally
    // Inertia = mass × (shape factor), so scale by massScale × inertiaScale
    const currentInertia = massData.I;
    const baseInertia = currentInertia / (massScale * inertiaScale); // Approximate base
    const newInertia = baseInertia * massScale * inertiaScale;

    // Set new mass data
    massData.mass = newMass;
    massData.I = newInertia;
    body.SetMassData(massData);

    // Update fixture friction
    let fixture = body.GetFixtureList();
    while (fixture) {
      fixture.SetFriction(0.3 * frictionScale);
      fixture = fixture.GetNext();
    }

    // Reset mass data to apply changes
    body.ResetMassData();
  }

  /**
   * Destroy spider and cleanup
   */
  destroy(): void {
    const destroyBody = (body: any) => {
      if (body) {
        this.world.DestroyBody(body);
      }
    };

    // Destroy all bodies in spider assembly
    destroyBody(this.spider.body);
    destroyBody(this.spider.leftLeg.hip);
    destroyBody(this.spider.leftLeg.knee);
    destroyBody(this.spider.leftLeg.ankle);
    destroyBody(this.spider.leftLeg.foot);
    destroyBody(this.spider.rightLeg.hip);
    destroyBody(this.spider.rightLeg.knee);
    destroyBody(this.spider.rightLeg.ankle);
    destroyBody(this.spider.rightLeg.foot);
  }

  /**
   * Set joystick input
   * @param joystick - Joystick input {x, y} in [-1, 1]
   */
  setJoystick(joystick: { x: number; y: number }): void {
    this.setInput(joystick.y, joystick.x);
  }

  /**
   * Get controller type name
   */
  getTypeName(): string {
    return 'SpiderController';
  }

  /**
   * Get all bodies in spider assembly
   */
  getAllBodies(): any[] {
    return [
      this.spider.body,
      this.spider.leftLeg.hip,
      this.spider.leftLeg.knee,
      this.spider.leftLeg.ankle,
      this.spider.leftLeg.foot,
      this.spider.rightLeg.hip,
      this.spider.rightLeg.knee,
      this.spider.rightLeg.ankle,
      this.spider.rightLeg.foot,
    ].filter(b => b !== null);
  }

  /**
   * Get main body
   */
  getBody(): any {
    return this.spider.body;
  }

  /**
   * Check if spider is grounded
   * For now, simple heuristic based on vertical velocity
   */
  isGrounded(): boolean {
    const vel = this.spider.body.GetLinearVelocity();
    return Math.abs(vel.y) < 0.1;
  }

  /**
   * Get radius (for collision/rendering)
   * Returns approximate radius based on body size
   */
  getRadius(): number {
    return 0.5; // Body is 1.0 × 1.0, so radius ~0.5
  }

  /**
   * Get height (for collision/rendering)
   * Returns approximate height based on body size
   */
  getHeight(): number {
    return 1.0; // Body height
  }
}
