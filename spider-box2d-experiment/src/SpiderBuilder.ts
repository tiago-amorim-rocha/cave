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
    new b2Vec2(x - 0.5, y),
    new b2Vec2(x - 0.5 - config.segmentLength1 * Math.cos(degToRad(60)),
              y - config.segmentLength1 * Math.sin(degToRad(60)))
  );

  const rightLeg = createLeg(
    world,
    body,
    config,
    false,
    new b2Vec2(x + 0.5, y),
    new b2Vec2(x + 0.5 + config.segmentLength1 * Math.cos(degToRad(60)),
              y - config.segmentLength1 * Math.sin(degToRad(60)))
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
  hipPos: XY,
  footPos: XY
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
  // Left leg: segment1=120°, segment2=30° (relative), segment3=30° (relative)
  // Right leg: segment1=60°, segment2=-30° (relative), segment3=-30° (relative)
  const angle1 = isLeft ? 120 : 60; // Hip absolute angle
  const angle2 = isLeft ? 30 : -30; // Knee relative to hip
  const angle3 = isLeft ? 30 : -30; // Ankle relative to knee

  // === Create Hip Segment (segment1: body -> knee) ===
  const hip = createSegment(
    world,
    'hip',
    L1,
    0.1,
    M1,
    hipPos.x,
    hipPos.y,
    angle1
  );

  // === Create Knee Segment (segment2: knee -> ankle) ===
  const kneePos = {
    x: hipPos.x + L1 * Math.cos(degToRad(angle1)),
    y: hipPos.y + L1 * Math.sin(degToRad(angle1)),
  };

  const knee = createSegment(
    world,
    'knee',
    L2,
    0.1,
    M2,
    kneePos.x,
    kneePos.y,
    angle1 + angle2
  );

  // === Create Ankle Segment (segment3: ankle -> foot) ===
  const anklePos = {
    x: kneePos.x + L2 * Math.cos(degToRad(angle1 + angle2)),
    y: kneePos.y + L2 * Math.sin(degToRad(angle1 + angle2)),
  };

  const ankle = createSegment(
    world,
    'ankle',
    L3,
    0.1,
    M3,
    anklePos.x,
    anklePos.y,
    angle1 + angle2 + angle3
  );

  // === Create Foot (kinematic, pinned to ground) ===
  const footDef: b2BodyDef = {
    type: b2BodyType.b2_kinematicBody, // Kinematic = fixed in place
    position: { x: footPos.x, y: footPos.y },
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
  // All joints are revolute joints (hinge joints in Unity)

  // Body -> Hip joint (at hip proximal end)
  createRevoluteJoint(world, body, hip, hipPos);

  // Hip -> Knee joint (at knee proximal end)
  createRevoluteJoint(world, hip, knee, kneePos);

  // Knee -> Ankle joint (at ankle proximal end)
  createRevoluteJoint(world, knee, ankle, anklePos);

  // Ankle -> Foot joint (at foot position)
  // Calculate foot position based on ankle tip
  const footJointPos = {
    x: anklePos.x + L3 * Math.cos(degToRad(angle1 + angle2 + angle3)),
    y: anklePos.y + L3 * Math.sin(degToRad(angle1 + angle2 + angle3)),
  };
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
 * - Pivot at left end (proximal joint)
 *
 * @param world - Box2D world
 * @param name - Segment name (for debugging)
 * @param length - Segment length (metres)
 * @param width - Segment width (metres)
 * @param mass - Segment mass (kg)
 * @param x - Initial X position (centre of box)
 * @param y - Initial Y position (centre of box)
 * @param angleDeg - Initial angle (degrees, 0 = pointing right)
 * @returns Created body
 */
function createSegment(
  world: b2World,
  name: string,
  length: number,
  width: number,
  mass: number,
  x: number,
  y: number,
  angleDeg: number
): any {
  // Position at the PROXIMAL end (left end of segment)
  // Box2D centres are at the middle, so we offset by half-length along the angle
  const angleRad = degToRad(angleDeg);
  const centerX = x + (length / 2) * Math.cos(angleRad);
  const centerY = y + (length / 2) * Math.sin(angleRad);

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
