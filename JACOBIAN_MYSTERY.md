# Jacobian Mystery - Why Don't the Values Match?

## The Problem

**Rapier Frame 1 LEFT leg:**
- Raw rotations: hip=-120.000°, knee=0.000°, ankle=80.000°
- Computed angles: thetaA=-120°, thetaB=120°, thetaC=80°
- Angle sums: thetaA=-120°, thetaA+thetaB=0°, thetaA+thetaB+thetaC=80°
- **Jacobian**: j21=0.4716, j22=1.1216, j23=0.1216

**Unity Frame 1 LEFT leg:**
- Logged pose: hip=120.0°, knee=-120.0°, ankle=-80.0°
- **Jacobian**: j21=-1.0285, j22=-0.3784, j23=0.1216

## Observation 1: j23 Matches Perfectly

Both systems have j23 = 0.1216, which means:
```
j23 = l3 * cos(thetaA + thetaB + thetaC) = 0.7 * cos(θ_sum) = 0.1216
cos(θ_sum) = 0.1736
θ_sum = ±80° (or ±100°)
```

Since j23 is positive, we know cos(θ_sum) > 0, which means |θ_sum| < 90°.

- Rapier: thetaA+thetaB+thetaC = 80° ✓
- Unity: thetaA+thetaB+thetaC = -80° (also gives cos(-80°) = cos(80°) = 0.1736) ✓

## Observation 2: j21 and j22 Have OPPOSITE Signs

This is the mystery! Both are positive in Rapier but negative in Unity.

## Reverse-Engineering Unity's Angles from Jacobian

From Unity's Jacobian values, we can deduce:

### From j23 = 0.1216:
```
cos(thetaA + thetaB + thetaC) = 0.1736
thetaA + thetaB + thetaC = ±80°
```

### From j22 = -0.3784:
```
j22 = l2*cos(thetaA+thetaB) + l3*cos(thetaA+thetaB+thetaC)
-0.3784 = 1.0*cos(thetaA+thetaB) + 0.1216
cos(thetaA+thetaB) = -0.5000
thetaA + thetaB = ±120° (or ±240°)
```

### From j21 = -1.0285:
```
j21 = l1*cos(thetaA) + l2*cos(thetaA+thetaB) + l3*cos(thetaA+thetaB+thetaC)
-1.0285 = 1.3*cos(thetaA) + 1.0*(-0.5) + 0.1216
-1.0285 = 1.3*cos(thetaA) - 0.3784
1.3*cos(thetaA) = -0.6501
cos(thetaA) = -0.5001
thetaA = ±120° (or ±240°)
```

## Unity's Actual Angles (Reverse-Engineered)

From the Jacobian, Unity MUST have:
- thetaA = 120° (or -120° or ±240°)
- thetaA + thetaB = 120° (to get cos = -0.5)
- thetaA + thetaB + thetaC = -80° (to get cos = 0.1736 and positive j23)

If thetaA = 120°:
- thetaB = 120° - 120° = 0°
- thetaC = -80° - 120° = -200° (≡ 160°)

But Unity's logged initial pose says:
```
LEFT leg: hip=120.0°, knee=-120.0°, ankle=-80.0°
```

## The Contradiction

If Unity's logged values mean:
- hip absolute rotation = 120°
- knee RELATIVE rotation = -120°
- ankle RELATIVE rotation = -80°

Then Unity's absolute rotations would be:
- hip = 120°
- knee = 120° + (-120°) = 0°
- ankle = 0° + (-80°) = -80°

And Unity's Jacobian angles would be:
- thetaA = 120°
- thetaB = 0° - 120° = -120°
- thetaC = -80° - 0° = -80°

Angle sums:
- thetaA = 120°
- thetaA + thetaB = 0°
- thetaA + thetaB + thetaC = -80°

This gives:
- cos(thetaA) = cos(120°) = -0.5 ✓
- cos(thetaA+thetaB) = cos(0°) = 1.0 ✗ (should be -0.5!)
- cos(thetaA+thetaB+thetaC) = cos(-80°) = 0.1736 ✓

**Problem**: Unity's j22 requires cos(thetaA+thetaB) = -0.5, but if knee=0° and hip=120°, then cos(0°) = 1.0!

## Hypothesis: Unity's Logged Pose Values Mean Something Different

Unity's log might be showing:
1. **Relative angles in a different convention**, OR
2. **Angles after some transformation**, OR
3. **Local rotations relative to parent**, OR
4. **Something else entirely**

## Next Step: Check Unity's Actual Rigidbody2D Rotations

I need to add logging in Unity's SpiderController.cs to show:
```csharp
Debug.Log($"Frame 1 - Hip absolute rotation: {hip.rotation}°");
Debug.Log($"Frame 1 - Knee absolute rotation: {knee.rotation}°");
Debug.Log($"Frame 1 - Ankle absolute rotation: {ankle.rotation}°");
```

This will tell us what Rigidbody2D.rotation actually returns, which is what's used in the Jacobian calculation.

## Alternative Hypothesis: Our Rapier Angles Are Wrong

Maybe our SpiderBuilder is setting up the wrong initial pose? Let me verify:

Rapier LEFT leg:
- hip.rotation() = -2.094395 rad = -120.000° ✓
- knee.rotation() = 0.000000 rad = 0.000° ✓
- ankle.rotation() = 1.396263 rad = 80.000° ✓

If we convert Unity Y-up to Rapier Y-down:
- Unity hip=120° → Rapier hip=-120° ✓
- Unity knee=0° → Rapier knee=0° ✓
- Unity ankle=-80° → Rapier ankle=80° ✓

Our Rapier angles seem correct!

## The Core Mystery

**Why does Unity get cos(thetaA+thetaB) = -0.5 when knee and hip should give thetaA+thetaB = 0°?**

Possible explanations:
1. Unity's logged "knee=-120°" is NOT the relative angle (knee - hip), but something else
2. Unity's knee.rotation is NOT 0°, it's actually 240° or -120°
3. There's a coordinate transformation happening that I don't understand
4. Unity's Jacobian formula is different from what I think
5. The logunity.txt file has incorrect or misleading labels

## Action Required

Ask user for clarification or check Unity's SpiderController.cs logging code to see exactly what values are being logged.
