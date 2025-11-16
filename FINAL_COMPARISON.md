# Final Rapier vs Unity Comparison

## Test Setup

- **Date**: 2025-11-16
- **Rapier Output**: `headless-with-input.txt` (proper headless test)
- **Unity Output**: `spider-unity-version/logunity.txt`
- **Test**: Vertical pulse (upward force Fy ≈ -0.1)

## ✅ Fixed: Initial Pose Now Matches Unity!

### Unity Y-up Pose (Runtime):
```
LEFT leg: hip=120.0°, knee=-120.0°, ankle=-80.0°
RIGHT leg: hip=60.0°, knee=-60.0°, ankle=-100.0°
```

### Rapier Y-down Pose (After Conversion):
```
LEFT leg: hip=-120.0°, knee=120.0°, ankle=80.0°
RIGHT leg: hip=-60.0°, knee=60.0°, ankle=100.0°
```

**Conversion formula**: θ_ydown = -θ_yup (negate all angles for Y-axis flip)

## 🔍 Frame 1 Detailed Comparison

### Unity Frame 1 (from logunity.txt):
```
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

### Rapier Frame 1 (NEW):
```
LEFT leg Jacobian vertical components:
  j21 (hip vertical) = 0.4716
  j22 (knee vertical) = 1.1216
  j23 (ankle vertical) = 0.1216
Frame 1 LEFT - Input: Fx=0.0000, Fy=-0.1000
  Torques (before limits): τ_hip=-0.0943, τ_knee=-0.2243, τ_ankle=-0.0243

RIGHT leg Jacobian vertical components:
  j21 (hip vertical) = 1.5284
  j22 (knee vertical) = 0.8784
  j23 (ankle vertical) = -0.1216
Frame 1 RIGHT - Input: Fx=0.0000, Fy=-0.1000
  Torques (before limits): τ_hip=-0.3057, τ_knee=-0.1757, τ_ankle=0.0243

Frame 1 BODY: angVel=0.000000 rad/s, rotation=0.000°
```

## 📊 Critical Findings

### 1. ✅ Ankle Jacobian MATCHES Exactly!
| Component | Unity | Rapier | Match |
|-----------|-------|--------|-------|
| LEFT j23 | 0.1216 | 0.1216 | ✅ EXACT |
| RIGHT j23 | -0.1216 | -0.1216 | ✅ EXACT |

### 2. ❌ Hip and Knee Jacobians DON'T Match
| Component | Unity LEFT | Rapier LEFT | Unity RIGHT | Rapier RIGHT |
|-----------|-----------|-------------|-------------|--------------|
| j21 (hip) | **-1.0285** | **0.4716** | 1.0285 | 1.5284 |
| j22 (knee) | **-0.3784** | **1.1216** | 0.3784 | 0.8784 |

**Analysis**:
- Unity j21 + j22 (LEFT): -1.0285 + (-0.3784) = **-1.4069**
- Rapier j21 + j22 (LEFT): 0.4716 + 1.1216 = **1.5932**
- These should sum to the same value if the poses match!

### 3. ❌ Torque Asymmetry in Rapier
**Unity** (perfect anti-symmetry):
- LEFT hip: +0.1030, RIGHT hip: -0.1030 ✓
- LEFT knee: +0.0379, RIGHT knee: -0.0379 ✓
- LEFT ankle: -0.0122, RIGHT ankle: +0.0122 ✓

**Rapier** (ASYMMETRIC):
- LEFT hip: -0.0943, RIGHT hip: -0.3057 ❌ (ratio: 3.24x!)
- LEFT knee: -0.2243, RIGHT knee: -0.1757 ❌ (ratio: 1.28x)
- LEFT ankle: -0.0243, RIGHT ankle: +0.0243 ✓ (anti-symmetric)

### 4. ✅ Body Angular Velocity
- **Unity Frame 1**: 0.001776 rad/s (small rotation already present)
- **Rapier Frame 1**: 0.000000 rad/s (perfect zero - correct for first frame!)
- **Rapier Frame 2**: 0.003496 rad/s (starts to develop rotation)

## 🎯 Root Cause: Jacobian Calculation Issue

The ankle Jacobian (j23) matches exactly, but hip (j21) and knee (j22) don't. This suggests:

### Hypothesis 1: Initial Pose Still Doesn't Match
Even though we converted the angles, the actual joint configuration might differ due to:
- Joint attachment points
- Segment pivot locations
- Coordinate system differences beyond just Y-axis flip

### Hypothesis 2: Jacobian Sign Error
The opposite signs on j21 and j22 (Unity negative, Rapier positive for LEFT leg) suggest a systematic sign flip in the Jacobian calculation.

### Hypothesis 3: Joint Angle Convention Difference
Unity might use different angle conventions:
- Absolute vs relative angles
- Clockwise vs counter-clockwise
- Different zero reference

## 🔬 Verification Steps

### Check 1: Verify Absolute Joint Angles
Log the ABSOLUTE angles (not relative) for hip, knee, ankle in both implementations to ensure they truly match.

### Check 2: Verify Segment Endpoint Positions
Calculate the actual (x, y) positions of hip, knee, ankle, and foot in world space and compare.

### Check 3: Verify Jacobian Formula
Double-check the Jacobian calculation in `SpiderController.ts` lines 256-262 against Unity's implementation.

### Unity Jacobian (from SpiderController.cs):
```csharp
// J matrix rows for X and Y
float j11 = -l1 * Mathf.Sin(thetaA) - l2 * Mathf.Sin(thetaA + thetaB) - l3 * Mathf.Sin(thetaA + thetaB + thetaC);
float j12 = -l2 * Mathf.Sin(thetaA + thetaB) - l3 * Mathf.Sin(thetaA + thetaB + thetaC);
float j13 = -l3 * Mathf.Sin(thetaA + thetaB + thetaC);

float j21 = l1 * Mathf.Cos(thetaA) + l2 * Mathf.Cos(thetaA + thetaB) + l3 * Mathf.Cos(thetaA + thetaB + thetaC);
float j22 = l2 * Mathf.Cos(thetaA + thetaB) + l3 * Mathf.Cos(thetaA + thetaB + thetaC);
float j23 = l3 * Mathf.Cos(thetaA + thetaB + thetaC);
```

### Rapier Jacobian (from SpiderController.ts):
```typescript
const j11 = -l1 * sA - l2 * sAB - l3 * sABC;
const j12 = -l2 * sAB - l3 * sABC;
const j13 = -l3 * sABC;

const j21 = l1 * cA + l2 * cAB + l3 * cABC;
const j22 = l2 * cAB + l3 * cABC;
const j23 = l3 * cABC;
```

**The formulas are IDENTICAL!** So the issue must be in the angles themselves.

## 🚨 Most Likely Issue: Angle Interpretation

The ankle Jacobian matches, which uses `thetaA + thetaB + thetaC`. But hip and knee don't match, which use just `thetaA` and `thetaA + thetaB`.

This suggests:
1. **thetaC is correct** (ankle relative angle)
2. **thetaA or thetaB is wrong** (hip absolute or knee relative)

## 📝 Next Steps

1. **Add detailed angle logging** in SpiderController.update() to show:
   - Hip absolute rotation (from Rapier)
   - Knee absolute rotation (from Rapier)
   - Ankle absolute rotation (from Rapier)
   - thetaA, thetaB, thetaC (computed values)

2. **Compare with Unity's logged angles** to find the discrepancy

3. **Check if angles need additional conversion** beyond simple negation for Y-down

4. **Verify segment lengths** (l1=1.3, l2=1.0, l3=0.7) match Unity

## 🎭 Current Status

✅ **Working**:
- Headless test infrastructure
- Vertical input injection
- Initial pose conversion (mostly)
- Ankle Jacobian calculation

❌ **Broken**:
- Hip and knee Jacobian values
- Torque symmetry between legs
- Body rotation prevention

The spider WILL rotate because the torques are asymmetric, which creates a net angular impulse on the body.
