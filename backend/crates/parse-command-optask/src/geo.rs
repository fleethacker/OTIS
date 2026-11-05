use super::*;
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
pub(super) fn point(raw: &str) -> Result<GeoPoint, ParseFailure> {
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
fn location(kind: LocationType, label: &str, scope: &Scope) -> Location {
    let datum = scope.datum.clone().unwrap_or_else(|| "WGS84".into());
    Location {
        id: "g1".into(),
        kind,
        label: label.into(),
        datum,
        datum_source: if scope.datum.is_some() {
            LocationDatumSource::Explicit
        } else {
            LocationDatumSource::Default
        },
        status: LocationStatus::Inferred,
        point: None,
        shape: None,
        radius_m: None,
        scope: scope.fact(),
    }
}
pub(super) fn extract(
    r: &RecordView<'_>,
    scope: &Scope,
    budget: &WorkBudget<'_>,
) -> Result<Option<Extraction>, ParseFailure> {
    let (kind, label, positions) = match r.set_id {
        "AREA" => (
            LocationType::Area,
            "Area",
            (1..=r.fields.len()).collect::<Vec<_>>(),
        ),
        "CIRC" => (LocationType::CircleCenter, "Circular area", vec![1]),
        "RASKED" => (LocationType::Position, "Replenishment rendezvous", vec![2]),
        "RNDZVOUS" => (LocationType::Position, "Rendezvous", vec![2]),
        "FYPOS" => (LocationType::Position, "Reported unit position", vec![2]),
        "PIM" => (
            LocationType::Position,
            "Position and intended movement",
            vec![1],
        ),
        "DIVERT" => (LocationType::Position, "Diversion position", vec![1]),
        "ANCHOR" => (LocationType::Position, "Anchor position", vec![4]),
        "DLRPGRID" => (LocationType::Position, "Data link reference point", vec![3]),
        "LNKISCC" => (LocationType::Position, "Link coordinate center", vec![1]),
        "MDA" => (
            LocationType::Position,
            "Reported danger area position",
            vec![2],
        ),
        "CHANDAT" => (
            LocationType::Channel,
            "Channel endpoint segment",
            vec![2, 3],
        ),
        _ => return Ok(None),
    };
    let mut value = location(kind, label, scope);
    let source_locations = positions
        .iter()
        .map(|position| field(r, *position))
        .collect::<Result<Vec<_>, _>>()?;
    let named = |raw: &str| {
        if raw == "-" || raw.is_empty() {
            return false;
        }
        if ["NAME:", "PLACE:", "N:", "REF:"]
            .iter()
            .any(|prefix| raw.starts_with(prefix) && raw.len() > prefix.len())
        {
            return true;
        }
        !raw.contains(':') && raw.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
    };
    if source_locations.iter().any(|raw| named(raw))
        && source_locations
            .iter()
            .all(|raw| named(raw) || point(raw).is_ok())
    {
        value.label = source_locations
            .iter()
            .map(|raw| raw.as_ref())
            .collect::<Vec<_>>()
            .join(" / ");
        // Unresolved describes geometry only. A supplied place name is valid source
        // data and never requires fabricated coordinates or a geospatial review flag.
        value.status = LocationStatus::Unresolved;
        return Ok(Some(Extraction {
            facts: vec![Fact::Location(value)],
            rule: "optask.named_location.v1",
            source: "source named location; user-approved unmapped location policy",
            diagnostic: None,
        }));
    }
    let geometry = (|| {
        if !matches!(value.datum.as_str(), "WGS84" | "WGS-84" | "WE") {
            return Err(bad("coordinate_datum"));
        }
        value.datum = "WGS84".into();
        let points = positions
            .iter()
            .map(|i| field(r, *i).and_then(|v| point(&v)))
            .collect::<Result<Vec<_>, _>>()?;
        if points.is_empty() {
            return Err(bad("coordinate_missing"));
        }
        if points.len() == 1 {
            value.point = Some(points[0].clone());
        } else if kind == LocationType::Channel {
            if points[0] == points[1] {
                value.point = Some(points[0].clone());
            } else {
                value.shape=json!({"type":"LineString","coordinates":points.iter().map(|p|[p.lon,p.lat]).collect::<Vec<_>>()}).as_object().cloned();
            }
        } else {
            if points.len() < 3 {
                return Err(bad("area_vertices"));
            }
            let mut coords = points.iter().map(|p| [p.lon, p.lat]).collect::<Vec<_>>();
            if coords.first() != coords.last() {
                coords.push(coords[0]);
            }
            validate_ring(&coords, budget)?;
            let area = coords
                .windows(2)
                .map(|w| w[0][0] * w[1][1] - w[1][0] * w[0][1])
                .sum::<f64>();
            if area.abs() < 1e-12 {
                return Err(bad("area_degenerate"));
            }
            if area < 0.0 {
                coords.reverse();
            }
            value.shape = json!({"type":"Polygon","coordinates":[coords]})
                .as_object()
                .cloned();
        }
        if kind == LocationType::CircleCenter {
            let raw = field(r, 2)?;
            let (number, scale) = [("NM", 1852.0), ("KM", 1000.0), ("M", 1.0)]
                .iter()
                .find_map(|(u, s)| raw.strip_suffix(u).map(|n| (n, *s)))
                .ok_or(bad("circle_radius_unit"))?;
            let radius = number.parse::<f64>().map_err(|_| bad("circle_radius"))? * scale;
            if !radius.is_finite() || radius < 0.0 {
                return Err(bad("circle_radius"));
            }
            value.radius_m = Some(radius);
        }
        Ok(())
    })();
    if let Err(error) = &geometry {
        if error.kind == ErrorKind::ResourceLimit || error.kind == ErrorKind::Cancelled {
            return Err(*error);
        }
    }
    let diagnostic = geometry.err().map(|e| e.code);
    if diagnostic.is_some() {
        value.point = None;
        value.shape = None;
        value.radius_m = None;
        value.status = LocationStatus::Unresolved;
    }
    Ok(Some(Extraction {
        facts: vec![Fact::Location(value)],
        rule: "optask.geospatial.v1",
        source: "S1 AREA p.1448, CIRC p.1603, CHANDAT p.1585, PIM p.2474, FF0112 p.3820; S3 pp.243-263",
        diagnostic,
    }))
}

fn validate_ring(coords: &[[f64; 2]], budget: &WorkBudget<'_>) -> Result<(), ParseFailure> {
    fn turn(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    }
    fn on(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> bool {
        p[0] >= a[0].min(b[0])
            && p[0] <= a[0].max(b[0])
            && p[1] >= a[1].min(b[1])
            && p[1] <= a[1].max(b[1])
    }
    for (i, a) in coords.windows(2).enumerate() {
        if (a[0][0] - a[1][0]).abs() > 180.0 {
            return Err(bad("area_dateline_review"));
        }
        for (j, b) in coords.windows(2).enumerate().skip(i + 2) {
            budget.checkpoint(1)?;
            if i == 0 && j == coords.len() - 2 {
                continue;
            }
            let p = turn(a[0], a[1], b[0]);
            let q = turn(a[0], a[1], b[1]);
            let r = turn(b[0], b[1], a[0]);
            let s = turn(b[0], b[1], a[1]);
            if (p * q < 0.0 && r * s < 0.0)
                || (p.abs() < 1e-14 && on(a[0], a[1], b[0]))
                || (q.abs() < 1e-14 && on(a[0], a[1], b[1]))
                || (r.abs() < 1e-14 && on(b[0], b[1], a[0]))
                || (s.abs() < 1e-14 && on(b[0], b[1], a[1]))
            {
                return Err(bad("area_self_intersection"));
            }
        }
    }
    Ok(())
}
