use super::{EvaluationMode, evaluation_script};

#[test]
fn safely_embeds_source_as_json() {
    let script = evaluation_script(
        7,
        "'</script>\\n${boom}'",
        EvaluationMode::Script,
        false,
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
        None,
    );
    assert!(script.contains("evaluateIsolated"));
    assert!(script.contains("outcome.success"));
}

#[test]
fn imports_a_file_module_from_its_mounted_url() {
    let script = evaluation_script(
        10,
        "ignored",
        EvaluationMode::Module,
        true,
        Some("ass://module/10/src/main.mjs"),
    );
    assert!(script.contains("ass://module/10/src/main.mjs"));
    assert!(!script.contains("URL.createObjectURL"));
}
