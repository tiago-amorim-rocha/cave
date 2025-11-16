using UnityEngine;

#if UNITY_EDITOR
using UnityEditor;
#endif

/// <summary>
/// Uses torques in two legs to move the body up/down and left/right when pressing
/// the arrow keys (or WASD). Both feet are assumed to be pinned to the
/// ground with hinge joints.
/// 
/// Attach this to the root "spider" object and wire:
/// - body         : main body Rigidbody2D
/// - leftHip      : left upper segment (body -> knee)
/// - leftKnee     : left lower segment (knee -> foot)
/// - rightHip     : right upper segment
/// - rightKnee    : right lower segment
///
/// Legs are modeled as 2-link planar arms:
///   Body --(hip)--> segment1 --(knee)--> segment2 --(foot fixed)
/// Runtime-only; attach SpiderControllerDebug to the same GameObject for gizmos/logs.
/// </summary>
public class SpiderController : MonoBehaviour
{
    #region Editor-only leg data
    [System.Serializable]
    public struct LegSegments
    {
        public string name;
        public Transform segment1;
        public Transform segment2;
        public Transform segment3;
        public Transform foot;

        // Desired editor-time pose, in world-space degrees.
        public float angle1Deg;
        public float angle2Deg;
        public float angle3Deg;
    }

    [Header("Leg segment references")]
    public LegSegments[] legs;

    [Header("Leg layout (editor only)")]
    public float baseSegmentLength = 1.3f;

    [Tooltip("Each subsequent segment length = previous length divided by this ratio.")]
    public float segmentLengthRatio = 1.3f;

    public float baseSegmentMass = 1.0f;

    [Tooltip("Each subsequent segment mass = previous mass divided by this ratio.")]
    public float segmentMassRatio = 1.3f;

    [Tooltip("If true, also reposition segments in a straight chain from body to foot.")]
    public bool autoPositionSegments = true;

    [Tooltip("If true, also reposition the foot to sit at the tip of the third segment.")]
    public bool autoPositionFoot = true;
    #endregion

    [Header("References")]
    public Rigidbody2D body;

    [Header("Leg geometry (approx, same for both legs)")]
    public float segmentLength1 = 1.3f; // hip -> knee
    public float segmentLength2 = 1.0f; // knee -> ankle
    public float segmentLength3 = 0.7f; // ankle -> foot

    [Header("Vertical control")]
    [Tooltip("Desired vertical acceleration per unit of input (Up/Down).")]
    public float verticalAccelGain = 1f;

    [Tooltip("Maximum total vertical force we will ask the feet to provide.")]
    public float maxTotalFootForceY = 20f;

    [Header("Horizontal control")]
    [Tooltip("Desired horizontal acceleration per unit of input (Left/Right).")]
    public float horizontalAccelGain = 1f;

    [Tooltip("Maximum total horizontal force we will ask the feet to provide.")]
    public float maxTotalFootForceX = 20f;

    [Header("Torque scaling")]
    public float torqueGain = 1f;
    public float maxJointTorque = 100f;

    [Header("Joint limit springs")]
    [Tooltip("Enable hip joint-limit-like springs.")]
    public bool enableHipJointLimits = true;

    [Tooltip("Enable knee/ankle joint-limit-like springs.")]
    public bool enableKneeAnkleJointLimits = true;

    [Tooltip("Stiffness for joint limit springs (deg -> torque-like term).")]
    public float jointLimitKp = 10f;

    [Tooltip("Damping for joint limit springs (deg/s -> torque-like term).")]
    public float jointLimitKd = 1f;

    [Header("Hip joint limits (relative to body, deg)")]
    [Tooltip("Signed range of hip angles (min/max, relative to body) where the joint is free.")]
    public float hipLimitFreeMin = 0f;

    [Tooltip("Signed range of hip angles (min/max, relative to body) where the joint is free.")]
    public float hipLimitFreeMax = 60f;

    [Header("Knee joint limits (relative flex, deg)")]
    [Tooltip("Signed range of knee flex angles (min/max) where the joint is free.")]
    public float kneeLimitFreeMin = 10f;

    [Tooltip("Signed range of knee flex angles (min/max) where the joint is free.")]
    public float kneeLimitFreeMax = 160f;

    [Header("Ankle joint limits (relative flex, deg)")]
    [Tooltip("Signed range of ankle flex angles (min/max) where the joint is free.")]
    public float ankleLimitFreeMin = 10f;

    [Tooltip("Signed range of ankle flex angles (min/max) where the joint is free.")]
    public float ankleLimitFreeMax = 160f;

    [Header("Rotation stabilization")]
    [Tooltip("Enable PD-based body rotation compensation using asymmetric leg forces.")]
    public bool stabilizeRotation = true;

    [Tooltip("Target body rotation angle in degrees (0 = upright).")]
    public float targetBodyAngle = 0f;

    [Tooltip("Proportional gain for rotation stabilization (deg -> torque-like term).")]
    public float rotationStiffness = 0.5f;

    [Tooltip("Damping gain for rotation stabilization (deg/s -> torque-like term).")]
    public float rotationDamping = 0.1f;

    // Optional HUD/drawing companion for development-time debugging.
    private SpiderControllerDebug _debug;
    internal const float AngleEpsilon = 0.0001f;
    internal const float LeverEpsilon = 0.0001f;

    #region Editor-only leg layout implementation
    /// <summary>Applies the current editor layout values to every configured leg.</summary>
    public void ApplyLegLayout()
    {
#if UNITY_EDITOR
        if (legs == null || legs.Length == 0)
            return;

        float lengthRatio = segmentLengthRatio > 0f ? segmentLengthRatio : 1.3f;
        float massRatio = segmentMassRatio > 0f ? segmentMassRatio : 1.3f;
        float baseLength = baseSegmentLength > 0f ? baseSegmentLength : 1f;
        float baseMass = baseSegmentMass > 0f ? baseSegmentMass : 1f;

        const string undoLabel = "Apply Leg Layout";
        Undo.RecordObject(this, undoLabel);

        for (int i = 0; i < legs.Length; i++)
        {
            var leg = legs[i];

            if (leg.segment1 == null || leg.segment2 == null || leg.segment3 == null)
                continue;

            float L1 = baseLength;
            float L2 = L1 / lengthRatio;
            float L3 = L2 / lengthRatio;

            float M1 = baseMass;
            float M2 = M1 / massRatio;
            float M3 = M2 / massRatio;

            var rb1 = GetSegmentRigidbody(leg.segment1);
            var rb2 = GetSegmentRigidbody(leg.segment2);
            var rb3 = GetSegmentRigidbody(leg.segment3);

            UpdateSegmentGeometry(leg.segment1, L1, undoLabel);
            UpdateSegmentGeometry(leg.segment2, L2, undoLabel);
            UpdateSegmentGeometry(leg.segment3, L3, undoLabel);

            ApplyMass(rb1, M1, undoLabel);
            ApplyMass(rb2, M2, undoLabel);
            ApplyMass(rb3, M3, undoLabel);

	            // Hip starts at the side of the body:
	            //   first leg = left  (body.x - 0.5 in body local X)
	            //   second leg = right (body.x + 0.5 in body local X)
	            Vector2 hipWorld = leg.segment1.position;
	            if (body != null)
	            {
	                Vector2 bodyPos = body.transform.position;
	                Vector2 bodyRight = body.transform.right; // world-space +X of body
	                float sideOffset = -0.5f;
	                if (legs.Length >= 2 && i == 1)
	                    sideOffset = 0.5f;
	                hipWorld = bodyPos + bodyRight * sideOffset;
	            }

            // Segment directions are controlled per leg by angles in degrees.
            // angle1Deg is absolute (world-space) from +X; angle2Deg/angle3Deg
            // are relative bends from the previous segment.
            Vector2 dir1 = AngleToDir(leg.angle1Deg);
            Vector2 dir2 = RotateDir(dir1, leg.angle2Deg);
            Vector2 dir3 = RotateDir(dir2, leg.angle3Deg);

            // Compute joint positions assuming pivot-at-root (left mid-point) segments.
            Vector2 kneeWorld = hipWorld + dir1 * L1;
            Vector2 ankleWorld = kneeWorld + dir2 * L2;
            Vector2 footWorld = ankleWorld + dir3 * L3;

            if (autoPositionSegments)
            {
                // Each segment's transform pivot is at its proximal joint
                // (left mid-point), so we place the transform directly at
                // the joint position.
                RepositionSegment(leg.segment1, hipWorld, dir1, undoLabel);
                RepositionSegment(leg.segment2, kneeWorld, dir2, undoLabel);
                RepositionSegment(leg.segment3, ankleWorld, dir3, undoLabel);
            }

            if (autoPositionFoot && leg.foot != null)
            {
                Undo.RecordObject(leg.foot, undoLabel);
                leg.foot.position = footWorld;
            }

            // Align hinge anchors so joints sit exactly at the computed positions.
            if (body != null && rb1 != null)
                ConfigureJointAnchors(leg.segment1, rb1, body, hipWorld, undoLabel);

            if (rb1 != null && rb2 != null)
                ConfigureJointAnchors(leg.segment2, rb2, rb1, kneeWorld, undoLabel);

            if (rb2 != null && rb3 != null)
                ConfigureJointAnchors(leg.segment3, rb3, rb2, ankleWorld, undoLabel);

            if (leg.foot != null && rb3 != null)
            {
                var footRb = GetSegmentRigidbody(leg.foot);
                if (footRb != null)
                    ConfigureJointAnchors(leg.foot, footRb, rb3, footWorld, undoLabel);
            }
        }
#endif
    }

#if UNITY_EDITOR
    private static void UpdateSegmentGeometry(Transform segment, float length, string undoLabel)
    {
        if (segment == null)
            return;

        Undo.RecordObject(segment, undoLabel);
        Vector3 scale = segment.localScale;
        scale.x = length;
        segment.localScale = scale;

        // Colliders are no longer managed here; only scale is adjusted.
    }

    private static void ApplyMass(Rigidbody2D rb, float mass, string undoLabel)
    {
        if (rb == null)
            return;

        Undo.RecordObject(rb, undoLabel);
        rb.mass = mass;
    }

    private static void ConfigureJointAnchors(Transform ownerTransform, Rigidbody2D ownerBody,
                                              Rigidbody2D connectedBody, Vector2 jointWorldPos,
                                              string undoLabel)
    {
        if (ownerBody == null || connectedBody == null)
            return;

        void ConfigureOn(Transform t, Rigidbody2D attached, Rigidbody2D expectedConnected)
        {
            if (t == null || attached == null || expectedConnected == null)
                return;

            var hinges = t.GetComponents<HingeJoint2D>();
            if (hinges == null || hinges.Length == 0)
                return;

            foreach (var hinge in hinges)
            {
                if (hinge.connectedBody != expectedConnected)
                    continue;

                Undo.RecordObject(hinge, undoLabel);
                hinge.autoConfigureConnectedAnchor = false;

                // Place the joint at the desired world position on this body
                // and on the connected body.
                Vector2 localAnchor = t.InverseTransformPoint(jointWorldPos);
                hinge.anchor = localAnchor;

                if (expectedConnected != null)
                {
                    Vector2 connectedAnchor = expectedConnected.transform.InverseTransformPoint(jointWorldPos);
                    hinge.connectedAnchor = connectedAnchor;
                }
            }
        }

        // Try hinges on the owner first, then on the connected body (in case
        // the joint component lives on the other object).
        ConfigureOn(ownerTransform, ownerBody, connectedBody);
        ConfigureOn(connectedBody.transform, connectedBody, ownerBody);
    }
#endif

#if UNITY_EDITOR
    private static void RepositionSegment(Transform segment, Vector2 desiredRoot, Vector2 dir, string undoLabel)
    {
        if (segment == null)
            return;

        Undo.RecordObject(segment, undoLabel);

        segment.position = desiredRoot;
        float angle = Mathf.Atan2(dir.y, dir.x) * Mathf.Rad2Deg;
        segment.rotation = Quaternion.AngleAxis(angle, Vector3.forward);
    }
#endif

    private static Vector2 AngleToDir(float angleDeg)
    {
        if (Mathf.Abs(angleDeg) < AngleEpsilon)
            return Vector2.right;

        float rad = angleDeg * Mathf.Deg2Rad;
        return new Vector2(Mathf.Cos(rad), Mathf.Sin(rad));
    }

    private static Vector2 RotateDir(Vector2 dir, float deltaAngleDeg)
    {
        if (Mathf.Abs(deltaAngleDeg) < AngleEpsilon)
            return dir;

        float rad = deltaAngleDeg * Mathf.Deg2Rad;
        float c = Mathf.Cos(rad);
        float s = Mathf.Sin(rad);
        return new Vector2(c * dir.x - s * dir.y, s * dir.x + c * dir.y);
    }

    #endregion

    internal struct ControllerLeg
    {
        public Rigidbody2D Hip;
        public Rigidbody2D Knee;
        public Rigidbody2D Ankle;
        public Rigidbody2D Foot;
        public bool IsLeft;

        public bool IsValid => Hip != null && Knee != null && Ankle != null;
    }


    private static float ComputeJointLimitTorque(float parentDeg, float childDeg,
                                                 float freeMin, float freeMax,
                                                 float kp, float kd,
                                                 float parentAngVel, float childAngVel)
    {
        NormalizeLimitRange(ref freeMin, ref freeMax);

        // Relative angle child - parent (childDeg - parentDeg) in [-180,180].
        float rel = Mathf.DeltaAngle(parentDeg, childDeg);

        // Inside free range: no limit torque.
        if (rel >= freeMin && rel <= freeMax)
            return 0f;

        // Outside free range: pull back to nearest boundary.
        float targetRel = Mathf.Clamp(rel, freeMin, freeMax);

        float errorRel = targetRel - rel;
        float relVel = childAngVel - parentAngVel;

        return kp * errorRel - kd * relVel;
    }

    private static float NormalizeAngle180(float angleDeg)
    {
        // Normalize an angle to [-180, 180] without flipping its sign.
        return Mathf.DeltaAngle(0f, angleDeg);
    }

    private static void NormalizeLimitRange(ref float freeMin, ref float freeMax)
    {
        freeMin = NormalizeAngle180(freeMin);
        freeMax = NormalizeAngle180(freeMax);

        // Ensure freeMin <= freeMax (simple, non-wrapping interval).
        if (freeMin > freeMax)
        {
            float tmp = freeMin;
            freeMin = freeMax;
            freeMax = tmp;
        }
    }

    private static Rigidbody2D GetSegmentRigidbody(Transform segment)
    {
        return segment != null ? segment.GetComponent<Rigidbody2D>() : null;
    }

    void Awake()
    {
        if (body == null)
            body = transform.Find("body")?.GetComponent<Rigidbody2D>();
        if (_debug == null)
            _debug = GetComponent<SpiderControllerDebug>();
    }

    void FixedUpdate()
    {
        if (body == null)
            return;

        // Require both legs to be assigned; controller assumes exactly two legs.
        if (!TryGetControllerLegs(out var leftLeg, out var rightLeg))
            return;

        // Read input using Unity's old Input system ("Vertical" and "Horizontal" axes)
        float verticalInput = Mathf.Clamp(Input.GetAxis("Vertical"), -1f, 1f);
        float horizontalInput = Mathf.Clamp(Input.GetAxis("Horizontal"), -1f, 1f);

        // --- Compute per-leg forces (includes optional rotation compensation) ---
        ComputeLegForces(leftLeg, rightLeg, verticalInput, horizontalInput,
                         out var leftForce, out var rightForce);

        // --- Apply torques for each leg using Jacobian transpose ---
        // We ask for a force on the body; the equal and opposite force the
        // leg must apply at the foot is the negative of this.
        ApplyLegTorques(leftLeg, -leftForce.x, -leftForce.y);
        ApplyLegTorques(rightLeg, -rightForce.x, -rightForce.y);

        // Store forces for gizmo visualization
    }

    internal bool TryGetControllerLegs(out ControllerLeg leftLeg, out ControllerLeg rightLeg)
    {
        leftLeg = default;
        rightLeg = default;

        if (legs == null || legs.Length < 2)
            return false;

        leftLeg = CreateControllerLeg(legs[0]);
        rightLeg = CreateControllerLeg(legs[1]);

        leftLeg.IsLeft = true;
        rightLeg.IsLeft = false;

        return leftLeg.IsValid && rightLeg.IsValid;
    }

    internal void RegisterDebugger(SpiderControllerDebug debugger)
    {
        _debug = debugger;
    }

    private static ControllerLeg CreateControllerLeg(LegSegments leg)
    {
        return new ControllerLeg
        {
            Hip = GetSegmentRigidbody(leg.segment1),
            Knee = GetSegmentRigidbody(leg.segment2),
            Ankle = GetSegmentRigidbody(leg.segment3),
            Foot = GetSegmentRigidbody(leg.foot)
        };
    }

    private void ComputeLegForces(ControllerLeg leftLeg, ControllerLeg rightLeg,
                                  float verticalInput, float horizontalInput,
                                  out Vector2 leftForce, out Vector2 rightForce)
    {
        float desiredFy = verticalInput * verticalAccelGain * body.mass;
        desiredFy = Mathf.Clamp(desiredFy, -maxTotalFootForceY, maxTotalFootForceY);

        float desiredFx = horizontalInput * horizontalAccelGain * body.mass;
        desiredFx = Mathf.Clamp(desiredFx, -maxTotalFootForceX, maxTotalFootForceX);

        Vector2 perLegForce = new Vector2(desiredFx * 0.5f, desiredFy * 0.5f);
        leftForce = perLegForce;
        rightForce = perLegForce;

        if (!stabilizeRotation)
            return;

        float angleError = Mathf.DeltaAngle(body.rotation, targetBodyAngle);
        float angVel = body.angularVelocity;
        float desiredTorque = rotationStiffness * angleError - rotationDamping * angVel;

        if (Mathf.Approximately(desiredTorque, 0f))
            return;

        float lever = leftLeg.Hip.worldCenterOfMass.x - rightLeg.Hip.worldCenterOfMass.x;
        if (Mathf.Abs(lever) < LeverEpsilon)
            return;

        float deltaFy = desiredTorque / lever;
        leftForce.y += deltaFy;
        rightForce.y -= deltaFy;
    }

    void ApplyLegTorques(ControllerLeg leg, float Fx, float Fy)
    {
        if (!leg.IsValid)
            return;

        var hip = leg.Hip;
        var knee = leg.Knee;
        var ankle = leg.Ankle;

        float thetaA = hip.rotation * Mathf.Deg2Rad;
        float thetaB = (knee.rotation - hip.rotation) * Mathf.Deg2Rad;
        float thetaC = (ankle.rotation - knee.rotation) * Mathf.Deg2Rad;

        float l1 = segmentLength1;
        float l2 = segmentLength2;
        float l3 = segmentLength3;

        float sA = Mathf.Sin(thetaA);
        float cA = Mathf.Cos(thetaA);
        float sAB = Mathf.Sin(thetaA + thetaB);
        float cAB = Mathf.Cos(thetaA + thetaB);
        float sABC = Mathf.Sin(thetaA + thetaB + thetaC);
        float cABC = Mathf.Cos(thetaA + thetaB + thetaC);

        float j11 = -l1 * sA - l2 * sAB - l3 * sABC;
        float j12 = -l2 * sAB - l3 * sABC;
        float j13 = -l3 * sABC;

        float j21 = l1 * cA + l2 * cAB + l3 * cABC;
        float j22 = l2 * cAB + l3 * cABC;
        float j23 = l3 * cABC;

        float tauA = j11 * Fx + j21 * Fy;
        float tauB = j12 * Fx + j22 * Fy;
        float tauC = j13 * Fx + j23 * Fy;

        // Compute radial parent orientation for hip regardless of whether limits are enabled
        float hipParentDeg = body.rotation;
        float hipParentAngVel = body.angularVelocity;
        {
            Vector2 bodyPos = body.worldCenterOfMass;
            Vector2 hipPos = hip.worldCenterOfMass;
            Vector2 radial = hipPos - bodyPos;
            if (radial.sqrMagnitude > LeverEpsilon)
            {
                hipParentDeg = Mathf.Atan2(radial.y, radial.x) * Mathf.Rad2Deg;
            }
        }

        GetHipLimitRange(leg.IsLeft, out float hipFreeMin, out float hipFreeMax);

        float hipRelDeg = Mathf.DeltaAngle(hipParentDeg, hip.rotation);
        float hipLimitTau = 0f;
        if (enableHipJointLimits)
        {
            hipLimitTau = ComputeJointLimitTorque(
                hipParentDeg, hip.rotation,
                hipFreeMin, hipFreeMax,
                jointLimitKp, jointLimitKd,
                hipParentAngVel, hip.angularVelocity);

            tauA += hipLimitTau;
        }

        GetKneeLimitRange(leg.IsLeft, out float kneeFreeMin, out float kneeFreeMax);
        GetAnkleLimitRange(leg.IsLeft, out float ankleFreeMin, out float ankleFreeMax);

        float kneeRelDeg = Mathf.DeltaAngle(hip.rotation, knee.rotation);
        float ankleRelDeg = Mathf.DeltaAngle(knee.rotation, ankle.rotation);

        float kneeLimitTau = 0f;
        float ankleLimitTau = 0f;
        if (enableKneeAnkleJointLimits)
        {
            kneeLimitTau = ComputeJointLimitTorque(
                hip.rotation, knee.rotation,
                kneeFreeMin, kneeFreeMax,
                jointLimitKp, jointLimitKd,
                hip.angularVelocity, knee.angularVelocity);

            ankleLimitTau = ComputeJointLimitTorque(
                knee.rotation, ankle.rotation,
                ankleFreeMin, ankleFreeMax,
                jointLimitKp, jointLimitKd,
                knee.angularVelocity, ankle.angularVelocity);

            tauB += kneeLimitTau;
            tauC += ankleLimitTau;
        }

        _debug?.UpdateJointDebug(
            leg.IsLeft,
            hipRelDeg, hipFreeMin, hipFreeMax, hipLimitTau,
            kneeRelDeg, kneeFreeMin, kneeFreeMax, kneeLimitTau,
            ankleRelDeg, ankleFreeMin, ankleFreeMax, ankleLimitTau);

        tauA = Mathf.Clamp(tauA * torqueGain, -maxJointTorque, maxJointTorque);
        tauB = Mathf.Clamp(tauB * torqueGain, -maxJointTorque, maxJointTorque);
        tauC = Mathf.Clamp(tauC * torqueGain, -maxJointTorque, maxJointTorque);

        hip.AddTorque(tauA, ForceMode2D.Force);
        knee.AddTorque(tauB, ForceMode2D.Force);
        ankle.AddTorque(tauC, ForceMode2D.Force);
    }

    internal void GetHipLimitRange(bool isLeft, out float freeMin, out float freeMax)
    {
        float min = hipLimitFreeMin;
        float max = hipLimitFreeMax;
        ApplyMirrorIfNeeded(isLeft, ref min, ref max);
        freeMin = min;
        freeMax = max;
    }

    internal void GetKneeLimitRange(bool isLeft, out float freeMin, out float freeMax)
    {
        float min = kneeLimitFreeMin;
        float max = kneeLimitFreeMax;
        ApplyMirrorIfNeeded(isLeft, ref min, ref max);
        freeMin = min;
        freeMax = max;
    }

    internal void GetAnkleLimitRange(bool isLeft, out float freeMin, out float freeMax)
    {
        float min = ankleLimitFreeMin;
        float max = ankleLimitFreeMax;
        ApplyMirrorIfNeeded(isLeft, ref min, ref max);
        freeMin = min;
        freeMax = max;
    }

    /// <summary>
    /// Mirrors a signed joint limit range so left/right legs share the same inspector values.
    /// </summary>
    private static void ApplyMirrorIfNeeded(bool isLeft, ref float min, ref float max)
    {
        if (!isLeft)
        {
            float mirroredMin = -max;
            float mirroredMax = -min;
            min = mirroredMin;
            max = mirroredMax;
        }

        NormalizeLimitRange(ref min, ref max);
    }
}
