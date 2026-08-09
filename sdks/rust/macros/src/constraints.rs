//! Reading `#[simple(…)]`, and saying what is wrong with one.
//!
//! Every refusal in here names three things: what was written, what is accepted
//! in its place, and — through the span the error carries — where to go and
//! change it. Nothing is refused silently and nothing is accepted silently.

use proc_macro2::Span;
use quote::ToTokens;
use syn::meta::ParseNestedMeta;
use syn::parse::ParseStream;
use syn::{token, Attribute, Data, DeriveInput, Error, Field, Lit, Meta, Path, Token};

/// The attribute this module reads.
const ATTR: &str = "simple";

/// The constraints, in the order the documentation lists them.
const CONSTRAINTS: [&str; 7] = [
    "range",
    "length",
    "pattern",
    "format",
    "default",
    "example",
    "deprecated",
];

/// The second line of every "that is not one of these" refusal.
const ACCEPTED: &str = "accepted here: range(min = …, max = …), length(min = …, max = …), \
     pattern = \"…\", format = \"…\", default = …, example = …, deprecated";

/// Check one `#[derive(Schema)]` input, reporting every mistake it holds.
///
/// Errors are collected rather than returned at the first one, so a type with
/// mistakes on four members reports four, and a member carrying two `#[simple]`
/// attributes reports both. One build, one list.
///
/// Within a single attribute the first mistake is the one reported, because that
/// is where reading it stops.
pub(crate) fn check(input: &DeriveInput) -> Result<(), Error> {
    let mut errors: Vec<Error> = Vec::new();

    for attr in ours(&input.attrs) {
        errors.push(Error::new_spanned(
            attr,
            format!(
                "`#[{ATTR}(…)]` constrains a member. Write it on the member it applies to, not on `{}`.",
                input.ident
            ),
        ));
    }

    match &input.data {
        Data::Struct(data) => fields(data.fields.iter(), &mut errors),
        Data::Enum(data) => {
            for variant in &data.variants {
                for attr in ours(&variant.attrs) {
                    errors.push(Error::new_spanned(
                        attr,
                        format!(
                            "`#[{ATTR}(…)]` constrains a member. Write it on a member of `{}`, not on the variant itself.",
                            variant.ident
                        ),
                    ));
                }

                fields(variant.fields.iter(), &mut errors);
            }
        }
        Data::Union(data) => fields(data.fields.named.iter(), &mut errors),
    }

    let mut errors = errors.into_iter();

    match errors.next() {
        None => Ok(()),
        Some(mut first) => {
            for rest in errors {
                first.combine(rest);
            }

            Err(first)
        }
    }
}

/// The `#[simple(…)]` attributes among all the attributes on an item.
fn ours(attrs: &[Attribute]) -> impl Iterator<Item = &Attribute> {
    attrs.iter().filter(|attr| attr.path().is_ident(ATTR))
}

/// Check every member of one struct, variant or union.
fn fields<'a>(fields: impl Iterator<Item = &'a Field>, errors: &mut Vec<Error>) {
    for (index, field) in fields.enumerate() {
        let member = match &field.ident {
            Some(ident) => format!("`{ident}`"),
            None => format!("member {index}"),
        };

        // Written across two attributes or written twice in one, a constraint
        // written twice is the same mistake, so the record of what this member
        // has already said spans all of its attributes.
        let mut written: Vec<String> = Vec::new();

        for attr in ours(&field.attrs) {
            attribute(attr, &member, &mut written, errors);
        }
    }
}

/// Check one `#[simple(…)]` attribute on one member.
fn attribute(attr: &Attribute, member: &str, written: &mut Vec<String>, errors: &mut Vec<Error>) {
    match &attr.meta {
        Meta::List(list) if !list.tokens.is_empty() => {}

        Meta::List(_) => {
            errors.push(Error::new_spanned(
                attr,
                format!("`#[{ATTR}()]` constrains nothing. Write a constraint in it, or remove it.\n{ACCEPTED}"),
            ));

            return;
        }

        _ => {
            errors.push(Error::new_spanned(
                attr,
                format!(
                    "`#[{ATTR}]` takes its constraints in parentheses: `#[{ATTR}(length(max = 64))]`.\n{ACCEPTED}"
                ),
            ));

            return;
        }
    }

    if let Err(error) = attr.parse_nested_meta(|meta| one(&meta, member, written)) {
        errors.push(error);
    }
}

/// Check one constraint out of an attribute that may hold several.
fn one(meta: &ParseNestedMeta, member: &str, written: &mut Vec<String>) -> Result<(), Error> {
    let key = text(&meta.path);

    if CONSTRAINTS.contains(&key.as_str()) {
        if written.iter().any(|seen| seen == &key) {
            return Err(Error::new_spanned(
                &meta.path,
                format!("`{key}` is written twice on {member}. Write it once."),
            ));
        }

        written.push(key.clone());
    }

    match key.as_str() {
        "range" => bounds(meta, "range", Numbers::Any, "range(min = 1, max = 90)"),
        "length" => bounds(meta, "length", Numbers::Count, "length(min = 1, max = 500)"),

        "pattern" => string(meta, "pattern", "^KNOW"),
        "format" => string(meta, "format", "email"),

        "default" => literal(meta, "default", "default = 30"),
        "example" => literal(meta, "example", "example = 7"),

        "deprecated" => flag(meta),

        "description" => Err(Error::new_spanned(
            &meta.path,
            format!(
                "a member's description is its doc comment. Write `/// …` above {member} instead."
            ),
        )),

        // The three tags an action carries. They are written in the action's
        // doc comment, above `fn handler`, and describe the action as a whole.
        "tool" | "shortdesc" | "usewhen" => Err(Error::new_spanned(
            &meta.path,
            format!(
                "`{key}` describes the action, not one of its members. Write it in the action's \
                 doc comment as `@{key}`.\nOn the action: `@tool`, `@shortdesc` and `@usewhen`."
            ),
        )),

        // Whether a member has to be sent is carried by its type, so there is
        // no key for it here and the signature and the schema say one thing.
        "required" | "optional" | "nullable" => Err(Error::new_spanned(
            &meta.path,
            format!(
                "whether {member} is required is its type, not a key. Write `Option<T>` or \
                 `#[serde(default)]` to make it optional, and neither to require it."
            ),
        )),

        // The words a constraint puts in the schema. An author who has read the
        // schema back meets these, so each one names what writes it.
        produced if written_as(produced).is_some() => {
            let writes_it = written_as(produced).unwrap_or_default();

            Err(Error::new_spanned(
                &meta.path,
                format!("`{produced}` is what the schema calls it. Write it as `{writes_it}`."),
            ))
        }

        other => Err(unknown(
            &meta.path,
            other,
            &CONSTRAINTS,
            "a member constraint",
            ACCEPTED.to_owned(),
        )),
    }
}

/// Which numbers a pair of bounds accepts.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Numbers {
    /// Any number, whole or fractional, positive or negative.
    Any,
    /// A count: a whole number, and never below zero.
    Count,
}

impl Numbers {
    /// How to name what this accepts, in a sentence.
    fn noun(self) -> &'static str {
        match self {
            Numbers::Any => "a number",
            Numbers::Count => "a whole number",
        }
    }
}

/// One bound, kept alongside the span and the text the author wrote for it.
struct Bound {
    value: f64,
    span: Span,
    text: String,
}

/// Check `range(…)` or `length(…)`.
fn bounds(meta: &ParseNestedMeta, key: &str, numbers: Numbers, sample: &str) -> Result<(), Error> {
    if !meta.input.peek(token::Paren) {
        return Err(Error::new_spanned(
            &meta.path,
            format!("`{key}` takes its bounds in parentheses: `{sample}`."),
        ));
    }

    // An empty group is read off a fork, before the real parse touches the
    // input, so that `range()` is answered by the sentence below rather than by
    // whatever a parser says when it runs out of tokens.
    let lookahead = meta.input.fork();
    let group;
    syn::parenthesized!(group in &lookahead);

    if group.is_empty() {
        return Err(Error::new_spanned(
            &meta.path,
            format!("`{key}()` sets no bound. Write `{sample}`, or remove it."),
        ));
    }

    let mut min: Option<Bound> = None;
    let mut max: Option<Bound> = None;

    meta.parse_nested_meta(|inner| {
        let name = text(&inner.path);

        let slot = match name.as_str() {
            "min" => &mut min,
            "max" => &mut max,
            other => {
                return Err(unknown(
                    &inner.path,
                    other,
                    &["min", "max"],
                    &format!("a bound of `{key}`"),
                    format!("`{key}` takes `min` and `max`: `{sample}`"),
                ))
            }
        };

        if slot.is_some() {
            return Err(Error::new_spanned(
                &inner.path,
                format!("`{key}` is given `{name}` twice. Write it once."),
            ));
        }

        if !inner.input.peek(Token![=]) {
            return Err(Error::new_spanned(
                &inner.path,
                format!("`{name}` takes a value: `{sample}`."),
            ));
        }

        *slot = Some(number(inner.value()?, key, &name, numbers)?);

        Ok(())
    })?;

    match (&min, &max) {
        (Some(low), Some(high)) if low.value > high.value => Err(Error::new(
            low.span,
            format!(
                "`{key}(min = {}, max = {})` accepts nothing, because min is above max.",
                low.text, high.text
            ),
        )),

        _ => Ok(()),
    }
}

/// Read the value of one bound.
fn number(input: ParseStream, key: &str, bound: &str, numbers: Numbers) -> Result<Bound, Error> {
    let span = input.span();
    let noun = numbers.noun();

    let negative = input.peek(Token![-]);

    if negative {
        input.parse::<Token![-]>()?;
    }

    let lit: Lit = input.parse().map_err(|_| {
        Error::new(
            span,
            format!("`{key}({bound} = …)` takes {noun}, written as a plain number."),
        )
    })?;

    let text = match negative {
        true => format!("-{}", lit.to_token_stream()),
        false => lit.to_token_stream().to_string(),
    };

    let refuse = |because: String| Error::new(span, because);

    let magnitude = match (&lit, numbers) {
        (Lit::Int(int), _) => int.base10_parse::<f64>().map_err(|_| {
            refuse(format!(
                "`{key}({bound} = …)` takes {noun}, and `{text}` is not one."
            ))
        })?,

        (Lit::Float(float), Numbers::Any) => float.base10_parse::<f64>().map_err(|_| {
            refuse(format!(
                "`{key}({bound} = …)` takes {noun}, and `{text}` is not one."
            ))
        })?,

        (Lit::Float(_), Numbers::Count) => {
            return Err(refuse(format!(
                "`{key}({bound} = …)` counts whole things, and `{text}` is a fraction."
            )))
        }

        (other, _) => {
            return Err(refuse(format!(
                "`{key}({bound} = …)` takes {noun}, and `{text}` is {}.",
                describe(other)
            )))
        }
    };

    if negative && numbers == Numbers::Count {
        return Err(refuse(format!(
            "`{key}({bound} = …)` counts things and is never below zero, and `{text}` is."
        )));
    }

    Ok(Bound {
        value: match negative {
            true => -magnitude,
            false => magnitude,
        },
        span,
        text,
    })
}

/// Check `pattern = "…"` or `format = "…"`.
fn string(meta: &ParseNestedMeta, key: &str, sample: &str) -> Result<(), Error> {
    if !meta.input.peek(Token![=]) {
        return Err(Error::new_spanned(
            &meta.path,
            format!("`{key}` takes a value: `{key} = \"{sample}\"`."),
        ));
    }

    let input = meta.value()?;
    let span = input.span();

    let lit: Lit = input.parse().map_err(|_| {
        Error::new(
            span,
            format!("`{key}` takes a string: `{key} = \"{sample}\"`."),
        )
    })?;

    match &lit {
        Lit::Str(text) if text.value().is_empty() => Err(Error::new(
            span,
            format!("`{key}` is empty, which constrains nothing. Write `{key} = \"{sample}\"`, or remove it."),
        )),

        Lit::Str(_) => Ok(()),

        other => Err(Error::new(
            span,
            format!(
                "`{key}` takes a string, and `{}` is {}. Write `{key} = \"{sample}\"`.",
                other.to_token_stream(),
                describe(other)
            ),
        )),
    }
}

/// Check `default = …` or `example = …`, which take any single value.
fn literal(meta: &ParseNestedMeta, key: &str, sample: &str) -> Result<(), Error> {
    if !meta.input.peek(Token![=]) {
        return Err(Error::new_spanned(
            &meta.path,
            format!("`{key}` takes a value: `{sample}`."),
        ));
    }

    let input = meta.value()?;
    let span = input.span();

    if input.peek(Token![-]) {
        input.parse::<Token![-]>()?;
    }

    input
        .parse::<Lit>()
        .map(|_| ())
        .map_err(|_| Error::new(span, format!("`{key}` takes a single value: `{sample}`.")))
}

/// Check `deprecated`, which is written on its own.
fn flag(meta: &ParseNestedMeta) -> Result<(), Error> {
    match meta.input.peek(Token![=]) || meta.input.peek(token::Paren) {
        true => Err(Error::new_spanned(
            &meta.path,
            format!("`deprecated` is written on its own, with no value: `#[{ATTR}(deprecated)]`."),
        )),

        false => Ok(()),
    }
}

/// How a member writes the constraint that produces the given schema name.
///
/// `range` and `length` each put two words in the schema, and those words are
/// what an author reading the schema back has in hand. Both the spelling the
/// schema uses and the spelling Rust reaches for are answered, so either one
/// leads to the constraint that writes it.
fn written_as(name: &str) -> Option<&'static str> {
    match name {
        "minimum" | "min_value" => Some("range(min = …)"),
        "maximum" | "max_value" => Some("range(max = …)"),

        "minLength" | "min_length" | "minItems" | "min_items" => Some("length(min = …)"),
        "maxLength" | "max_length" | "maxItems" | "max_items" => Some("length(max = …)"),

        _ => None,
    }
}

/// Refuse a key that is not in the accepted set, suggesting the nearest one.
fn unknown(path: &Path, was: &str, accepted: &[&str], role: &str, list: String) -> Error {
    let suggestion = match nearest(was, accepted) {
        Some(near) => format!(" Did you mean `{near}`?"),
        None => String::new(),
    };

    Error::new_spanned(path, format!("`{was}` is not {role}.{suggestion}\n{list}"))
}

/// The accepted key closest to what was written, when one is close enough.
///
/// Two things count as close. A key that spells out an accepted one — `minimum`
/// for `min` — is the one that was reached for whatever its length. Otherwise
/// two single-character edits, which covers a transposition and a slip, and
/// leaves `collection` suggesting nothing.
fn nearest<'a>(was: &str, accepted: &[&'a str]) -> Option<&'a str> {
    let lowered = was.to_lowercase();

    if let Some(spelled_out) = accepted
        .iter()
        .filter(|candidate| lowered.starts_with(*candidate) || candidate.starts_with(&lowered))
        .min_by_key(|candidate| candidate.len().abs_diff(lowered.len()))
    {
        return Some(spelled_out);
    }

    accepted
        .iter()
        .map(|candidate| (distance(&lowered, candidate), *candidate))
        .filter(|(distance, _)| *distance <= 2)
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, candidate)| candidate)
}

/// The number of single-character edits between two words.
fn distance(left: &str, right: &str) -> usize {
    let right: Vec<char> = right.chars().collect();

    let mut row: Vec<usize> = (0..=right.len()).collect();

    for (i, l) in left.chars().enumerate() {
        let mut diagonal = row[0];

        row[0] = i + 1;

        for (j, r) in right.iter().enumerate() {
            let above = row[j + 1];

            row[j + 1] = usize::min(
                usize::min(row[j] + 1, above + 1),
                diagonal + usize::from(l != *r),
            );

            diagonal = above;
        }
    }

    row[right.len()]
}

/// How to name a literal that is not the kind wanted, in a sentence.
fn describe(lit: &Lit) -> &'static str {
    match lit {
        Lit::Str(_) => "a string",
        Lit::ByteStr(_) => "a byte string",
        Lit::CStr(_) => "a C string",
        Lit::Byte(_) => "a byte",
        Lit::Char(_) => "a character",
        Lit::Int(_) => "a whole number",
        Lit::Float(_) => "a fraction",
        Lit::Bool(_) => "a boolean",
        _ => "another kind of literal",
    }
}

/// The path an author wrote, as they wrote it.
fn text(path: &Path) -> String {
    path.to_token_stream().to_string().replace(' ', "")
}

#[cfg(test)]
mod tests {
    use super::{distance, nearest, CONSTRAINTS};

    /// The suggestion is what makes a typo a one-line fix rather than a hunt
    /// through the documentation, so the typos worth catching are pinned here.
    #[test]
    fn a_typo_suggests_the_constraint_it_was_reaching_for() {
        assert_eq!(nearest("rnage", &CONSTRAINTS), Some("range"));
        assert_eq!(nearest("Range", &CONSTRAINTS), Some("range"));
        assert_eq!(nearest("lenght", &CONSTRAINTS), Some("length"));
        assert_eq!(nearest("patern", &CONSTRAINTS), Some("pattern"));
        assert_eq!(nearest("minimum", &["min", "max"]), Some("min"));
        assert_eq!(nearest("maximum", &["min", "max"]), Some("max"));
    }

    /// A word that is not reaching for anything suggests nothing, so the second
    /// line — the accepted set — is what the author reads instead of a guess.
    #[test]
    fn a_word_reaching_for_nothing_suggests_nothing() {
        assert_eq!(nearest("collection", &CONSTRAINTS), None);
        assert_eq!(nearest("zzz", &CONSTRAINTS), None);
    }

    #[test]
    fn distance_counts_single_character_edits() {
        assert_eq!(distance("range", "range"), 0);
        assert_eq!(distance("rnage", "range"), 2);
        assert_eq!(distance("rang", "range"), 1);
        assert_eq!(distance("", "range"), 5);
    }
}
