# Fix: Spider Initial Upward Movement

## Problem Summary

The spider was moving upward immediately after initialization, even without any user input. This should not happen - in the Unity version, the spider remains perfectly stable until the user provides input.

## Root Cause Analysis

After comparing the Box2D implementation with the Unity prefab, I found **two critical configuration mismatches**:

### 1. Incorrect Initial Joint Angles

**Unity Prefab (spider.prefab lines 382-392):**
```
Left Leg:
  - angle1Deg: 130° (hip absolute angle)
  - angle2Deg: 100° (knee relative bend)
  - angle3Deg: 40° (ankle relative bend)

Right Leg:
  - angle1Deg: 50° (hip absolute angle)
  - angle2Deg: -100° (knee relative bend)
  - angle3Deg: -40° (ankle relative bend)
```

**Box2D Implementation (BEFORE FIX):**
```
Left Leg:
  - angle1: 120° (❌ should be 130°)
  - angle2: 30° (❌ should be 100°)
  - angle3: 30° (❌ should be 40°)

Right Leg:
  - angle1: 60° (❌ should be 50°)
  - angle2: -30° (❌ should be -100°)
  - angle3: -30° (❌ should be -40°)
```

### 2. Incorrect Hip Joint Limits

**Unity Prefab (lines 413-414):**
```
hipLimitFreeMin: 281.2° (normalizes to -78.8°)
hipLimitFreeMax: 436.5° (normalizes to 76.5°)
```

**Box2D Implementation (BEFORE FIX):**
```
hipLimitFreeMin: 0.0° (❌ should be -78.8°)
hipLimitFreeMax: 60.0° (❌ should be 76.5°)
```

## Why This Caused Upward Movement

The spider uses **joint limit springs** to constrain joint angles to valid ranges. With the incorrect configuration:

1. The legs were initialized at angles **outside** the valid joint limit ranges
2. The joint limit spring forces tried to pull the joints back into the "free" range
3. These corrective forces created a net upward force on the body
4. The constraint solver applied these forces every physics step, causing continuous upward drift

## The Fix

### File: `spider-box2d-experiment/src/SpiderBuilder.ts` (lines 137-142)

**BEFORE:**
```typescript
const angle1 = isLeft ? 120 : 60;
const angle2 = isLeft ? 30 : -30;
const angle3 = isLeft ? 30 : -30;
```

**AFTER:**
```typescript
const angle1 = isLeft ? 130 : 50;
const angle2 = isLeft ? 100 : -100;
const angle3 = isLeft ? 40 : -40;
```

### File: `spider-box2d-experiment/src/SpiderTypes.ts` (lines 107-108)

**BEFORE:**
```typescript
hipLimitFreeMin: 0.0,
hipLimitFreeMax: 60.0,
```

**AFTER:**
```typescript
hipLimitFreeMin: -78.8,
hipLimitFreeMax: 76.5,
```

## Expected Behavior After Fix

✅ **Initial state**: Spider remains perfectly stable at y=0
✅ **No input**: No upward drift or movement
✅ **With UP input**: Spider extends legs and pushes body upward as intended

## Testing Instructions

1. Run the experiment:
   ```bash
   cd spider-box2d-experiment
   npm run dev
   ```

2. Open browser to the local server

3. **Verify NO upward movement without input:**
   - Watch the spider for 5-10 seconds
   - Body should remain at y=0 (or very close, accounting for numerical error)
   - No visible drift or oscillation

4. **Verify UP input works:**
   - Press and hold the "UP ↑" button
   - Spider should extend legs and push body upward
   - Release button - spider should stabilize

## Technical Notes

- Unity uses `Mathf.DeltaAngle()` to normalize angles to [-180°, 180°]
- Hip joint limits are relative to the **radial direction** from body center to hip, not absolute world angle
- The joint limit springs use PD control: `τ = Kp * error - Kd * velocity`
- Default spring constants: Kp=0.1, Kd=0.05
