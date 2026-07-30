use std::path::Path;

use super::{is_module_source, is_typescript_path, transpile_repl, transpile_typescript};

#[test]
fn recognizes_typescript_extensions() {
    assert!(is_typescript_path(Path::new("example.ts")));
    assert!(is_typescript_path(Path::new("example.tsx")));
    assert!(!is_typescript_path(Path::new("example.js")));
}

#[test]
fn recognizes_module_syntax() {
    assert!(is_module_source("import value from 'pkg'", false));
    assert!(is_module_source("export const value: number = 1", true));
    assert!(is_module_source("await Promise.resolve(1)", false));
    assert!(!is_module_source("import('pkg')", false));
    assert!(!is_module_source("21 * 2", false));
}

#[test]
#[cfg(feature = "typescript")]
fn strips_typescript_types() {
    let output = transpile_typescript(
        "interface Point { x: number }\nconst point: Point = { x: 42 }; point.x",
        Some(Path::new("example.ts")),
    )
    .expect("TypeScript should transpile");

    assert!(!output.contains("interface"));
    assert!(!output.contains(": Point"));
    assert!(output.contains("point.x"));
}

#[test]
#[cfg(feature = "typescript")]
fn reports_invalid_typescript() {
    assert!(transpile_typescript("const value: = 1", None).is_err());
}

#[test]
#[cfg(feature = "typescript")]
fn makes_top_level_repl_bindings_persistent() {
    let output = transpile_repl("const answer: number = 42; answer", true)
        .expect("REPL TypeScript should transpile");
    assert!(output.contains("var answer = 42"));
}

#[test]
#[cfg(not(feature = "typescript"))]
fn rejects_typescript_when_feature_is_disabled() {
    let error = transpile_typescript("const answer: number = 42", None)
        .expect_err("TypeScript should be disabled");
    assert!(error.contains("TypeScript support is disabled"));
}

#[test]
#[cfg(not(feature = "typescript"))]
fn preserves_javascript_repl_bindings_without_oxc() {
    let output = transpile_repl("const answer = 42; answer", false)
        .expect("JavaScript REPL should remain available");
    assert_eq!(output, "var   answer = 42; answer");
}

#[test]
#[cfg(not(feature = "typescript"))]
fn lightweight_module_detection_ignores_nested_and_quoted_keywords() {
    assert!(!is_module_source(
        "async function run() { await work() }",
        false
    ));
    assert!(!is_module_source("const text = 'export default 1'", false));
    assert!(!is_module_source("import('pkg')", false));
    assert!(is_module_source("import.meta.url", false));
    assert!(is_module_source("export const answer = 42", false));
}
