use std::{collections::BTreeMap, env, fs, path::PathBuf};

const BUILTIN_ROOT: &str = "packages/node-builtin-modules/dist";

fn main() {
    let manifest_path = PathBuf::from(BUILTIN_ROOT).join("manifest.json");
    println!("cargo:rerun-if-changed={}", manifest_path.display());

    let manifest_source = fs::read_to_string(&manifest_path).unwrap_or_else(|error| {
        panic!(
            "failed to read {}: {error}; run `pnpm --filter @ass/node-builtin-modules build`",
            manifest_path.display()
        )
    });
    let manifest: BTreeMap<String, String> = serde_json::from_str(&manifest_source)
        .expect("Node.js built-in manifest must be valid JSON");

    let mut generated = String::from(
        "fn builtin_source(name: &str) -> Option<&'static str> {\n    Some(match name.trim_end_matches(\".mjs\") {\n",
    );
    for (specifier, relative_path) in manifest {
        let name = specifier
            .strip_prefix("node:")
            .unwrap_or_else(|| panic!("built-in specifier must start with node:: {specifier}"));
        assert!(
            !relative_path.starts_with('/') && !relative_path.split('/').any(|part| part == ".."),
            "built-in output path must stay inside {BUILTIN_ROOT}: {relative_path}"
        );
        println!("cargo:rerun-if-changed={BUILTIN_ROOT}/{relative_path}");
        generated.push_str(&format!(
            "        {name:?} => include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/{BUILTIN_ROOT}/{relative_path}\")),\n"
        ));
    }
    generated.push_str("        _ => return None,\n    })\n}\n");

    let output =
        PathBuf::from(env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR")).join("node_builtins.rs");
    fs::write(output, generated).expect("generated Node.js built-in registry is writable");
}
