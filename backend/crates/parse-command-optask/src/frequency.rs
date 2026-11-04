use parse_command_parser_api::*;
use parse_command_types::*;
fn bad(code: &'static str) -> ParseFailure {
    ParseFailure::new(ErrorKind::InvalidValue, code)
}
/// Exact integer arithmetic: no floating point rounding of the integer-Hz wire representation.
fn decimal(value: &str, scale: i64) -> Result<i64, ParseFailure> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
        || value.ends_with('.')
        || value.len() > 11
    {
        return Err(bad("frequency_digits"));
    }
    let whole: i64 = whole.parse().map_err(|_| bad("frequency_overflow"))?;
    let denominator = 10i64
        .checked_pow(fraction.len() as u32)
        .ok_or(bad("frequency_overflow"))?;
    let numerator = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<i64>()
            .map_err(|_| bad("frequency_digits"))?
    };
    let scaled = numerator
        .checked_mul(scale)
        .ok_or(bad("frequency_overflow"))?;
    if scaled % denominator != 0 {
        return Err(bad("frequency_sub_hz"));
    }
    whole
        .checked_mul(scale)
        .and_then(|w| w.checked_add(scaled / denominator))
        .ok_or(bad("frequency_overflow"))
}
pub(crate) fn parse(raw: &str) -> Result<(Option<i64>, Option<i64>), ParseFailure> {
    if raw == "-" {
        return Ok((None, None));
    }
    let (value, scale) = [
        ("GHZ", 1_000_000_000),
        ("MHZ", 1_000_000),
        ("KHZ", 1_000),
        ("HZ", 1),
    ]
    .into_iter()
    .find_map(|(unit, scale)| raw.strip_suffix(unit).map(|v| (v, scale)))
    .ok_or(bad("frequency_unit"))?;
    if let Some((low, high)) = value.split_once('-') {
        let low = decimal(low, scale)?;
        let high = decimal(high, scale)?;
        if high < low {
            return Err(bad("frequency_range"));
        }
        Ok((Some(low), Some(high)))
    } else {
        Ok((Some(decimal(value, scale)?), None))
    }
}
pub(crate) fn fact(raw: &str) -> Result<Frequency, ParseFailure> {
    let (hz, upper_hz) = parse(raw)?;
    Ok(Frequency {
        id: "f1".into(),
        hz,
        upper_hz,
        plan: None,
        designator: None,
        channel: None,
        emission: None,
        usage: None,
        scope: None,
        status: Some(if hz.is_none() {
            FrequencyStatus::Unavailable
        } else {
            FrequencyStatus::Inferred
        }),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_units_ranges_and_rejected_precision() {
        assert_eq!(parse("1.2345MHZ").unwrap(), (Some(1_234_500), None));
        assert_eq!(
            parse("7.5-12GHZ").unwrap(),
            (Some(7_500_000_000), Some(12_000_000_000))
        );
        for s in [
            "0.5HZ", "123", "-1HZ", "1.2.3MHZ", "12-7GHZ", "1e3KHZ", ".5MHZ", "1.MHZ",
        ] {
            assert!(parse(s).is_err(), "{s}");
        }
    }
}
