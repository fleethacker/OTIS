//! Bounded, owner/query-bound result windows. Paging never reruns hybrid ranking.
use crate::{Error, Result, private::timestamp};
use serde::Deserialize;
use serde_json::{Value, json};

pub const PAGE_SIZE: usize = 20;
pub const SEARCH_DEPTH: usize = 100;

#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Sort {
    #[default]
    Relevance,
    IssuedDesc,
    IssuedAsc,
}
impl Sort {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Relevance => "relevance",
            Self::IssuedDesc => "issued_desc",
            Self::IssuedAsc => "issued_asc",
        }
    }
    pub fn browse(self) -> Value {
        json!([{"issued_at":{"order":if self == Self::IssuedAsc {"asc"} else {"desc"},"missing":"_last"}}, "id", "revision"])
    }
}
pub fn split_token(token: &str) -> Result<(&str, usize)> {
    let (id, page) = token
        .split_once('@')
        .ok_or_else(|| Error::invalid("Invalid result page"))?;
    if id.len() != 64
        || !id
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
        || page.len() > 5
        || page.is_empty()
        || !page.bytes().all(|v| v.is_ascii_digit())
    {
        return Err(Error::invalid("Invalid result page"));
    }
    let page = page
        .parse::<usize>()
        .map_err(|_| Error::invalid("Invalid result page"))?;
    if page > 10_000 {
        return Err(Error::invalid("Result page limit"));
    }
    Ok((id, page))
}
pub fn token(id: &str, page: usize) -> String {
    format!("{id}@{page}")
}
pub fn metadata(
    id: &str,
    page: usize,
    total: u64,
    relation: &str,
    more: bool,
    scope: &str,
) -> Value {
    json!({"currentPageToken":token(id,page),"previousPageToken":page.checked_sub(1).map(|v|token(id,v)),"nextPageToken":more.then(||token(id,page+1)),"page":page+1,"pageSize":PAGE_SIZE,"limit":PAGE_SIZE,"totalRecords":total,"totalRelation":relation,"totalPages":if relation=="eq" {Some(total.div_ceil(PAGE_SIZE as u64).max(1))}else{None},"countScope":scope})
}
pub fn sort_documents(documents: &mut Vec<Value>, sort: Sort) -> Result<()> {
    if sort == Sort::Relevance {
        return Ok(());
    }
    let mut keyed = documents
        .iter()
        .cloned()
        .map(|doc| {
            let at = doc["issued_at"].as_str().map(timestamp).transpose()?;
            Ok((
                at,
                doc["id"].as_str().unwrap_or("").to_owned(),
                doc["revision"].as_str().unwrap_or("").to_owned(),
                doc,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    keyed.sort_by(|a, b| {
        match (&a.0, &b.0) {
            (Some(a), Some(b)) => {
                if sort == Sort::IssuedAsc {
                    a.cmp(b)
                } else {
                    b.cmp(a)
                }
            }
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, None) => std::cmp::Ordering::Equal,
        }
        .then_with(|| a.1.cmp(&b.1))
        .then_with(|| a.2.cmp(&b.2))
    });
    *documents = keyed.into_iter().map(|v| v.3).collect();
    Ok(())
}
