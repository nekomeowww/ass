use super::{EvaluationMode, evaluation_script};

#[test]
fn safely_embeds_source_as_json() {
    let script = evaluation_script(
        7,
        "'</script>\\n${boom}'",
        EvaluationMode::Script,
        false,
        true,
        None,
    );
    assert!(script.contains("id: 7"));
    assert!(script.contains("\\n"));
    assert!(!script.contains("eval)('</script>"));
}

#[test]
fn creates_a_blob_for_es_modules() {
    let script = evaluation_script(
        8,
        "export default await Promise.resolve(42)",
        EvaluationMode::Module,
        false,
        true,
        None,
    );
    assert!(script.contains("URL.createObjectURL"));
    assert!(script.contains("import(url)"));
}

#[test]
fn creates_an_isolated_realm_evaluation() {
    let script = evaluation_script(
        9,
        "globalThis.value = 42",
        EvaluationMode::Script,
        true,
        true,
        None,
    );
    assert!(script.contains("evaluateIsolated"));
    assert!(script.contains("outcome.success"));
    assert!(script.contains("waitForNativeIdle(9, true)"));
}

#[test]
fn keeps_the_main_javascript_realm_stable_across_evaluations() {
    let first = evaluation_script(20, "1", EvaluationMode::Script, false, false, None);
    let second = evaluation_script(21, "2", EvaluationMode::Script, false, false, None);
    assert!(first.contains("waitForNativeIdle(0, false)"));
    assert!(second.contains("waitForNativeIdle(0, false)"));
    assert!(!first.contains("setRealm"));
    assert!(!second.contains("setRealm"));
}

#[test]
fn imports_a_file_module_from_its_mounted_url() {
    let script = evaluation_script(
        10,
        "ignored",
        EvaluationMode::Module,
        true,
        true,
        Some("ass://module/10/src/main.mjs"),
    );
    assert!(script.contains("ass://module/10/src/main.mjs"));
    assert!(!script.contains("URL.createObjectURL"));
}

#[test]
fn rewrites_node_builtins_in_inline_modules() {
    let script = evaluation_script(
        11,
        "import { randomUUID } from 'node:crypto'; randomUUID()",
        EvaluationMode::Module,
        false,
        true,
        None,
    );
    assert!(script.contains("ass://module/11/__ass_builtin__/crypto"));
    assert!(!script.contains("node:crypto"));
}

#[test]
fn rewrites_dynamic_node_builtins_in_script_mode() {
    let script = evaluation_script(
        12,
        "import(`node:fs`).then(module => module.readFile)",
        EvaluationMode::Script,
        false,
        true,
        None,
    );
    assert!(script.contains("ass://module/12/__ass_builtin__/fs"));
    assert!(!script.contains("node:fs"));
}

#[test]
fn does_not_rewrite_node_text_inside_a_string() {
    let script = evaluation_script(
        13,
        r#"console.log("from 'node:path'")"#,
        EvaluationMode::Module,
        false,
        true,
        None,
    );
    assert!(script.contains("from 'node:path'"));
}
