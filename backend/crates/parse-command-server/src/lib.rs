//! Canonical publication, typed application RPCs and private UI state.
pub mod proto {
    connectrpc::include_generated!();
}
pub mod access;
pub mod commands;
pub mod changes;
pub mod context_metadata;
pub mod watch_context;
pub mod config;
pub mod error;
pub mod lifecycle;
pub mod notifications;
pub mod pagination;
pub mod preparation;
pub mod presentation;
pub mod private;
pub mod publisher;
pub mod search;
pub use error::{Error, Result};

pub mod api;
pub mod rpc;
pub mod web;
