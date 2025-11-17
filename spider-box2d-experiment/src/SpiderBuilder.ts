/**
 * Spider Builder for Box2D
 * Creates spider rig from scratch using Box2D bodies and joints
 * Ported from Unity spider.prefab
 */

import {
  b2World,
  b2BodyDef,
  b2FixtureDef,
  b2PolygonShape,
  b2RevoluteJointDef,
  b2BodyType,
  b2Vec2,
  b2JointType,
  XY,
} from '@box2d/core';
import type { SpiderAssembly, SpiderConfig, ControllerLeg } from './SpiderTypes';
import { DEFAULT_SPIDER_CONFIG } from './SpiderTypes';
import { degToRad } from './SpiderMath';

/**
 * Build spider rig in Box2D world
 *
 * Creates:
 * - Central body (1m × 1m square)
 * - 2 legs, each with 3 segments (hip, knee, ankle)
 * - 2 feet (kinematic, pinned to ground)
 * - Revolute joints connecting everything
 *
 * @param world - Box2D world
 * @param x - Initial X position (metres)
 * @param y - Initial Y position (metres)
 * @param config - Spider configuration
 * @returns Spider assembly with all bodies and references
 */
export function buildSpider(
  world: b2World,
  x: number,
  y: number,
  config: SpiderConfig = DEFAULT_SPIDER_CONFIG
): SpiderAssembly {
  const bodyDef: b2BodyDef = {
    type: b2BodyType.b2_dynamicBody,
    position: { x, y },
    angle: 0,
    linearDamping: 0,
    angularDamping: 0.05,
    gravityScale: 0,
  };

  const body = world.CreateBody(bodyDef);

  const bodyShape = new b2PolygonShape();
  bodyShape.SetAsBox(0.5, 0.5);

  const bodyFixture: b2FixtureDef = {
    shape: bodyShape,
    density: 1.0,
    friction: 0.3,
    restitution: 0.1,
  };

  body.CreateFixture(bodyFixture);

  const leftLeg = createLeg(
    world,
    body,
    config,
    true,
    new b2Vec2(x - 0.5, y)
  );

  const rightLeg = createLeg(
    world,
    body,
    config,
    false,
    new b2Vec2(x + 0.5, y)
  );

  const allBodies = [
    body,
    leftLeg.hip,
    leftLeg.knee,
    leftLeg.ankle,
    leftLeg.foot!,
    rightLeg.hip,
    rightLeg.knee,
    rightLeg.ankle,
    rightLeg.foot!,
  ];

  // Log positions once after building
  logSpiderPositions(body, leftLeg, rightLeg);

  return {
    body,
    leftLeg,
    rightLeg,
    allBodies,
    config,
  };
}

/**
 * Create a single leg (3 segments + foot)
 *
 * Leg structure:
 * - Body --[revolute]--> Hip --[revolute]--> Knee --[revolute]--> Ankle --[revolute]--> Foot
 * - Foot is kinematic (pinned to ground)
 * - Segments are centered between their connection joints
 * - Joints appear at segment ends (not centers)
 *
 * Initial pose:
 * - Segments angled to form a bent leg
 * - Matches Unity prefab initial angles
 */
function createLeg(
  world: b2World,
  body: any,
  config: SpiderConfig,
  isLeft: boolean,
  hipJointPos: XY
): ControllerLeg {

  // Segment lengths (from config)
  const L1 = config.segmentLength1; // 1.3m
  const L2 = config.segmentLength2; // 1.0m
  const L3 = config.segmentLength3; // 0.7m

  // Segment masses (calculated with ratio 1.3)
  const M1 = 0.2; // Base mass
  const M2 = 0.15384616; // M1 / 1.3
  const M3 = 0.118343204; // M2 / 1.3

  // Initial angles (degrees, from Unity prefab)
  // Left leg: segment1=130°, segment2=100° (relative), segment3=40° (relative)
  // Right leg: segment1=50°, segment2=-100° (relative), segment3=-40° (relative)
  const angle1 = isLeft ? 130 : 50; // Hip absolute angle
  const angle2 = isLeft ? 100 : -100; // Knee relative to hip
  const angle3 = isLeft ? 40 : -40; // Ankle relative to knee

  // === Calculate joint positions ===
  // Hip-to-knee joint
  const kneeJointPos = {
    x: hipJointPos.x + L1 * Math.cos(degToRad(angle1)),
    y: hipJointPos.y + L1 * Math.sin(degToRad(angle1)),
  };

  // Knee-to-ankle joint
  const ankleJointPos = {
    x: kneeJointPos.x + L2 * Math.cos(degToRad(angle1 + angle2)),
    y: kneeJointPos.y + L2 * Math.sin(degToRad(angle1 + angle2)),
  };

  // Ankle-to-foot joint
  const footJointPos = {
    x: ankleJointPos.x + L3 * Math.cos(degToRad(angle1 + angle2 + angle3)),
    y: ankleJointPos.y + L3 * Math.sin(degToRad(angle1 + angle2 + angle3)),
  };

  // === Create Hip Segment ===
  // Position center between body-to-hip and hip-to-knee joints
  const hipCenterX = hipJointPos.x + (L1 / 2) * Math.cos(degToRad(angle1));
  const hipCenterY = hipJointPos.y + (L1 / 2) * Math.sin(degToRad(angle1));

  const hip = createSegment(
    world,
    'hip',
    L1,
    0.1,
    M1,
    hipCenterX,
    hipCenterY,
    angle1
  );

  // === Create Knee Segment ===
  // Position center between hip-to-knee and knee-to-ankle joints
  const kneeCenterX = kneeJointPos.x + (L2 / 2) * Math.cos(degToRad(angle1 + angle2));
  const kneeCenterY = kneeJointPos.y + (L2 / 2) * Math.sin(degToRad(angle1 + angle2));

  const knee = createSegment(
    world,
    'knee',
    L2,
    0.1,
    M2,
    kneeCenterX,
    kneeCenterY,
    angle1 + angle2
  );

  // === Create Ankle Segment ===
  // Position center between knee-to-ankle and ankle-to-foot joints
  const ankleCenterX = ankleJointPos.x + (L3 / 2) * Math.cos(degToRad(angle1 + angle2 + angle3));
  const ankleCenterY = ankleJointPos.y + (L3 / 2) * Math.sin(degToRad(angle1 + angle2 + angle3));

  const ankle = createSegment(
    world,
    'ankle',
    L3,
    0.1,
    M3,
    ankleCenterX,
    ankleCenterY,
    angle1 + angle2 + angle3
  );

  // === Create Foot (kinematic, pinned to ground) ===
  const footDef: b2BodyDef = {
    type: b2BodyType.b2_kinematicBody, // Kinematic = fixed in place
    position: { x: footJointPos.x, y: footJointPos.y },
    angle: 0,
  };

  const foot = world.CreateBody(footDef);

  // Foot shape: 0.2m × 0.2m square
  const footShape = new b2PolygonShape();
  footShape.SetAsBox(0.1, 0.1);

  const footFixture: b2FixtureDef = {
    shape: footShape,
    density: 1.0,
  };

  foot.CreateFixture(footFixture);

  // === Create Joints ===
  // All joints connect at the segment start positions
  // Each segment's center is at its proximal joint, so local anchor is {0, 0}

  // Body -> Hip joint
  createRevoluteJoint(world, body, hip, hipJointPos);

  // Hip -> Knee joint
  createRevoluteJoint(world, hip, knee, kneeJointPos);

  // Knee -> Ankle joint
  createRevoluteJoint(world, knee, ankle, ankleJointPos);

  // Ankle -> Foot joint
  createRevoluteJoint(world, ankle, foot, footJointPos);

  return {
    hip,
    knee,
    ankle,
    foot,
    isLeft,
  };
}

/**
 * Create a leg segment (box-shaped rigid body)
 *
 * Segments are boxes with:
 * - Length along local X axis
 * - Width along local Y axis
 * - Center positioned between proximal and distal joints
 *
 * @param world - Box2D world
 * @param name - Segment name (for debugging)
 * @param length - Segment length (metres)
 * @param width - Segment width (metres)
 * @param mass - Segment mass (kg)
 * @param centerX - Center X position (midpoint between joints)
 * @param centerY - Center Y position (midpoint between joints)
 * @param angleDeg - Initial angle (degrees, 0 = pointing right)
 * @returns Created body
 */
function createSegment(
  world: b2World,
  name: string,
  length: number,
  width: number,
  mass: number,
  centerX: number,
  centerY: number,
  angleDeg: number
): any {
  const angleRad = degToRad(angleDeg);

  const bodyDef: b2BodyDef = {
    type: b2BodyType.b2_dynamicBody,
    position: { x: centerX, y: centerY },
    angle: angleRad,
    linearDamping: 0,
    angularDamping: 0.05,
    gravityScale: 0, // Zero gravity for spider segments
  };

  const body = world.CreateBody(bodyDef);

  // Segment shape: box with length × width
  const shape = new b2PolygonShape();
  shape.SetAsBox(length / 2, width / 2);

  const fixture: b2FixtureDef = {
    shape: shape,
    density: mass / (length * width), // Density = mass / area
    friction: 0.3,
    restitution: 0.1,
  };

  body.CreateFixture(fixture);

  return body;
}

/**
 * Create a revolute joint (hinge joint) between two bodies
 *
 * @param world - Box2D world
 * @param bodyA - First body (parent)
 * @param bodyB - Second body (child)
 * @param anchorWorld - Joint anchor position in world coordinates
 */
function createRevoluteJoint(
  world: b2World,
  bodyA: any,
  bodyB: any,
  anchorWorld: XY
): void {
  // Compute local anchors manually
  const posA = bodyA.GetPosition();
  const angleA = bodyA.GetAngle();
  const posB = bodyB.GetPosition();
  const angleB = bodyB.GetAngle();

  // Transform world anchor to local space for body A
  const localAnchorA = {
    x: Math.cos(-angleA) * (anchorWorld.x - posA.x) - Math.sin(-angleA) * (anchorWorld.y - posA.y),
    y: Math.sin(-angleA) * (anchorWorld.x - posA.x) + Math.cos(-angleA) * (anchorWorld.y - posA.y),
  };

  // Transform world anchor to local space for body B
  const localAnchorB = {
    x: Math.cos(-angleB) * (anchorWorld.x - posB.x) - Math.sin(-angleB) * (anchorWorld.y - posB.y),
    y: Math.sin(-angleB) * (anchorWorld.x - posB.x) + Math.cos(-angleB) * (anchorWorld.y - posB.y),
  };

  const jointDef: b2RevoluteJointDef = {
    type: b2JointType.e_revoluteJoint,
    bodyA: bodyA,
    bodyB: bodyB,
    localAnchorA: localAnchorA,
    localAnchorB: localAnchorB,
    enableMotor: false,
    enableLimit: false,
    collideConnected: false, // Don't collide connected bodies
  };

  world.CreateJoint(jointDef);
}

/**
 * Log all spider joint positions for debugging
 */
function logSpiderPositions(body: any, leftLeg: ControllerLeg, rightLeg: ControllerLeg): void {
  const bodyPos = body.GetPosition();

  console.log('=== SPIDER JOINT POSITIONS ===');
  console.log('Body center:', { x: bodyPos.x.toFixed(3), y: bodyPos.y.toFixed(3) });

  console.log('\nLeft Leg Joints:');
  const leftHipPos = leftLeg.hip.GetPosition();
  const leftHipAngle = leftLeg.hip.GetAngle();
  const leftKneePos = leftLeg.knee.GetPosition();
  const leftKneeAngle = leftLeg.knee.GetAngle();
  const leftAnklePos = leftLeg.ankle.GetPosition();
  const leftAnkleAngle = leftLeg.ankle.GetAngle();
  const leftFootPos = leftLeg.foot.GetPosition();

  // Calculate joint positions from segment centers and angles
  const leftJ1 = {
    x: (leftHipPos.x - 0.65 * Math.cos(leftHipAngle)).toFixed(3),
    y: (leftHipPos.y - 0.65 * Math.sin(leftHipAngle)).toFixed(3)
  };
  const leftJ2 = {
    x: (leftHipPos.x + 0.65 * Math.cos(leftHipAngle)).toFixed(3),
    y: (leftHipPos.y + 0.65 * Math.sin(leftHipAngle)).toFixed(3)
  };
  const leftJ3 = {
    x: (leftKneePos.x + 0.5 * Math.cos(leftKneeAngle)).toFixed(3),
    y: (leftKneePos.y + 0.5 * Math.sin(leftKneeAngle)).toFixed(3)
  };
  const leftJ4 = {
    x: (leftAnklePos.x + 0.35 * Math.cos(leftAnkleAngle)).toFixed(3),
    y: (leftAnklePos.y + 0.35 * Math.sin(leftAnkleAngle)).toFixed(3)
  };

  console.log('  Joint 1 (body-to-hip):', leftJ1);
  console.log('  Joint 2 (hip-to-knee):', leftJ2);
  console.log('  Joint 3 (knee-to-ankle):', leftJ3);
  console.log('  Joint 4 (ankle-to-foot):', leftJ4);
  console.log('  Foot center:', { x: leftFootPos.x.toFixed(3), y: leftFootPos.y.toFixed(3) });

  console.log('\nRight Leg Joints:');
  const rightHipPos = rightLeg.hip.GetPosition();
  const rightHipAngle = rightLeg.hip.GetAngle();
  const rightKneePos = rightLeg.knee.GetPosition();
  const rightKneeAngle = rightLeg.knee.GetAngle();
  const rightAnklePos = rightLeg.ankle.GetPosition();
  const rightAnkleAngle = rightLeg.ankle.GetAngle();
  const rightFootPos = rightLeg.foot.GetPosition();

  const rightJ1 = {
    x: (rightHipPos.x - 0.65 * Math.cos(rightHipAngle)).toFixed(3),
    y: (rightHipPos.y - 0.65 * Math.sin(rightHipAngle)).toFixed(3)
  };
  const rightJ2 = {
    x: (rightHipPos.x + 0.65 * Math.cos(rightHipAngle)).toFixed(3),
    y: (rightHipPos.y + 0.65 * Math.sin(rightHipAngle)).toFixed(3)
  };
  const rightJ3 = {
    x: (rightKneePos.x + 0.5 * Math.cos(rightKneeAngle)).toFixed(3),
    y: (rightKneePos.y + 0.5 * Math.sin(rightKneeAngle)).toFixed(3)
  };
  const rightJ4 = {
    x: (rightAnklePos.x + 0.35 * Math.cos(rightAnkleAngle)).toFixed(3),
    y: (rightAnklePos.y + 0.35 * Math.sin(rightAnkleAngle)).toFixed(3)
  };

  console.log('  Joint 1 (body-to-hip):', rightJ1);
  console.log('  Joint 2 (hip-to-knee):', rightJ2);
  console.log('  Joint 3 (knee-to-ankle):', rightJ3);
  console.log('  Joint 4 (ankle-to-foot):', rightJ4);
  console.log('  Foot center:', { x: rightFootPos.x.toFixed(3), y: rightFootPos.y.toFixed(3) });
  console.log('================================\n');
}
