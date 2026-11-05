//! Strict USMTF latitude/longitude parsing shared by message contributors.
use crate::{ErrorKind, ParseFailure, types::GeoPoint};

fn bad(code: &'static str) -> ParseFailure {
    ParseFailure::new(ErrorKind::InvalidValue, code)
}
fn component(raw: &str, degrees: usize, max: f64) -> Result<f64, ParseFailure> {
    let (whole, fraction) = raw.split_once('.').unwrap_or((raw, ""));
    if !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
        || raw.len() > 18
    {
        return Err(bad("coordinate_digits"));
    }
    if ![degrees, degrees + 2, degrees + 4].contains(&whole.len()) {
        return Err(bad("coordinate_precision"));
    }
    let d = whole[..degrees]
        .parse::<f64>()
        .map_err(|_| bad("coordinate_digits"))?;
    let value = match whole.len() - degrees {
        0 => {
            if !fraction.is_empty() {
                return Err(bad("coordinate_precision"));
            }
            d
        }
        2 => {
            let m = raw[degrees..]
                .parse::<f64>()
                .map_err(|_| bad("coordinate_digits"))?;
            if m >= 60.0 {
                return Err(bad("coordinate_minutes"));
            }
            d + m / 60.0
        }
        _ => {
            let m = whole[degrees..degrees + 2]
                .parse::<f64>()
                .map_err(|_| bad("coordinate_digits"))?;
            let s = raw[degrees + 2..]
                .parse::<f64>()
                .map_err(|_| bad("coordinate_digits"))?;
            if m >= 60.0 || s >= 60.0 {
                return Err(bad("coordinate_seconds"));
            }
            d + m / 60.0 + s / 3600.0
        }
    };
    if !value.is_finite() || value > max {
        return Err(bad("coordinate_range"));
    }
    Ok(value)
}
fn checksum(raw: &str, value: u8) -> Result<(), ParseFailure> {
    if !value.is_ascii_digit()
        || raw
            .bytes()
            .filter(u8::is_ascii_digit)
            .map(|b| (b - b'0') as u32)
            .sum::<u32>()
            % 10
            != (value - b'0') as u32
    {
        return Err(bad("coordinate_checksum"));
    }
    Ok(())
}
pub fn point(raw: &str) -> Result<GeoPoint, ParseFailure> {
    let raw = ["LATTM:", "LATCS:", "LATLON:"]
        .iter()
        .find_map(|p| raw.strip_prefix(p))
        .unwrap_or(raw);
    if !raw.is_ascii() || raw.len() > 45 {
        return Err(bad("coordinate_format"));
    }
    let ns = raw.find(['N', 'S']).ok_or(bad("coordinate_hemisphere"))?;
    let mut rest = &raw[ns + 1..];
    let verified = rest.as_bytes().get(1) == Some(&b'-');
    if verified {
        checksum(&raw[..ns], rest.as_bytes()[0])?;
        rest = &rest[2..];
    }
    let ew = rest.find(['E', 'W']).ok_or(bad("coordinate_hemisphere"))?;
    let suffix = &rest[ew + 1..];
    if verified {
        if suffix.len() != 1 {
            return Err(bad("coordinate_checksum"));
        }
        checksum(&rest[..ew], suffix.as_bytes()[0])?;
    } else if !suffix.is_empty() {
        return Err(bad("coordinate_suffix"));
    }
    let lat = component(&raw[..ns], 2, 90.0)?
        * if raw.as_bytes()[ns] == b'S' {
            -1.0
        } else {
            1.0
        };
    let lon = component(&rest[..ew], 3, 180.0)?
        * if rest.as_bytes()[ew] == b'W' {
            -1.0
        } else {
            1.0
        };
    Ok(GeoPoint { lat, lon })
}
