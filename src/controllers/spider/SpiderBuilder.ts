/**
 * Spider Builder - Programmatic Multi-Body Rig Assembly
 *
 * Creates the spider's physical structure using Rapier 2D:
 * - 1 main body (1m × 1m square)
 * - 2 legs × 3 segments = 6 leg segments
 * - 2 feet (kinematic, pinned to ground)
 * - Revolute joints connecting everything
 *
 * Based on Unity spider.prefab and SpiderController.cs ApplyLegLayout()
 * See spider-unity-version/SpiderController_Port_TS.md section 4
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { SpiderConfig, SpiderAssembly, ControllerLeg } from './SpiderTypes';
import { DEFAULT_SPIDER_CONFIG } from './SpiderTypes';
import { angleToDir, rotateDir, degToRad } from './SpiderMath';

/**
 * Build a complete spider rig
 *
 * @param world - Rapier world to create bodies in
 * @param x - Spawn X position (metres)
 * @param y - Spawn Y position (metres)
 * @param config - Spider configuration (optional, uses defaults if not provided)
 * @returns Complete spider assembly ready for controller
 */
export function buildSpider(
  world: RAPIER.World,
  x: number,
  y: number,
  config: SpiderConfig = DEFAULT_SPIDER_CONFIG
): SpiderAssembly {
  console.log('[SpiderBuilder] Building spider at (', x.toFixed(2), ',', y.toFixed(2), ')');

  // === Create Main Body ===
  // Central 1m × 1m square, dynamic rigid body
  // From Unity prefab: body sprite is 1x1, mass = 1.0 (line 1011)
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y)
    .setCcdEnabled(true) // Enable CCD for fast movement
    .setGravityScale(0)  // No gravity (spider uses forces only)
    .setLinearDamping(0)       // Unity prefab line 1012
    .setAngularDamping(0.05);  // Unity prefab line 1013

  const body = world.createRigidBody(bodyDesc);

  // Body collider with collision filtering to prevent self-collision
  // Collision group format: memberships(high 16 bits) | filter(low 16 bits)
  // - Spider parts: 0x00020001 (member of group 1, filter for group 0 only)
  // - Terrain: 0x0001FFFF (member of group 0, filter for all groups)
  // Spider parts WON'T collide with each other but WILL collide with terrain
  const bodyCollider = RAPIER.ColliderDesc.cuboid(0.5, 0.5) // half-extents
    .setDensity(1.0)  // Mass = density * area = 1.0 * (1.0 * 1.0) = 1.0 (matches Unity)
    .setFriction(0.3)
    .setRestitution(0.1)
    .setCollisionGroups(0x00020001); // Spider collision group

  world.createCollider(bodyCollider, body);

  console.log('[SpiderBuilder] Created body: 1.0m × 1.0m square, mass=1.0');

  // === Build Legs ===
  // From Unity SpiderController.cs line 183-194:
  // - Left leg attaches at body.x - 0.5 (left side of body)
  // - Right leg attaches at body.x + 0.5 (right side of body)

  const leftLeg = buildLeg(
    world,
    body,
    x - 0.5, // hip X (left side)
    y,       // hip Y (same as body)
    config,
    true     // isLeft
  );

  const rightLeg = buildLeg(
    world,
    body,
    x + 0.5, // hip X (right side)
    y,       // hip Y (same as body)
    config,
    false    // isLeft = false (right leg)
  );

  // Collect all bodies for cleanup and collision filtering
  const allBodies = [
    body,
    leftLeg.hip,
    leftLeg.knee,
    leftLeg.ankle,
    ...(leftLeg.foot ? [leftLeg.foot] : []),
    rightLeg.hip,
    rightLeg.knee,
    rightLeg.ankle,
    ...(rightLeg.foot ? [rightLeg.foot] : [])
  ];

  console.log('[SpiderBuilder] Spider assembly complete!');
  console.log('[SpiderBuilder]   Total bodies:', allBodies.length);
  console.log('[SpiderBuilder]   Left leg: 3 segments + foot');
  console.log('[SpiderBuilder]   Right leg: 3 segments + foot');

  return {
    body,
    leftLeg,
    rightLeg,
    allBodies,
    config
  };
}

/**
 * Build a single 3-segment leg with foot
 *
 * From Unity SpiderController.cs line 183-240:
 * - Each segment pivots at its proximal (near) end
 * - Segments are L1=1.3m, L2=1.0m, L3=0.7m
 * - Joints connect at segment endpoints
 * - Foot is kinematic, locked to ground
 *
 * @param world - Rapier world
 * @param body - Main body to attach to
 * @param hipX - Hip attachment X position (world)
 * @param hipY - Hip attachment Y position (world)
 * @param config - Spider configuration
 * @param isLeft - True for left leg, false for right
 * @returns ControllerLeg with all segments and foot
 */
function buildLeg(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  hipX: number,
  hipY: number,
  config: SpiderConfig,
  isLeft: boolean
): ControllerLeg {
  const legName = isLeft ? 'left' : 'right';
  console.log(`[SpiderBuilder] Building ${legName} leg at (${hipX.toFixed(2)}, ${hipY.toFixed(2)})`);

  // === Initial Pose ===
  // From Unity prefab lines 382-392, but adjusted for Y-down coordinate system
  // Unity uses Y-up, we use Y-down, so flip the angles
  // Original: Left leg: 130°, 100°, 40° | Right leg: 50°, -100°, -40°
  // Flipped: subtract from 360° to invert Y direction
  const angle1Deg = isLeft ? (360 - 130) : (360 - 50); // Left: 230°, Right: 310°
  const angle2Deg = isLeft ? -100 : 100; // Keep relative bends but flip sign
  const angle3Deg = isLeft ? -40 : 40;

  // Compute segment directions
  const dir1 = angleToDir(angle1Deg);
  const dir2 = rotateDir(dir1, angle2Deg);
  const dir3 = rotateDir(dir2, angle3Deg);

  // Compute joint positions (from Unity line 204-207)
  const L1 = config.segmentLength1;
  const L2 = config.segmentLength2;
  const L3 = config.segmentLength3;

  const kneeX = hipX + dir1.x * L1;
  const kneeY = hipY + dir1.y * L1;

  const ankleX = kneeX + dir2.x * L2;
  const ankleY = kneeY + dir2.y * L2;

  const footX = ankleX + dir3.x * L3;
  const footY = ankleY + dir3.y * L3;

  // === Create Segment Bodies ===
  // Masses from Unity prefab (baseSegmentMass=0.2, ratio=1.3):
  // - Hip (segment a): 0.2 (line 867, 1420)
  // - Knee (segment b): 0.15384616 (line 722, 577)
  // - Ankle (segment c): 0.118343204 (line 287, 1275)
  //
  // Rapier uses density, so we need: density = mass / area
  // All segments have width = 0.1
  const segmentWidth = 0.1;
  const segmentHalfWidth = segmentWidth / 2;

  // Calculate densities to achieve exact Unity masses
  const densityHip = 0.2 / (L1 * segmentWidth);           // 0.2 / 0.13 ≈ 1.538
  const densityKnee = 0.15384616 / (L2 * segmentWidth);   // 0.15384616 / 0.1 = 1.5385
  const densityAnkle = 0.118343204 / (L3 * segmentWidth); // 0.118343204 / 0.07 ≈ 1.690

  // Segment 1 (Hip)
  const hipDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(hipX, hipY)
    .setRotation(degToRad(angle1Deg))
    .setCcdEnabled(true)
    .setGravityScale(0)
    .setLinearDamping(0)       // Unity prefab line 868
    .setAngularDamping(0.05);  // Unity prefab line 869

  const hip = world.createRigidBody(hipDesc);

  const hipCollider = RAPIER.ColliderDesc.cuboid(L1 / 2, segmentHalfWidth)
    .setTranslation(L1 / 2, 0) // Offset so pivot is at left edge
    .setDensity(densityHip)
    .setFriction(0.3)
    .setRestitution(0.1)
    .setCollisionGroups(0x00020001); // Spider collision group

  world.createCollider(hipCollider, hip);

  // Segment 2 (Knee)
  const kneeDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(kneeX, kneeY)
    .setRotation(degToRad(angle1Deg + angle2Deg))
    .setCcdEnabled(true)
    .setGravityScale(0)
    .setLinearDamping(0)       // Unity prefab line 723
    .setAngularDamping(0.05);  // Unity prefab line 724

  const knee = world.createRigidBody(kneeDesc);

  const kneeCollider = RAPIER.ColliderDesc.cuboid(L2 / 2, segmentHalfWidth)
    .setTranslation(L2 / 2, 0)
    .setDensity(densityKnee)
    .setFriction(0.3)
    .setRestitution(0.1)
    .setCollisionGroups(0x00020001); // Spider collision group

  world.createCollider(kneeCollider, knee);

  // Segment 3 (Ankle)
  const ankleDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(ankleX, ankleY)
    .setRotation(degToRad(angle1Deg + angle2Deg + angle3Deg))
    .setCcdEnabled(true)
    .setGravityScale(0)
    .setLinearDamping(0)       // Unity prefab line 288
    .setAngularDamping(0.05);  // Unity prefab line 289

  const ankle = world.createRigidBody(ankleDesc);

  const ankleCollider = RAPIER.ColliderDesc.cuboid(L3 / 2, segmentHalfWidth)
    .setTranslation(L3 / 2, 0)
    .setDensity(densityAnkle)
    .setFriction(0.3)
    .setRestitution(0.1)
    .setCollisionGroups(0x00020001); // Spider collision group

  world.createCollider(ankleCollider, ankle);

  // === Create Foot ===
  // From Unity prefab line 138: m_BodyType: 2 (Kinematic)
  // Foot is 0.2m × 0.2m square, locked to ground
  // Note: Damping values still set in Unity even though kinematic
  const footDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(footX, footY);

  const foot = world.createRigidBody(footDesc);

  // Foot collider with collision filtering
  const footCollider = RAPIER.ColliderDesc.cuboid(0.1, 0.1) // Small 0.2m × 0.2m square
    .setDensity(1.0)
    .setFriction(0.8) // High friction for ground contact
    .setRestitution(0.0) // No bounce
    .setCollisionGroups(0x00020001); // Spider collision group

  world.createCollider(footCollider, foot);

  // === Create Revolute Joints ===
  // From Unity SpiderController.cs line 225-240
  // Joints connect at segment endpoints

  // Body ↔ Hip (at hip position)
  const bodyHipJoint = RAPIER.JointData.revolute(
    { x: hipX - body.translation().x, y: hipY - body.translation().y }, // anchor on body
    { x: 0, y: 0 } // anchor on hip (hip pivots at its origin)
  );
  world.createImpulseJoint(bodyHipJoint, body, hip, true);

  // Hip ↔ Knee (at knee position)
  const hipKneeJoint = RAPIER.JointData.revolute(
    { x: L1, y: 0 }, // anchor on hip (end of segment)
    { x: 0, y: 0 }   // anchor on knee (knee pivots at its origin)
  );
  world.createImpulseJoint(hipKneeJoint, hip, knee, true);

  // Knee ↔ Ankle (at ankle position)
  const kneeAnkleJoint = RAPIER.JointData.revolute(
    { x: L2, y: 0 }, // anchor on knee (end of segment)
    { x: 0, y: 0 }   // anchor on ankle (ankle pivots at its origin)
  );
  world.createImpulseJoint(kneeAnkleJoint, knee, ankle, true);

  // Ankle ↔ Foot (at foot position)
  const ankleFootJoint = RAPIER.JointData.revolute(
    { x: L3, y: 0 }, // anchor on ankle (end of segment)
    { x: 0, y: 0 }   // anchor on foot
  );
  world.createImpulseJoint(ankleFootJoint, ankle, foot, true);

  console.log(`[SpiderBuilder] ${legName} leg complete: hip→knee→ankle→foot`);

  return {
    hip,
    knee,
    ankle,
    foot,
    isLeft
  };
}
