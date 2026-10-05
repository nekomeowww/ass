use rustyline::{
    Helper,
    completion::Completer,
    highlight::Highlighter,
    hint::Hinter,
    validate::{ValidationContext, ValidationResult, Validator},
};

pub(crate) struct ReplHelper;

impl Completer for ReplHelper {
    type Candidate = String;
}

impl Hinter for ReplHelper {
    type Hint = String;
}

impl Highlighter for ReplHelper {}

impl Helper for ReplHelper {}

impl Validator for ReplHelper {
    fn validate(&self, context: &mut ValidationContext<'_>) -> rustyline::Result<ValidationResult> {
        Ok(if input_is_incomplete(context.input()) {
            ValidationResult::Incomplete
        } else {
            ValidationResult::Valid(None)
        })
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum LexicalState {
    BlockComment,
    Code,
    DoubleQuoted,
    LineComment,
    SingleQuoted,
    Template,
}

#[derive(Clone, Copy)]
struct Delimiter {
    closing: u8,
    resumes_template: bool,
}

pub(crate) fn input_is_incomplete(input: &str) -> bool {
    let bytes = input.as_bytes();
    let mut delimiters = Vec::new();
    let mut index = 0;
    let mut state = LexicalState::Code;

    while index < bytes.len() {
        let byte = bytes[index];
        match state {
            LexicalState::Code => match byte {
                b'\'' => state = LexicalState::SingleQuoted,
                b'"' => state = LexicalState::DoubleQuoted,
                b'`' => state = LexicalState::Template,
                b'/' if bytes.get(index + 1) == Some(&b'/') => {
                    state = LexicalState::LineComment;
                    index += 1;
                }
                b'/' if bytes.get(index + 1) == Some(&b'*') => {
                    state = LexicalState::BlockComment;
                    index += 1;
                }
                b'(' => delimiters.push(Delimiter {
                    closing: b')',
                    resumes_template: false,
                }),
                b'[' => delimiters.push(Delimiter {
                    closing: b']',
                    resumes_template: false,
                }),
                b'{' => delimiters.push(Delimiter {
                    closing: b'}',
                    resumes_template: false,
                }),
                b')' | b']' | b'}' => {
                    let Some(delimiter) = delimiters.last().copied() else {
                        return false;
                    };
                    if delimiter.closing != byte {
                        return false;
                    }
                    delimiters.pop();
                    if delimiter.resumes_template {
                        state = LexicalState::Template;
                    }
                }
                _ => {}
            },
            LexicalState::SingleQuoted | LexicalState::DoubleQuoted => {
                let quote = if state == LexicalState::SingleQuoted {
                    b'\''
                } else {
                    b'"'
                };
                if byte == b'\\' {
                    index += 1;
                } else if byte == quote {
                    state = LexicalState::Code;
                } else if matches!(byte, b'\n' | b'\r') {
                    return false;
                }
            }
            LexicalState::Template => {
                if byte == b'\\' {
                    index += 1;
                } else if byte == b'`' {
                    state = LexicalState::Code;
                } else if byte == b'$' && bytes.get(index + 1) == Some(&b'{') {
                    delimiters.push(Delimiter {
                        closing: b'}',
                        resumes_template: true,
                    });
                    state = LexicalState::Code;
                    index += 1;
                }
            }
            LexicalState::LineComment => {
                if matches!(byte, b'\n' | b'\r') {
                    state = LexicalState::Code;
                }
            }
            LexicalState::BlockComment => {
                if byte == b'*' && bytes.get(index + 1) == Some(&b'/') {
                    state = LexicalState::Code;
                    index += 1;
                }
            }
        }
        index += 1;
    }

    !delimiters.is_empty()
        || matches!(state, LexicalState::BlockComment | LexicalState::Template)
        || ends_with_continuation_token(input)
}

fn ends_with_continuation_token(input: &str) -> bool {
    let trimmed = input.trim_end();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed
        .split(|character: char| {
            !character.is_ascii_alphanumeric() && character != '_' && character != '$'
        })
        .next_back()
        .is_some_and(|word| matches!(word, "from" | "import" | "as"))
    {
        return true;
    }
    let bytes = trimmed.as_bytes();
    let last = bytes[bytes.len() - 1];
    if matches!(
        last,
        b'.' | b'=' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'?' | b':' | b','
    ) {
        return !matches!(
            bytes.get(bytes.len().saturating_sub(2)..),
            Some(b"++" | b"--")
        );
    }
    false
}

#[cfg(test)]
mod tests {
    use super::input_is_incomplete;

    #[test]
    fn continues_unclosed_javascript_constructs() {
        assert!(input_is_incomplete("function answer() {"));
        assert!(input_is_incomplete("const value = [1,"));
        assert!(input_is_incomplete("const value = `hello ${name"));
        assert!(input_is_incomplete("/* comment"));
        assert!(input_is_incomplete("import { env } from"));
    }

    #[test]
    fn submits_complete_or_invalid_input_to_the_runtime() {
        assert!(!input_is_incomplete("const value = { answer: 42 }"));
        assert!(!input_is_incomplete("'unterminated"));
        assert!(!input_is_incomplete("value++"));
        assert!(!input_is_incomplete("import { env } from 'node:process'"));
    }
}
