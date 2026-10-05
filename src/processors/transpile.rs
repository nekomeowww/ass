use std::path::Path;

#[cfg(feature = "typescript")]
use std::path::PathBuf;

#[cfg(feature = "typescript")]
use oxc_allocator::Allocator;
#[cfg(feature = "typescript")]
use oxc_ast::ast::{
    BindingPattern, Declaration, ExportDefaultDeclarationKind, ImportDeclarationSpecifier,
    ImportOrExportKind, Statement, VariableDeclarationKind,
};
#[cfg(feature = "typescript")]
use oxc_codegen::Codegen;
#[cfg(feature = "typescript")]
use oxc_diagnostics::Diagnostics;
#[cfg(feature = "typescript")]
use oxc_parser::Parser;
#[cfg(feature = "typescript")]
use oxc_semantic::SemanticBuilder;
#[cfg(feature = "typescript")]
use oxc_span::SourceType;
#[cfg(feature = "typescript")]
use oxc_transformer::{TransformOptions, Transformer};

#[cfg(not(feature = "typescript"))]
const TYPESCRIPT_DISABLED: &str =
    "TypeScript support is disabled; rebuild ass with the default `typescript` feature";

pub fn is_typescript_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "mts" | "cts")
    )
}

#[cfg(feature = "typescript")]
pub fn is_module_source(source: &str, typescript: bool) -> bool {
    let allocator = Allocator::default();
    let source_type = SourceType::unambiguous().with_typescript(typescript);
    Parser::new(&allocator, source, source_type)
        .parse()
        .program
        .source_type
        .is_module()
}

#[cfg(not(feature = "typescript"))]
pub fn is_module_source(source: &str, _typescript: bool) -> bool {
    identifiers(source).into_iter().any(|token| {
        if token.depth != 0 {
            return false;
        }
        match token.word {
            "export" | "await" => true,
            "import" => !matches!(next_non_trivia(source, token.end), Some(b'(')),
            _ => false,
        }
    })
}

#[cfg(feature = "typescript")]
pub fn transpile_typescript(source: &str, source_path: Option<&Path>) -> Result<String, String> {
    let path = source_path
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("<ass-repl>.ts"));
    let source_type = SourceType::from_path(&path)
        .unwrap_or_default()
        .with_typescript(true);
    compile(source, &path, source_type, false)
}

#[cfg(not(feature = "typescript"))]
pub fn transpile_typescript(_source: &str, _source_path: Option<&Path>) -> Result<String, String> {
    Err(TYPESCRIPT_DISABLED.to_owned())
}

#[cfg(feature = "typescript")]
pub fn transpile_repl(source: &str, typescript: bool) -> Result<String, String> {
    let path = PathBuf::from(if typescript {
        "<ass-repl>.ts"
    } else {
        "<ass-repl>.js"
    });
    let source_type = SourceType::from_path(&path)
        .unwrap_or_default()
        .with_typescript(typescript);
    compile(source, &path, source_type, true)
}

#[cfg(not(feature = "typescript"))]
pub fn transpile_repl(source: &str, typescript: bool) -> Result<String, String> {
    if typescript {
        Err(TYPESCRIPT_DISABLED.to_owned())
    } else {
        Ok(rewrite_top_level_bindings(source))
    }
}

#[cfg(feature = "typescript")]
fn compile(
    source: &str,
    path: &Path,
    source_type: SourceType,
    persistent_repl_bindings: bool,
) -> Result<String, String> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.diagnostics.has_errors() {
        return Err(render_errors(&parsed.diagnostics));
    }

    let mut program = parsed.program;
    let repl_module = persistent_repl_bindings && program.source_type.is_module();
    let semantic = SemanticBuilder::new()
        .with_excess_capacity(2.0)
        .with_enum_eval(true)
        .build(&program);
    if semantic.diagnostics.has_errors() {
        return Err(render_errors(&semantic.diagnostics));
    }

    let transformed = Transformer::new(&allocator, path, &TransformOptions::default())
        .build_with_scoping(semantic.semantic.into_scoping(), &mut program);
    if transformed.diagnostics.has_errors() {
        return Err(render_errors(&transformed.diagnostics));
    }

    if persistent_repl_bindings {
        for statement in &mut program.body {
            if let Statement::VariableDeclaration(declaration) = statement
                && matches!(
                    declaration.kind,
                    VariableDeclarationKind::Let | VariableDeclarationKind::Const
                )
            {
                declaration.kind = VariableDeclarationKind::Var;
            }
        }
    }

    let mut output = Codegen::new().build(&program).code;
    if repl_module {
        let bindings = top_level_bindings(&program);
        if !bindings.is_empty() {
            output.push_str("\nObject.assign(globalThis, { ");
            output.push_str(&bindings.join(", "));
            output.push_str(" });\n");
        }
    }
    Ok(output)
}

#[cfg(feature = "typescript")]
fn top_level_bindings<'a>(program: &'a oxc_ast::ast::Program<'a>) -> Vec<&'a str> {
    let mut bindings = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(declaration) => {
                if declaration.import_kind == ImportOrExportKind::Type {
                    continue;
                }
                for specifier in declaration.specifiers.iter().flatten() {
                    match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(specifier)
                            if specifier.import_kind == ImportOrExportKind::Value =>
                        {
                            push_unique(&mut bindings, specifier.local.name.as_str());
                        }
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                            push_unique(&mut bindings, specifier.local.name.as_str());
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                            push_unique(&mut bindings, specifier.local.name.as_str());
                        }
                        ImportDeclarationSpecifier::ImportSpecifier(_) => {}
                    }
                }
            }
            Statement::VariableDeclaration(declaration) => {
                for declarator in &declaration.declarations {
                    collect_pattern_bindings(&declarator.id, &mut bindings);
                }
            }
            Statement::FunctionDeclaration(function) => {
                if let Some(identifier) = &function.id {
                    push_unique(&mut bindings, identifier.name.as_str());
                }
            }
            Statement::ClassDeclaration(class) => {
                if let Some(identifier) = &class.id {
                    push_unique(&mut bindings, identifier.name.as_str());
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(declaration) = &export.declaration {
                    collect_declaration_bindings(declaration, &mut bindings);
                }
            }
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    if let Some(identifier) = &function.id {
                        push_unique(&mut bindings, identifier.name.as_str());
                    }
                }
                ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                    if let Some(identifier) = &class.id {
                        push_unique(&mut bindings, identifier.name.as_str());
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    bindings
}

#[cfg(feature = "typescript")]
fn collect_declaration_bindings<'a>(declaration: &'a Declaration<'a>, bindings: &mut Vec<&'a str>) {
    match declaration {
        Declaration::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                collect_pattern_bindings(&declarator.id, bindings);
            }
        }
        Declaration::FunctionDeclaration(function) => {
            if let Some(identifier) = &function.id {
                push_unique(bindings, identifier.name.as_str());
            }
        }
        Declaration::ClassDeclaration(class) => {
            if let Some(identifier) = &class.id {
                push_unique(bindings, identifier.name.as_str());
            }
        }
        _ => {}
    }
}

#[cfg(feature = "typescript")]
fn collect_pattern_bindings<'a>(pattern: &'a BindingPattern<'a>, bindings: &mut Vec<&'a str>) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            push_unique(bindings, identifier.name.as_str());
        }
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                collect_pattern_bindings(&property.value, bindings);
            }
            if let Some(rest) = &pattern.rest {
                collect_pattern_bindings(&rest.argument, bindings);
            }
        }
        BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                collect_pattern_bindings(element, bindings);
            }
            if let Some(rest) = &pattern.rest {
                collect_pattern_bindings(&rest.argument, bindings);
            }
        }
        BindingPattern::AssignmentPattern(pattern) => {
            collect_pattern_bindings(&pattern.left, bindings);
        }
    }
}

#[cfg(feature = "typescript")]
fn push_unique<'a>(bindings: &mut Vec<&'a str>, binding: &'a str) {
    if !bindings.contains(&binding) {
        bindings.push(binding);
    }
}

#[cfg(feature = "typescript")]
fn render_errors(diagnostics: &Diagnostics) -> String {
    diagnostics
        .errors()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(not(feature = "typescript"))]
#[derive(Clone, Copy)]
struct Identifier<'a> {
    word: &'a str,
    end: usize,
    depth: usize,
    start: usize,
}

#[cfg(not(feature = "typescript"))]
fn identifiers(source: &str) -> Vec<Identifier<'_>> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    let mut depth = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'\'' | b'"' | b'`' => {
                let quote = bytes[index];
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == b'\\' {
                        index = (index + 2).min(bytes.len());
                    } else if bytes[index] == quote {
                        index += 1;
                        break;
                    } else {
                        index += 1;
                    }
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                index += 2;
                while index < bytes.len() && !matches!(bytes[index], b'\n' | b'\r') {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index += 2;
                while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/')
                {
                    index += 1;
                }
                index = (index + 2).min(bytes.len());
            }
            b'{' => {
                depth += 1;
                index += 1;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                index += 1;
            }
            byte if is_identifier_start(byte) => {
                let start = index;
                index += 1;
                while index < bytes.len() && is_identifier_continue(bytes[index]) {
                    index += 1;
                }
                tokens.push(Identifier {
                    word: &source[start..index],
                    end: index,
                    depth,
                    start,
                });
            }
            _ => index += 1,
        }
    }
    tokens
}

#[cfg(not(feature = "typescript"))]
fn next_non_trivia(source: &str, mut index: usize) -> Option<u8> {
    let bytes = source.as_bytes();
    loop {
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if bytes.get(index..index + 2) == Some(b"//") {
            index += 2;
            while index < bytes.len() && !matches!(bytes[index], b'\n' | b'\r') {
                index += 1;
            }
        } else if bytes.get(index..index + 2) == Some(b"/*") {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            index = (index + 2).min(bytes.len());
        } else {
            return bytes.get(index).copied();
        }
    }
}

#[cfg(not(feature = "typescript"))]
fn rewrite_top_level_bindings(source: &str) -> String {
    let replacements = identifiers(source)
        .into_iter()
        .filter(|token| token.depth == 0 && matches!(token.word, "let" | "const"))
        .collect::<Vec<_>>();
    if replacements.is_empty() {
        return source.to_owned();
    }

    let mut output = source.to_owned();
    for token in replacements.into_iter().rev() {
        let replacement = if token.word == "const" {
            "var  "
        } else {
            "var"
        };
        output.replace_range(token.start..token.end, replacement);
    }
    output
}

#[cfg(not(feature = "typescript"))]
const fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$')
}

#[cfg(not(feature = "typescript"))]
const fn is_identifier_continue(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}

#[cfg(test)]
#[path = "transpile_test.rs"]
mod tests;
