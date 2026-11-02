//! Parameter substitution for the simple query protocol.
//!
//! The UI runtime sends statements with `$1..$n` placeholders and JSON parameters.  Statements are executed with the
//! simple query protocol (text format results, no parameter type negotiation), so every parameter is turned into a safe SQL
//! literal here.  The tokenizer skips string literals, quoted identifiers, comments and dollar-quoted bodies so a `$1` that
//! is part of a literal is never replaced.

use serde_json::Value;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SubError {
    #[error("parameter ${0} has no value")]
    Missing(usize),
    #[error("parameter ${0} contains a NUL character")]
    Nul(usize),
    #[error("unsupported parameter value at ${0}")]
    Unsupported(usize),
}

/// SQL literal for one JSON value (`n` is only used in error messages).
pub fn literal(v: &Value, n: usize) -> Result<String, SubError> {
    Ok(match v {
        Value::Null => "NULL".to_string(),
        Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        Value::Number(x) => {
            let s = x.to_string();
            if s.starts_with('-') {
                format!("({s})")
            } else {
                s
            }
        }
        Value::String(s) => quote(s, n)?,
        Value::Array(items) => {
            if items.is_empty() {
                "'{}'".to_string()
            } else {
                let mut parts = Vec::with_capacity(items.len());
                for it in items {
                    parts.push(literal(it, n)?);
                }
                format!("ARRAY[{}]", parts.join(","))
            }
        }
        Value::Object(o) => {
            if let Some(Value::String(b64)) = o.get("$b64") {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| SubError::Unsupported(n))?;
                let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                format!("'\\x{hex}'::bytea")
            } else {
                return Err(SubError::Unsupported(n));
            }
        }
    })
}

fn quote(s: &str, n: usize) -> Result<String, SubError> {
    if s.contains('\0') {
        return Err(SubError::Nul(n));
    }
    // standard_conforming_strings is on for every session: only the quote needs doubling
    Ok(format!("'{}'", s.replace('\'', "''")))
}

/// Replace `$n` placeholders with literals.
pub fn substitute(sql: &str, params: &[Value]) -> Result<String, SubError> {
    let b = sql.as_bytes();
    let mut out = String::with_capacity(sql.len() + params.len() * 8);
    let mut i = 0;
    let mut last = 0; // start of the pending verbatim segment
    while i < b.len() {
        match b[i] {
            b'\'' => {
                i += 1;
                while i < b.len() {
                    if b[i] == b'\'' {
                        if i + 1 < b.len() && b[i + 1] == b'\'' {
                            i += 2;
                            continue;
                        }
                        break;
                    }
                    i += 1;
                }
                i += 1;
            }
            b'"' => {
                i += 1;
                while i < b.len() && b[i] != b'"' {
                    i += 1;
                }
                i += 1;
            }
            b'-' if i + 1 < b.len() && b[i + 1] == b'-' => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'*' => {
                let mut depth = 1;
                i += 2;
                while i < b.len() && depth > 0 {
                    if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
                        depth += 1;
                        i += 2;
                    } else if b[i] == b'*' && i + 1 < b.len() && b[i + 1] == b'/' {
                        depth -= 1;
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
            }
            b'$' => {
                // $1 parameter, $tag$ ... $tag$ dollar quoting, or a stray dollar sign
                let mut j = i + 1;
                if j < b.len() && b[j].is_ascii_digit() {
                    while j < b.len() && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    let n: usize = sql[i + 1..j].parse().unwrap_or(0);
                    let v = params.get(n.wrapping_sub(1)).ok_or(SubError::Missing(n))?;
                    out.push_str(&sql[last..i]);
                    out.push_str(&literal(v, n)?);
                    last = j;
                    i = j;
                } else {
                    while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                        j += 1;
                    }
                    if j < b.len() && b[j] == b'$' {
                        let tag = &sql[i..=j];
                        match sql[j + 1..].find(tag) {
                            Some(end) => i = j + 1 + end + tag.len(),
                            None => i = b.len(),
                        }
                    } else {
                        i += 1;
                    }
                }
            }
            _ => i += 1,
        }
    }
    out.push_str(&sql[last..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn replaces_in_order_and_quotes() {
        let s = substitute("select * from t where a = $1 and b = $2 and c = $1", &[json!(5), json!("O'Brien")]).unwrap();
        assert_eq!(s, "select * from t where a = 5 and b = 'O''Brien' and c = 5");
    }

    #[test]
    fn leaves_literals_comments_and_dollar_bodies_alone() {
        let sql = "select '$1', \"$1\" /* $1 */ -- $1\n, $$ $1 $$, $x$ $1 $x$, $1";
        let s = substitute(sql, &[json!(7)]).unwrap();
        assert_eq!(s, "select '$1', \"$1\" /* $1 */ -- $1\n, $$ $1 $$, $x$ $1 $x$, 7");
    }

    #[test]
    fn nulls_bools_negatives_arrays_bytes() {
        let s = substitute("$1,$2,$3,$4,$5,$6", &[json!(null), json!(true), json!(-3), json!([1, 2]), json!([]), json!({"$b64": "AQID"})]).unwrap();
        assert_eq!(s, "NULL,true,(-3),ARRAY[1,2],'{}','\\x010203'::bytea");
    }

    #[test]
    fn rejects_missing_and_nul() {
        assert_eq!(substitute("select $2", &[json!(1)]), Err(SubError::Missing(2)));
        assert_eq!(substitute("select $1", &[json!("a\u{0}b")]), Err(SubError::Nul(1)));
    }

    #[test]
    fn casts_are_untouched() {
        assert_eq!(substitute("select $1::int + 1", &[json!("5")]).unwrap(), "select '5'::int + 1");
    }
}
