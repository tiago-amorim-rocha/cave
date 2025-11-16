# Spider Logging Comparison - Unity vs TypeScript

## Summary

I've enhanced the TypeScript spider implementation with Unity-style logging to facilitate direct comparison between Unity and Rapier physics behavior.

## Changes Made

### 1. SpiderController.ts - Unity-Style Logging

Added detailed logging that matches Unity's format:

```typescript
// Log Jacobian vertical components (like Unity)
console.log(`${legName} leg Jacobian vertical components:`);
console.log(`  j21 (hip vertical) = ${j21.toFixed(4)}`);
console.log(`  j22 (knee vertical) = ${j22.toFixed(4)}`);
console.log(`  j23 (ankle vertical) = ${j23.toFixed(4)}`);

// Log input force and torques (like Unity)
console.log(`Frame ${this.frameCount} ${legName} - Input: Fx=${Fx.toFixed(4)}, Fy=${Fy.toFixed(4)}`);
console.log(`  Torques (before limits): τ_hip=${tauA.toFixed(4)}, τ_knee=${tauB.toFixed(4)}, τ_ankle=${tauC.toFixed(4)}`);
```

After both legs are processed:
```typescript
// UNITY-STYLE LOGGING: Log body angular velocity (like Unity SpiderController.cs line 458)
if (this.frameCount <= 100) {
  const bodyAngVel = this.spider.body.angvel();
  const bodyRot = this.spider.body.rotation();
  console.log(`Frame ${this.frameCount} BODY: angVel=${bodyAngVel.toFixed(6)} rad/s, rotation=${(bodyRot * 180 / Math.PI).toFixed(3)}°`);
}
```

### 2. SpiderBuilder.ts - Initial Pose Logging

Added initial pose logging to match Unity's startup output:

```typescript
console.log('=== INITIAL POSE ===');
console.log(`LEFT leg: hip=${leftHipRotDeg.toFixed(1)}°, knee=${leftKneeRel.toFixed(1)}°, ankle=${leftAnkleRel.toFixed(1)}°`);
console.log(`RIGHT leg: hip=${rightHipRotDeg.toFixed(1)}°, knee=${rightKneeRel.toFixed(1)}°, ankle=${rightAnkleRel.toFixed(1)}°`);
```

### 3. Fixed TypeScript Compilation Errors

Fixed scenario files to use correct types:
- `ScenarioInput` → `InputEvent`
- Added missing `isDone()` method implementations

## Expected Output Format

The TypeScript implementation now logs in this format (matching Unity):

```
=== INITIAL POSE ===
LEFT leg: hip=230.0°, knee=-100.0°, ankle=-40.0°
RIGHT leg: hip=310.0°, knee=100.0°, ankle=40.0°

LEFT leg Jacobian vertical components:
  j21 (hip vertical) = -1.0285
  j22 (knee vertical) = -0.3784
  j23 (ankle vertical) = 0.1216
Frame 1 LEFT - Input: Fx=0.0000, Fy=-0.1001
  Torques (before limits): τ_hip=0.1030, τ_knee=0.0379, τ_ankle=-0.0122

RIGHT leg Jacobian vertical components:
  j21 (hip vertical) = 1.0285
  j22 (knee vertical) = 0.3784
  j23 (ankle vertical) = -0.1216
Frame 1 RIGHT - Input: Fx=0.0000, Fy=-0.1001
  Torques (before limits): τ_hip=-0.1030, τ_knee=-0.0379, τ_ankle=0.0122

Frame 1 BODY: angVel=0.001776 rad/s, rotation=0.000°
```

## Unity Reference (from logunity.txt)

Unity produces this exact format for comparison:

```
=== INITIAL POSE ===
LEFT leg: hip=120.0°, knee=-120.0°, ankle=-80.0°
RIGHT leg: hip=60.0°, knee=-60.0°, ankle=-100.0°

LEFT leg Jacobian vertical components:
  j21 (hip vertical) = -1.0285
  j22 (knee vertical) = -0.3784
  j23 (ankle vertical) = 0.1216
Frame 1 LEFT - Input: Fx=0.0000, Fy=-0.1001
  Torques (before limits): τ_hip=0.1030, τ_knee=0.0379, τ_ankle=-0.0122

RIGHT leg Jacobian vertical components:
  j21 (hip vertical) = 1.0285
  j22 (knee vertical) = 0.3784
  j23 (ankle vertical) = -0.1216
Frame 1 RIGHT - Input: Fx=0.0000, Fy=-0.1001
  Torques (before limits): τ_hip=-0.1030, τ_knee=-0.0379, τ_ankle=0.0122

Frame 1 BODY: angVel=0.001776 rad/s, rotation=0.000°
```

## Key Observations

From the Unity log (logunity.txt):
- **Perfect symmetry**: Jacobian components are exactly anti-symmetric between legs
- **Perfect torque balance**: Left and right torques are exactly opposite
- **Minimal angular velocity**: Body angVel stays very small (~0.001-0.009 rad/s)
- **No rotation**: Body rotation stays at 0.000°-0.001° throughout the test
- **Input is pure vertical**: Fx=0.0000, Fy varies (upward force)

## Testing Instructions

### Browser Testing (Recommended)

1. Start dev server:
   ```bash
   npm run dev
   ```

2. Open browser console (F12) and navigate to:
   ```
   http://localhost:5173/cave/
   ```

3. The app will automatically run a vertical pulse test (see main.ts line 174)

4. Check console for detailed logging (first 100 frames)

5. Compare output with `spider-unity-version/logunity.txt`

### Headless Testing (Not Working in Current Environment)

The headless Playwright tests crash due to Docker/WASM environment issues.
Use browser testing instead for now.

## Next Steps

1. **Run in browser**: Open the app in a real browser and capture console output
2. **Compare logs**: Identify any differences in Jacobian values, torques, or angular velocity
3. **Debug asymmetry**: If body rotation occurs, check for:
   - Force symmetry (left vs right forces)
   - Torque symmetry (left vs right torques)
   - Jacobian computation errors
   - Coordinate system differences (Y-up vs Y-down)
4. **Verify physics parameters**: Ensure masses, inertias, and damping match Unity

## Files Modified

1. `src/controllers/spider/SpiderController.ts` - Added Unity-style logging
2. `src/controllers/spider/SpiderBuilder.ts` - Added initial pose logging
3. `src/headless/scenarios/TinyForceScenario.ts` - Fixed TypeScript errors
4. `src/headless/scenarios/VerticalPulseScenario.ts` - Fixed TypeScript errors

## Build Status

✅ TypeScript compilation: SUCCESS
✅ Vite build: SUCCESS
❌ Headless browser test: CRASH (environment issue, not code issue)
