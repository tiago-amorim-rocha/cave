# Spider Initial Angle Analysis

## Unity Prefab (spider.prefab, lines 382-392)
**Left Leg:**
- angle1Deg: 130° (absolute, world-space)
- angle2Deg: 100° (relative bend from segment1)
- angle3Deg: 40° (relative bend from segment2)

**Right Leg:**
- angle1Deg: 50° (absolute, world-space)
- angle2Deg: -100° (relative bend from segment1)
- angle3Deg: -40° (relative bend from segment2)

## Box2D Implementation (SpiderBuilder.ts, lines 140-142)
**Left Leg:**
- angle1: 120° (should be 130°)
- angle2: 30° (should be 100°)
- angle3: 30° (should be 40°)

**Right Leg:**
- angle1: 60° (should be 50°)
- angle2: -30° (should be -100°)
- angle3: -30° (should be -40°)

## Hip Joint Limits

**Unity Prefab (lines 413-414):**
- hipLimitFreeMin: 281.2° (wraps to -78.8°)
- hipLimitFreeMax: 436.5° (wraps to 76.5°)

**Box2D Config (SpiderTypes.ts, lines 107-108):**
- hipLimitFreeMin: 0.0°
- hipLimitFreeMax: 60.0°

## Problem Analysis

The Box2D implementation has **incorrect initial angles** that don't match Unity:

1. **Segment angles are wrong** - The relative bend angles are much smaller (30° vs 100°)
2. **Hip joint limits are wrong** - Different range entirely
3. **Initial configuration creates constraint violations** - When Box2D tries to enforce joint limits, the spider is pulled upward

## Why the Spider Moves Upward

With `enableHipJointLimits = true` and the current angles:
- The hip segments are initialized at angles that violate the joint limit springs
- The constraint solver tries to pull them into the "free" range
- This creates forces that push the body upward
