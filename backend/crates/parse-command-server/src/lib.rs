//! Canonical publication, typed application RPCs and private UI state.
pub mod proto {
    connectrpc::include_generated!();
}
pub mod auth;
pub mod config;
pub mod error;
pub mod http;
pub mod lifecycle;
pub mod notifications;
pub mod pagination;
pub mod preparation;
pub mod presentation;
pub mod private;
pub mod publisher;
pub mod search;
pub mod settings;
pub use error::{Error, Result};

pub mod api;
pub mod rpc;
pub mod web;

pub mod accounts;
pub mod anchor;
pub mod anchor_lineage;
pub mod anchor_timeline;
pub mod pb4t;
pub mod responsibilities;
pub mod station;
pub mod work;
