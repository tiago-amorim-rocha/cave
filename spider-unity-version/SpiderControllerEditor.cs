using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

[CustomEditor(typeof(SpiderController))]
public class SpiderControllerEditor : Editor
{
    public override void OnInspectorGUI()
    {
        serializedObject.Update();
        DrawDefaultInspector();
        serializedObject.ApplyModifiedProperties();

        EditorGUILayout.Space();
        EditorGUILayout.HelpBox(
            "Segments are assumed to stretch along local +X, with each Transform pivot at the proximal joint (left mid-point). " +
            "Assign each leg's segment transforms once in the Legs array before running the layout.",
            MessageType.Info);

        EditorGUILayout.Space();
        if (GUILayout.Button("Apply Leg Layout", GUILayout.Height(40f)))
        {
            foreach (Object t in targets)
            {
                var controller = t as SpiderController;
                if (controller == null)
                    continue;

                controller.ApplyLegLayout();
                EditorUtility.SetDirty(controller);
            }

            if (!Application.isPlaying)
            {
                EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            }
        }
    }
}

[CustomPropertyDrawer(typeof(SpiderController.LegSegments))]
public class LegSegmentsPropertyDrawer : PropertyDrawer
{
    private static readonly string[] _childPropertyNames =
    {
        "name",
        "segment1",
        "segment2",
        "segment3",
        "foot",
        "angle1Deg",
        "angle2Deg",
        "angle3Deg"
    };

    public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
    {
        EditorGUI.BeginProperty(position, label, property);

        SerializedProperty nameProp = property.FindPropertyRelative("name");
        string displayName = string.IsNullOrEmpty(nameProp.stringValue)
            ? label.text
            : nameProp.stringValue;

        GUIStyle foldoutStyle = new GUIStyle(EditorStyles.foldout)
        {
            fontStyle = FontStyle.Bold
        };

        Rect foldoutRect = new Rect(position.x, position.y, position.width, EditorGUIUtility.singleLineHeight);
        property.isExpanded = EditorGUI.Foldout(foldoutRect, property.isExpanded, displayName, true, foldoutStyle);

        if (property.isExpanded)
        {
            EditorGUI.indentLevel++;
            float y = position.y + EditorGUIUtility.singleLineHeight + EditorGUIUtility.standardVerticalSpacing;

            foreach (string childName in _childPropertyNames)
            {
                SerializedProperty child = property.FindPropertyRelative(childName);
                if (child == null)
                    continue;

                float height = EditorGUI.GetPropertyHeight(child, true);
                Rect fieldRect = new Rect(position.x, y, position.width, height);
                EditorGUI.PropertyField(EditorGUI.IndentedRect(fieldRect), child, true);
                y += height + EditorGUIUtility.standardVerticalSpacing;
            }

            EditorGUI.indentLevel--;
        }

        EditorGUI.EndProperty();
    }

    public override float GetPropertyHeight(SerializedProperty property, GUIContent label)
    {
        float height = EditorGUIUtility.singleLineHeight;
        if (property.isExpanded)
        {
            float spacing = EditorGUIUtility.standardVerticalSpacing;
            height += spacing;

            foreach (string childName in _childPropertyNames)
            {
                SerializedProperty child = property.FindPropertyRelative(childName);
                if (child == null)
                    continue;

                height += EditorGUI.GetPropertyHeight(child, true) + spacing;
            }

            height -= spacing;
        }

        return height;
    }
}
