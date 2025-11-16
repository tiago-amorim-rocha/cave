/**
 * Spider Controller - Multi-Body Character Controller
 *
 * CURRENT STATE: Core movement implemented (Phase 3)
 * - Creates spider rig using SpiderBuilder
 * - Implements IPlayerController interface
 * - Movement via Jacobian transpose inverse kinematics
 * - Input from virtual joystick
 * - Force distribution between legs
 *
 * DEFERRED FEATURES (Phase 4):
 * - Rotation stabilization (PD controller for body orientation)
 * - Joint limit springs (soft constraints to prevent over-extension)
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { RapierEngine } from '../../physics/engine';
import type { IPlayerController } from '../IPlayerController';
import type { VirtualJoystick } from '../../VirtualJoystick';
import type { SpiderAssembly, SpiderConfig, ControllerLeg } from './SpiderTypes';
import { DEFAULT_SPIDER_CONFIG } from './SpiderTypes';
import { buildSpider } from './SpiderBuilder';
import { clamp, radToDeg, degToRad } from './SpiderMath';

/**
 * Spider Controller - Multi-Body Character Controller
 *
 * Creates and manages a multi-body spider rig with Jacobian-based inverse kinematics.
 * Uses torque-based control to move a 2-legged, 3-segment-per-leg spider character.
 *
 * Phase 3: Core movement implemented (force distribution + Jacobian transpose)
 * TODO: Rotation stabilization and joint limit springs (deferred)
 */
export class SpiderController implements IPlayerController {
  private engine: RapierEngine;
  private spider: SpiderAssembly;
  public config: SpiderConfig; // Public for debug UI access
  private joystick: VirtualJoystick | null = null;
  private frameCount: number = 0;
  private lastInputX: number = 0;
  private lastInputY: number = 0;

  constructor(engine: RapierEngine, x: number, y: number, config?: SpiderConfig) {
    this.engine = engine;
    this.config = config || DEFAULT_SPIDER_CONFIG;

    // Clear debug console for focused spider debugging (browser only)
    if (typeof window !== 'undefined') {
      const debugConsole = (window as any).debugConsole;
      if (debugConsole && debugConsole.clearLogs) {
        debugConsole.clearLogs();
      }
    }

    console.log('[SpiderController] ==========================================');
    console.log('[SpiderController] SPIDER DEBUG MODE - Console Cleared');
    console.log('[SpiderController] ==========================================');
    console.log('[SpiderController] Creating spider controller at (', x.toFixed(2), ',', y.toFixed(2), ')');

    // Build the spider rig
    const world = engine.getWorld();
    if (!world) {
      throw new Error('[SpiderController] Physics world not initialized');
    }

    this.spider = buildSpider(world, x, y, this.config);

    // Log total spider mass
    const totalMass = this.spider.allBodies.reduce((sum, body) => sum + body.mass(), 0);
    const bodyMass = this.spider.body.mass();
    const leftLegMass = this.spider.leftLeg.hip.mass() + this.spider.leftLeg.knee.mass() + this.spider.leftLeg.ankle.mass();
    const rightLegMass = this.spider.rightLeg.hip.mass() + this.spider.rightLeg.knee.mass() + this.spider.rightLeg.ankle.mass();

    console.log('[SpiderController] Spider controller created successfully');
    console.log('[SpiderController] Movement: Jacobian-based inverse kinematics');
    console.log('[SpiderController] Mass breakdown:');
    console.log(`[SpiderController]   Body: ${bodyMass.toFixed(6)} (${(bodyMass/totalMass*100).toFixed(1)}%)`);
    console.log(`[SpiderController]   Left leg: ${leftLegMass.toFixed(6)} (${(leftLegMass/totalMass*100).toFixed(1)}%)`);
    console.log(`[SpiderController]   Right leg: ${rightLegMass.toFixed(6)} (${(rightLegMass/totalMass*100).toFixed(1)}%)`);
    console.log(`[SpiderController]   Total: ${totalMass.toFixed(6)}`);
    console.log('[SpiderController] Use virtual joystick to control spider');
    console.log('[SpiderController] Enable physics debug view to see the rig structure');
    console.log('[SpiderController] ==========================================');
  }

  /**
   * Update controller - Main physics update loop
   * Reads input, computes forces, applies torques
   */
  update(dt: number): void {
    // CRITICAL: Reset forces on all bodies to prevent accumulation
    // Rapier accumulates torques, so we must reset each frame
    this.spider.body.resetForces(true);
    this.spider.leftLeg.hip.resetForces(true);
    this.spider.leftLeg.knee.resetForces(true);
    this.spider.leftLeg.ankle.resetForces(true);
    this.spider.rightLeg.hip.resetForces(true);
    this.spider.rightLeg.knee.resetForces(true);
    this.spider.rightLeg.ankle.resetForces(true);

    this.frameCount++;

    // 1. Read input from joystick (clamped to [-1, 1])
    const input = this.joystick?.getInput() ?? { x: 0, y: 0, magnitude: 0 };
    const horizontalInput = clamp(input.x, -1, 1);
    // Note: VirtualJoystick y is -1 for up, 1 for down
    // Unity convention is positive = up, so negate
    const verticalInput = clamp(-input.y, -1, 1);

    // Only log when input changes or every 120 frames (2 seconds at 60fps)
    const inputChanged = Math.abs(horizontalInput - this.lastInputX) > 0.01 || Math.abs(verticalInput - this.lastInputY) > 0.01;
    const shouldLog = inputChanged || (this.frameCount % 120 === 0 && (Math.abs(horizontalInput) > 0.01 || Math.abs(verticalInput) > 0.01));

    if (shouldLog) {
      const bodyVel = this.spider.body.linvel();
      const bodyAngVel = this.spider.body.angvel();
      const bodyRot = this.spider.body.rotation();

      console.log('[Spider] Frame', this.frameCount, 'Input:', {
        horiz: horizontalInput.toFixed(3),
        vert: verticalInput.toFixed(3),
        bodyVel: { x: bodyVel.x.toFixed(3), y: bodyVel.y.toFixed(3) },
        bodyAngVel: bodyAngVel.toFixed(3),
        bodyRotDeg: (bodyRot * 180 / Math.PI).toFixed(1)
      });
    }

    this.lastInputX = horizontalInput;
    this.lastInputY = verticalInput;

    // 2. Compute desired forces on each leg
    const { leftForce, rightForce } = this.computeLegForces(verticalInput, horizontalInput);

    // Verify force symmetry (both legs should get EXACTLY the same forces)
    if (shouldLog && (Math.abs(horizontalInput) > 0.01 || Math.abs(verticalInput) > 0.01)) {
      const forceSymmetric = Math.abs(leftForce.x - rightForce.x) < 0.001 && Math.abs(leftForce.y - rightForce.y) < 0.001;
      console.log('[Spider] Forces:', {
        left: { x: leftForce.x.toFixed(2), y: leftForce.y.toFixed(2) },
        right: { x: rightForce.x.toFixed(2), y: rightForce.y.toFixed(2) },
        symmetric: forceSymmetric ? 'YES' : 'NO - ASYMMETRIC!'
      });

      if (!forceSymmetric) {
        console.warn('[Spider] WARNING: Force asymmetry detected! This will cause body rotation.');
      }
    }

    // 3. Apply torques to joints using Jacobian transpose
    // Note: Negate forces (equal-and-opposite reaction)
    // Spider pushes on ground, ground pushes on spider
    this.applyLegTorques(this.spider.leftLeg, -leftForce.x, -leftForce.y);
    this.applyLegTorques(this.spider.rightLeg, -rightForce.x, -rightForce.y);
  }

  /**
   * Compute leg forces from input
   *
   * Distributes desired body forces between left and right legs.
   * Simplified version without rotation stabilization.
   *
   * From Unity SpiderController.cs line 475-506
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
    let desiredFy = verticalInput * this.config.verticalAccelGain * body.mass();
    desiredFy = clamp(desiredFy, -this.config.maxTotalFootForceY, this.config.maxTotalFootForceY);

    // Desired horizontal force: input × gain × mass
    let desiredFx = horizontalInput * this.config.horizontalAccelGain * body.mass();
    desiredFx = clamp(desiredFx, -this.config.maxTotalFootForceX, this.config.maxTotalFootForceX);

    // Split forces evenly between legs (50% each)
    // TODO: Add rotation stabilization to bias forces for body orientation
    const perLegForce = {
      x: desiredFx * 0.5,
      y: desiredFy * 0.5
    };

    return {
      leftForce: { ...perLegForce },
      rightForce: { ...perLegForce }
    };
  }

  /**
   * Apply torques to leg joints using Jacobian transpose
   *
   * Converts desired foot force into joint torques for hip, knee, and ankle.
   * Uses Jacobian transpose method for inverse kinematics.
   * Simplified version without joint limit springs.
   *
   * From Unity SpiderController.cs line 508-611
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
    // Rapier uses radians, convert to degrees for debugging
    // Unity convention:
    // - thetaA: hip absolute rotation (world space)
    // - thetaB: knee relative to hip
    // - thetaC: ankle relative to knee
    const hipRotDeg = radToDeg(hip.rotation());
    const kneeRotDeg = radToDeg(knee.rotation());
    const ankleRotDeg = radToDeg(ankle.rotation());

    // Convert to radians for trig operations
    const thetaA = degToRad(hipRotDeg);
    const thetaB = degToRad(kneeRotDeg - hipRotDeg);
    const thetaC = degToRad(ankleRotDeg - kneeRotDeg);

    // === Segment Lengths ===
    const l1 = this.config.segmentLength1; // 1.3m
    const l2 = this.config.segmentLength2; // 1.0m
    const l3 = this.config.segmentLength3; // 0.7m

    // === Jacobian Matrix Computation ===
    // Precompute trig values for efficiency
    const sA = Math.sin(thetaA);
    const cA = Math.cos(thetaA);
    const sAB = Math.sin(thetaA + thetaB);
    const cAB = Math.cos(thetaA + thetaB);
    const sABC = Math.sin(thetaA + thetaB + thetaC);
    const cABC = Math.cos(thetaA + thetaB + thetaC);

    // Jacobian transpose terms
    // J = [j11 j12 j13]  (X-axis row)
    //     [j21 j22 j23]  (Y-axis row)
    const j11 = -l1 * sA - l2 * sAB - l3 * sABC;
    const j12 = -l2 * sAB - l3 * sABC;
    const j13 = -l3 * sABC;

    const j21 = l1 * cA + l2 * cAB + l3 * cABC;
    const j22 = l2 * cAB + l3 * cABC;
    const j23 = l3 * cABC;

    // === Compute Joint Torques ===
    // τ = J^T × F
    // where F = (Fx, Fy) is desired foot force
    let tauA = j11 * Fx + j21 * Fy; // Hip torque
    let tauB = j12 * Fx + j22 * Fy; // Knee torque
    let tauC = j13 * Fx + j23 * Fy; // Ankle torque

    // TODO: Add joint limit springs here (deferred)

    // === Scale and Clamp Torques ===
    tauA = clamp(tauA * this.config.torqueGain, -this.config.maxJointTorque, this.config.maxJointTorque);
    tauB = clamp(tauB * this.config.torqueGain, -this.config.maxJointTorque, this.config.maxJointTorque);
    tauC = clamp(tauC * this.config.torqueGain, -this.config.maxJointTorque, this.config.maxJointTorque);

    // DEEP LOGGING: Log torques every frame during first 10 frames, then every 30 frames
    const shouldLogTorques = this.frameCount <= 10 || this.frameCount % 30 === 0;
    if (shouldLogTorques) {
      const legName = leg === this.spider.leftLeg ? 'LEFT' : 'RIGHT';

      // Get current angles (in degrees for readability)
      const hipRotDeg = radToDeg(hip.rotation());
      const kneeRotDeg = radToDeg(knee.rotation());
      const ankleRotDeg = radToDeg(ankle.rotation());

      // Get angular velocities
      const hipAngVel = hip.angvel();
      const kneeAngVel = knee.angvel();
      const ankleAngVel = ankle.angvel();

      // Get linear velocities
      const hipLinVel = hip.linvel();
      const kneeLinVel = knee.linvel();
      const ankleLinVel = ankle.linvel();

      console.log(`[Spider ${legName} Frame ${this.frameCount}] DETAILED TORQUE ANALYSIS:`);
      console.log(`  Input Force: Fx=${Fx.toFixed(4)}, Fy=${Fy.toFixed(4)}`);
      console.log(`  Applied Torques (after gain=${this.config.torqueGain}):`);
      console.log(`    Hip:   τ=${tauA.toFixed(4)} N⋅m (clamped to ±${this.config.maxJointTorque})`);
      console.log(`    Knee:  τ=${tauB.toFixed(4)} N⋅m`);
      console.log(`    Ankle: τ=${tauC.toFixed(4)} N⋅m`);
      console.log(`  Joint Angles (deg):`);
      console.log(`    Hip:   ${hipRotDeg.toFixed(2)}° (abs), rel=${thetaA * 180 / Math.PI}`);
      console.log(`    Knee:  ${kneeRotDeg.toFixed(2)}° (abs), rel=${thetaB * 180 / Math.PI}`);
      console.log(`    Ankle: ${ankleRotDeg.toFixed(2)}° (abs), rel=${thetaC * 180 / Math.PI}`);
      console.log(`  Angular Velocities (rad/s):`);
      console.log(`    Hip:   ω=${hipAngVel.toFixed(4)} rad/s`);
      console.log(`    Knee:  ω=${kneeAngVel.toFixed(4)} rad/s`);
      console.log(`    Ankle: ω=${ankleAngVel.toFixed(4)} rad/s`);
      console.log(`  Linear Velocities (m/s):`);
      console.log(`    Hip:   v=(${hipLinVel.x.toFixed(3)}, ${hipLinVel.y.toFixed(3)})`);
      console.log(`    Knee:  v=(${kneeLinVel.x.toFixed(3)}, ${kneeLinVel.y.toFixed(3)})`);
      console.log(`    Ankle: v=(${ankleLinVel.x.toFixed(3)}, ${ankleLinVel.y.toFixed(3)})`);
      console.log(`  Masses: Hip=${hip.mass().toFixed(4)}, Knee=${knee.mass().toFixed(4)}, Ankle=${ankle.mass().toFixed(4)}`);

      // Calculate moment of inertia estimates (for rectangular segments rotating about center)
      // For a rectangle rotating about its center: I = m * L² / 12
      const L1 = this.config.segmentLength1;
      const L2 = this.config.segmentLength2;
      const L3 = this.config.segmentLength3;
      const hipMOI = hip.mass() * (L1 * L1) / 12;
      const kneeMOI = knee.mass() * (L2 * L2) / 12;
      const ankleMOI = ankle.mass() * (L3 * L3) / 12;
      console.log(`  Moment of Inertia (approx): Hip=${hipMOI.toFixed(6)}, Knee=${kneeMOI.toFixed(6)}, Ankle=${ankleMOI.toFixed(6)}`);

      // Calculate expected angular acceleration: α = τ / I
      const hipExpectedAccel = tauA / hipMOI;
      const kneeExpectedAccel = tauB / kneeMOI;
      const ankleExpectedAccel = tauC / ankleMOI;
      console.log(`  Expected α=τ/I (rad/s²): Hip=${hipExpectedAccel.toFixed(2)}, Knee=${kneeExpectedAccel.toFixed(2)}, Ankle=${ankleExpectedAccel.toFixed(2)}`);
    }

    // === Apply Torques ===
    // Rapier API: addTorque(torque, wakeup)
    hip.addTorque(tauA, true);
    knee.addTorque(tauB, true);
    ankle.addTorque(tauC, true);
  }

  /**
   * Get player position (returns body position)
   */
  getPosition(): { x: number; y: number } {
    const translation = this.spider.body.translation();
    return {
      x: translation.x,
      y: translation.y
    };
  }

  /**
   * Get player radius (for rendering)
   * Returns body size (1m × 1m square, so radius ≈ 0.7m for enclosing circle)
   */
  getRadius(): number {
    return 0.7; // Body is 1m × 1m, diagonal = √2 ≈ 1.4, radius ≈ 0.7
  }

  /**
   * Get player height (for rendering and collision)
   * Spider height depends on leg pose, but body is 1m tall
   */
  getHeight(): number {
    return 1.0; // Body height
  }

  /**
   * Get main player rigid body (returns spider body)
   */
  getBody(): RAPIER.RigidBody {
    return this.spider.body;
  }

  /**
   * Get all rigid bodies managed by this controller
   * Returns all spider bodies (body + legs + feet)
   */
  getAllBodies(): RAPIER.RigidBody[] {
    return this.spider.allBodies;
  }

  /**
   * Respawn spider at new position
   * Moves all spider bodies maintaining their relative positions
   */
  respawn(x: number, y: number): void {
    console.log('[SpiderController] Respawning spider at (', x.toFixed(2), ',', y.toFixed(2), ')');

    // Get current body position
    const currentPos = this.spider.body.translation();
    const dx = x - currentPos.x;
    const dy = y - currentPos.y;

    // Move all bodies by the same delta, maintaining relative positions
    for (const body of this.spider.allBodies) {
      const pos = body.translation();
      body.setTranslation({ x: pos.x + dx, y: pos.y + dy }, true);

      // Reset velocities to prevent residual momentum
      body.setLinvel({ x: 0, y: 0 }, true);
      body.setAngvel(0, true);
    }

    console.log('[SpiderController] Spider respawned successfully');
  }

  /**
   * Set virtual joystick for mobile input
   */
  setJoystick(joystick: VirtualJoystick): void {
    this.joystick = joystick;
  }

  /**
   * Check if player is grounded
   * TODO Phase 3: Implement ground detection via foot sensors
   */
  isGrounded(): boolean {
    // TODO: Check if feet are in contact with ground
    return true; // Assume grounded for now (feet are kinematic)
  }

  /**
   * Cleanup controller (remove all spider bodies)
   */
  destroy(): void {
    const world = this.engine.getWorld();
    if (!world) return;

    console.log('[SpiderController] Destroying spider (', this.spider.allBodies.length, 'bodies)');

    // Remove all bodies (colliders are removed automatically by Rapier)
    for (const body of this.spider.allBodies) {
      world.removeRigidBody(body);
    }

    console.log('[SpiderController] Spider destroyed');
  }

  /**
   * Get controller type name
   */
  getTypeName(): string {
    return 'Spider Controller (Jacobian IK)';
  }

  /**
   * Get spider render data for Canvas2D drawing
   * Returns all segment positions and rotations for the renderer
   */
  getRenderData(): any {
    const body = this.spider.body;
    const bodyPos = body.translation();
    const bodyRot = body.rotation();

    // Helper to get segment data
    const getSegmentData = (segment: RAPIER.RigidBody, length: number) => {
      const pos = segment.translation();
      const rot = segment.rotation();
      return {
        x: pos.x,
        y: pos.y,
        rotation: rot,
        length: length,
        width: 0.1 // Segment width (from SpiderBuilder)
      };
    };

    return {
      body: {
        x: bodyPos.x,
        y: bodyPos.y,
        rotation: bodyRot,
        width: 1.0,
        height: 1.0
      },
      leftLeg: {
        hip: getSegmentData(this.spider.leftLeg.hip, this.config.segmentLength1),
        knee: getSegmentData(this.spider.leftLeg.knee, this.config.segmentLength2),
        ankle: getSegmentData(this.spider.leftLeg.ankle, this.config.segmentLength3),
        foot: {
          x: this.spider.leftLeg.foot!.translation().x,
          y: this.spider.leftLeg.foot!.translation().y
        }
      },
      rightLeg: {
        hip: getSegmentData(this.spider.rightLeg.hip, this.config.segmentLength1),
        knee: getSegmentData(this.spider.rightLeg.knee, this.config.segmentLength2),
        ankle: getSegmentData(this.spider.rightLeg.ankle, this.config.segmentLength3),
        foot: {
          x: this.spider.rightLeg.foot!.translation().x,
          y: this.spider.rightLeg.foot!.translation().y
        }
      }
    };
  }

  /**
   * Optional debug draw
   * Spider bodies will be visible in physics debug view automatically
   */
  debugDraw?(ctx: CanvasRenderingContext2D, worldToScreen: (x: number, y: number) => { x: number; y: number }): void {
    // Optional: Draw custom debug info
    // For now, physics debug view is sufficient
  }
}
