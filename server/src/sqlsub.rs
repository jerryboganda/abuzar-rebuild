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
            if let Some(Value::String(dec)) = o.get("$dec") {
                // a PowerScript decimal outside arithmetic: the quoted text, as before (it takes the type of what it meets)
                decimal(dec, n)?;
                quote(dec, n)?
            } else if let Some(Value::String(b64)) = o.get("$b64") {
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

/// The text of a PowerScript decimal (`{"$dec": "-12.50"}`), checked to be a plain number.
fn decimal(s: &str, n: usize) -> Result<&str, SubError> {
    let digits = s.strip_prefix('-').unwrap_or(s);
    let (whole, fraction) = digits.split_once('.').unwrap_or((digits, "0"));
    let plain = |part: &str| !part.is_empty() && part.bytes().all(|c| c.is_ascii_digit());
    if plain(whole) && plain(fraction) { Ok(s) } else { Err(SubError::Unsupported(n)) }
}

/// SQL for one parameter that is an operand of `* / + - %`.  T-SQL converts a decimal string or a NULL there implicitly; in
/// PostgreSQL a quoted decimal would be read as the other operand's type (`'12.50' * 3` fails as an integer) and two NULLs
/// have no operator at all, so a decimal becomes a numeric literal and a NULL a numeric NULL.  Every other value is unchanged.
fn arithmetic_literal(v: &Value, n: usize) -> Result<String, SubError> {
    match v {
        Value::Null => Ok("NULL::numeric".to_string()),
        Value::Object(o) => match o.get("$dec") {
            Some(Value::String(dec)) => {
                let text = decimal(dec, n)?;
                Ok(if text.starts_with('-') { format!("({text})") } else { text.to_string() })
            }
            _ => literal(v, n),
        },
        _ => literal(v, n),
    }
}

/// true when the placeholder at `b[i..j]` is an operand of an arithmetic operator (not a comment opener or closer)
fn arithmetic_context(b: &[u8], i: usize, j: usize) -> bool {
    let mut p = i;
    while p > 0 && b[p - 1].is_ascii_whitespace() {
        p -= 1;
    }
    let before = p > 0 && matches!(b[p - 1], b'*' | b'/' | b'+' | b'-' | b'%') && !(b[p - 1] == b'/' && p > 1 && b[p - 2] == b'*')
        && !(b[p - 1] == b'-' && p > 1 && b[p - 2] == b'-');
    let mut k = j;
    while k < b.len() && b[k].is_ascii_whitespace() {
        k += 1;
    }
    let after = k < b.len() && matches!(b[k], b'*' | b'/' | b'+' | b'-' | b'%')
        && !(k + 1 < b.len() && ((b[k] == b'-' && b[k + 1] == b'-') || (b[k] == b'/' && b[k + 1] == b'*')));
    before || after
}

fn quote(s: &str, n: usize) -> Result<String, SubError> {
    if s.contains('\0') {
        return Err(SubError::Nul(n));
    }
    // standard_conforming_strings is on for every session: only the quote needs doubling
    Ok(format!("'{}'", s.replace('\'', "''")))
}

/// true when the placeholder at `b[i..j]` is the only member of an `IN ( ... )` list
fn in_list_context(b: &[u8], i: usize, j: usize) -> bool {
    let mut k = j;
    while k < b.len() && b[k].is_ascii_whitespace() {
        k += 1;
    }
    if k >= b.len() || b[k] != b')' {
        return false;
    }
    let mut p = i;
    while p > 0 && b[p - 1].is_ascii_whitespace() {
        p -= 1;
    }
    if p == 0 || b[p - 1] != b'(' {
        return false;
    }
    p -= 1;
    while p > 0 && b[p - 1].is_ascii_whitespace() {
        p -= 1;
    }
    p >= 2 && b[p - 2..p].eq_ignore_ascii_case(b"in") && (p == 2 || !(b[p - 3].is_ascii_alphanumeric() || b[p - 3] == b'_'))
}

/// true when the placeholder at `b[i..j]` is a whole `ORDER BY` item on its own (`ORDER BY $2`, `ORDER BY $2 DESC`)
fn order_by_context(b: &[u8], i: usize, j: usize) -> bool {
    let mut p = i;
    while p > 0 && b[p - 1].is_ascii_whitespace() {
        p -= 1;
    }
    if p < 2 || !b[p - 2..p].eq_ignore_ascii_case(b"by") || (p > 2 && (b[p - 3].is_ascii_alphanumeric() || b[p - 3] == b'_')) {
        return false;
    }
    p -= 2;
    let end = p;
    while p > 0 && b[p - 1].is_ascii_whitespace() {
        p -= 1;
    }
    if p == end || p < 5 || !b[p - 5..p].eq_ignore_ascii_case(b"order") || (p > 5 && (b[p - 6].is_ascii_alphanumeric() || b[p - 6] == b'_')) {
        return false;
    }
    let mut k = j;
    while k < b.len() && b[k].is_ascii_whitespace() {
        k += 1;
    }
    k == b.len() || matches!(b[k], b',' | b')' | b';') || b[k].is_ascii_alphabetic()
}

/// The `ORDER BY` item for a string argument.  PowerBuilder substitutes it as a string literal and SQL Server sorts by the
/// select-list column of that name (`ORDER BY 'salerowid'`, any case; anything else is error 408), which PostgreSQL reads
/// as a constant.  A plain name becomes that output column (lower case, as the translated aliases are); other text stays a
/// literal and is refused there as well.
fn order_by_item(v: &Value, n: usize) -> Result<String, SubError> {
    match v {
        Value::String(s) if !s.is_empty() && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
            && !s.as_bytes()[0].is_ascii_digit() => Ok(format!("\"{}\"", s.to_ascii_lowercase())),
        _ => literal(v, n),
    }
}

/// true when the placeholder at `b[i..j]` is compared as a scalar (`col = $1`, `col <> $1`) or cast as one (`($1)::numeric`):
/// PowerBuilder substitutes a one-member list argument there as that member.
fn scalar_context(b: &[u8], i: usize, j: usize) -> bool {
    let mut p = i;
    while p > 0 && b[p - 1].is_ascii_whitespace() {
        p -= 1;
    }
    if p > 0 && matches!(b[p - 1], b'=' | b'<' | b'>') {
        return true;
    }
    let mut k = j;
    while k < b.len() && b[k].is_ascii_whitespace() {
        k += 1;
    }
    p > 0 && b[p - 1] == b'(' && k + 2 < b.len() && b[k] == b')' && b[k + 1] == b':' && b[k + 2] == b':'
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
                    match v {
                        // `col IN (:list)`: a list argument (numberlist / stringlist) becomes the members of the list
                        Value::Array(items) if in_list_context(b, i, j) => {
                            if items.is_empty() {
                                out.push_str("NULL");
                            } else {
                                let mut parts = Vec::with_capacity(items.len());
                                for it in items {
                                    parts.push(literal(it, n)?);
                                }
                                out.push_str(&parts.join(","));
                            }
                        }
                        // `col = :list` with one member: the member itself, as PowerBuilder substitutes it
                        Value::Array(items) if items.len() == 1 && scalar_context(b, i, j) => out.push_str(&literal(&items[0], n)?),
                        _ if arithmetic_context(b, i, j) => out.push_str(&arithmetic_literal(v, n)?),
                        Value::String(_) if order_by_context(b, i, j) => out.push_str(&order_by_item(v, n)?),
                        _ => out.push_str(&literal(v, n)?),
                    }
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
    fn list_arguments_expand_inside_in() {
        let s = substitute("select * from t where a in ($1) and b in ( $2 ) and c = any($3) and d not in ($4)", &[json!([1, 2]), json!(["x"]), json!([3]), json!([])]).unwrap();
        assert_eq!(s, "select * from t where a in (1,2) and b in ( 'x' ) and c = any(ARRAY[3]) and d not in (NULL)");
        // a scalar in the same position is unchanged; so is a word that merely ends in "in"
        assert_eq!(substitute("where a in ($1) and begin($2)", &[json!(5), json!([1])]).unwrap(), "where a in (5) and begin(ARRAY[1])");
    }

    #[test]
    fn one_member_lists_compared_or_cast_as_scalars() {
        let s = substitute("where a = $1 and b <> $1 and c = ($1)::numeric and d = any($1) and e in ($1)", &[json!([7])]).unwrap();
        assert_eq!(s, "where a = 7 and b <> 7 and c = (7)::numeric and d = any(ARRAY[7]) and e in (7)");
        // more than one member keeps the array: PowerBuilder would not accept it there either
        assert_eq!(substitute("where a = $1", &[json!([1, 2])]).unwrap(), "where a = ARRAY[1,2]");
    }

    #[test]
    fn decimals_and_nulls_in_arithmetic_are_numeric() {
        // `update item set saleprice = round(:ld_price * :ll_packunits, 2)`: a decimal operand is a numeric literal, a NULL a numeric NULL
        let s = substitute("set saleprice = round($1 * $2, 2), cost = $3 - $1, n = $4 + 1", &[json!({"$dec": "12.50"}), json!(3), json!({"$dec": "-0.75"}), json!(null)]).unwrap();
        assert_eq!(s, "set saleprice = round(12.50 * 3, 2), cost = (-0.75) - 12.50, n = NULL::numeric + 1");
        assert_eq!(substitute("$1 / $2", &[json!(null), json!(null)]).unwrap(), "NULL::numeric / NULL::numeric");
        // anywhere else a decimal keeps its quoted text and a NULL stays NULL, as before
        assert_eq!(substitute("where code = $1 and qty = $2 and x = $3", &[json!({"$dec": "7.5"}), json!(null), json!("5")]).unwrap(),
            "where code = '7.5' and qty = NULL and x = '5'");
        // a comment next to a placeholder is not an operator; a string stays a string even in arithmetic
        assert_eq!(substitute("select $1 -- c\n, /* c */ $2, $3 * 2", &[json!(null), json!(null), json!("4")]).unwrap(), "select NULL -- c\n, /* c */ NULL, '4' * 2");
        assert_eq!(substitute("select $1 * 2", &[json!({"$dec": "1e5"})]), Err(SubError::Unsupported(1)));
    }

    #[test]
    fn a_string_argument_sorting_by_itself_names_the_output_column() {
        // d_postedsale_for_population: `ORDER BY :ai_ordercol` with "salerowid" / "itemname" / "aliasname"
        let sql = "select x from (select 1 as salerowid) as t ORDER BY $1";
        assert_eq!(substitute(sql, &[json!("SaleRowID")]).unwrap(), "select x from (select 1 as salerowid) as t ORDER BY \"salerowid\"");
        assert_eq!(substitute("order  by\n $1 desc, b", &[json!("itemname")]).unwrap(), "order  by\n \"itemname\" desc, b");
        // a position stays a position; text that is not a name stays a literal (refused, as SQL Server refuses it)
        assert_eq!(substitute("order by $1", &[json!(2)]).unwrap(), "order by 2");
        assert_eq!(substitute("order by $1", &[json!("a b")]).unwrap(), "order by 'a b'");
        assert_eq!(substitute("order by $1", &[json!("x\"; drop")]).unwrap(), "order by 'x\"; drop'");
        // inside an expression, or after another word ending in "order by", it is an ordinary literal
        assert_eq!(substitute("order by case lower($1) when 'a' then 1 end", &[json!("A")]).unwrap(), "order by case lower('A') when 'a' then 1 end");
        assert_eq!(substitute("order by $1 || 'x'", &[json!("a")]).unwrap(), "order by 'a' || 'x'");
        assert_eq!(substitute("where reorder by $1", &[json!("a")]).unwrap(), "where reorder by 'a'");
        assert_eq!(substitute("group by $1", &[json!("a")]).unwrap(), "group by 'a'");
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
