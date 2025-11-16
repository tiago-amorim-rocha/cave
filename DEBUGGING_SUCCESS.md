# Debugging Success: Jacobian and Torque Asymmetry Resolved

## Problem Statement

The Rapier spider physics implementation showed high torque asymmetry causing unwanted body rotation, while Unity's implementation had perfect torque anti-symmetry and zero rotation.

## Root Cause

**Wrong initial joint angles** in SpiderBuilder.ts caused incorrect Jacobian calculations.

### What Was Wrong

**Original (INCORRECT) setup:**
```typescript
// LEFT leg
const angle1Deg = 240;  // Hip absolute -120°
const angle2Deg = 120;  // Knee RELATIVE → knee_abs = -120° + 120° = 0° ✗
const angle3Deg = 80;   // Ankle RELATIVE → ankle_abs = 0° + 80° = 80° ✗
```

This gave absolute rotations:
- hip = -120° ✓
- knee = 0° ✗ (should be -120°!)
- ankle = 80° ✗ (should be -80°!)

**Result:** Wrong Jacobian angle sums
- thetaA + thetaB = -120° + 120° = 0°
- cos(0°) = 1.0 (but Unity had cos(-120°) = -0.5!)
- j21 = 0.4716, j22 = 1.1216 (completely wrong signs!)

## The Fix

**Corrected setup:**
```typescript
// LEFT leg
const angle1Deg = 240;  // Hip absolute -120°
const angle2Deg = 0;    // Knee RELATIVE → knee_abs = -120° + 0° = -120° ✓
const angle3Deg = 40;   // Ankle RELATIVE → ankle_abs = -120° + 40° = -80° ✓
```

This gives absolute rotations:
- hip = -120° ✓
- knee = -120° ✓
- ankle = -80° ✓

**Result:** Correct Jacobian angle sums
- thetaA + thetaB = -120° + 0° = -120°
- cos(-120°) = -0.5 ✓
- j21 = -1.0284, j22 = -0.3784 ✓ (matching Unity!)

## Verification Results

### Frame 1 Comparison - LEFT Leg

**Unity:**
```
Raw rotations: hip=120°, knee=-120°, ankle=-80° (Y-up)
Jacobian: j21=-1.0285, j22=-0.3784, j23=0.1216
Torques: τ_hip=0.1030, τ_knee=0.0379, τ_ankle=-0.0122
```

**Rapier (AFTER FIX):**
```
Raw rotations: hip=-120°, knee=-120°, ankle=-80° (Y-down)
Jacobian: j21=-1.0284, j22=-0.3784, j23=0.1216
Torques: τ_hip=0.1028, τ_knee=0.0378, τ_ankle=-0.0122
```

**Differences:**
- j21: -0.0001 (0.01% error) ✓
- j22: 0.0000 (EXACT) ✓
- j23: 0.0000 (EXACT) ✓
- τ_hip: -0.0002 (0.19% error) ✓
- τ_knee: -0.0001 (0.26% error) ✓
- τ_ankle: 0.0000 (EXACT) ✓

### Frame 1 Comparison - RIGHT Leg

**Unity:**
```
Jacobian: j21=1.0285, j22=0.3784, j23=-0.1216
Torques: τ_hip=-0.1030, τ_knee=-0.0379, τ_ankle=0.0122
```

**Rapier (AFTER FIX):**
```
Jacobian: j21=1.0284, j22=0.3784, j23=-0.1216
Torques: τ_hip=-0.1028, τ_knee=-0.0378, τ_ankle=0.0122
```

**Perfect Anti-Symmetry:** LEFT = -RIGHT for all values ✓

## Discovery Process

### 1. Detailed Angle Logging

Added comprehensive logging to SpiderController.ts showing:
- Raw Rapier rotations (hip, knee, ankle)
- Computed Jacobian angles (thetaA, thetaB, thetaC)
- Angle sums (thetaA+thetaB, thetaA+thetaB+thetaC)
- Trigonometric values (cos, sin of all sums)
- Step-by-step Jacobian calculation

### 2. Reverse Engineering

Created Python script (`/tmp/find_unity_angles.py`) to find ALL possible angle combinations that produce Unity's Jacobian values:

```python
# From Unity's Jacobian:
j21 = -1.0285 → cos(thetaA) = -0.5 → thetaA = ±120°
j22 = -0.3784 → cos(thetaA+thetaB) = -0.5 → thetaA+thetaB = ±120°
j23 = 0.1216 → cos(thetaA+thetaB+thetaC) = 0.1736 → thetaA+thetaB+thetaC = ±80°
```

Found 8 possible angle combinations, identified the one matching Y-down coordinates:
```
Absolute rotations:
  hip.rotation = -120.0°
  knee.rotation = -120.0°  ← KEY FINDING!
  ankle.rotation = -80.0°
```

### 3. Additional Fix: Torque Logging

Found that logged torques included `torqueGain = 2.0` scaling factor.
Fixed by saving pre-gain torques and logging those instead:

```typescript
// Save pre-gain torques for logging (to match Unity's output)
const tauA_preGain = tauA;
const tauB_preGain = tauB;
const tauC_preGain = tauC;

// Apply gain
tauA = clamp(tauA * this.config.torqueGain, ...);

// Log pre-gain values
console.log(`Torques (before gain/limits): τ_hip=${tauA_preGain.toFixed(4)}...`);
```

## Files Modified

1. **src/controllers/spider/SpiderBuilder.ts**
   - Fixed initial joint angles: knee and ankle relative rotations
   - Updated comments with reverse-engineered angle calculation
   - LEFT: angle2Deg = 0 (was 120), angle3Deg = 40 (was 80)
   - RIGHT: angle2Deg = 0 (was 60), angle3Deg = -40 (was 100)

2. **src/controllers/spider/SpiderController.ts**
   - Added detailed angle debugging logs
   - Saved pre-gain torques for accurate logging
   - Updated torque log message to clarify "before gain/limits"

## Key Insights

1. **Unity's coordinate convention:** Unity logs showed "knee=-120°" which looked like a relative angle, but was actually the absolute rotation of the knee rigid body.

2. **Initial pose geometry:** In the correct initial pose, the hip-to-knee and knee-to-ankle segments both point in the same direction (-120° in Y-down), creating a nearly straight leg.

3. **Jacobian sensitivity:** Small angle errors (120° difference in knee absolute rotation) completely flip the signs of Jacobian components j21 and j22, causing torque asymmetry and body rotation.

4. **Y-up to Y-down conversion:** The transformation θ_ydown = -θ_yup correctly converts Unity's Y-up angles to Rapier's Y-down, but we must apply it to ALL joint absolute rotations, not just the hip.

## Next Steps

With perfect Jacobian and torque matching:
- ✅ Zero body rotation expected (torques are anti-symmetric)
- ✅ Spider should move vertically upward smoothly
- ✅ Can now test other scenarios (horizontal movement, jumping, etc.)
- ✅ Ready to implement advanced features (rotation stabilization, joint limits)

## Lessons Learned

1. **Reverse engineering works:** When direct comparison fails, mathematically deduce the correct values from known outputs.
2. **Log everything:** Detailed logging at every step reveals subtle bugs.
3. **Coordinate systems matter:** Y-up vs Y-down requires careful angle transformation for ALL joints.
4. **Jacobian is sensitive:** Small angle errors cause large Jacobian errors due to trigonometric functions.
5. **Match reference implementation:** When debugging physics, match EVERY value from the reference (Unity) - Jacobian, torques, angles, etc.

## Test Command

```bash
npm run headless
```

Expected output: Jacobian and torque values matching Unity within 0.3% error, perfect anti-symmetry between left and right legs.
