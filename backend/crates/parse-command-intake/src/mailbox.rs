//! Read-only IMAP adapter using bounded RFC response parsing; no SEARCH ALL or sequence cursors.
use crate::{IntakeError, Result, config::Config};
use imap_proto::{AttributeValue, Response, ResponseCode, Status};
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::{Duration, Instant},
};
pub struct Mailbox<S = TcpStream> {
    stream: S,
    buffer: Vec<u8>,
    tag: u32,
    wire_left: usize,
    max_response: usize,
    max_responses: usize,
    deadline: Instant,
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fake {
        input: std::io::Cursor<Vec<u8>>,
        written: Vec<u8>,
    }
    impl Read for Fake {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            let count = out.len().min(3);
            self.input.read(&mut out[..count])
        }
    }
    impl Write for Fake {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.written.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl DeadlineStream for Fake {
        fn read_timeout(&mut self, _: Duration) -> std::io::Result<()> {
            Ok(())
        }
    }
    fn connection(bytes: &[u8], limit: usize) -> Mailbox<Fake> {
        Mailbox {
            stream: Fake {
                input: std::io::Cursor::new(bytes.to_vec()),
                written: Vec::new(),
            },
            buffer: Vec::new(),
            tag: 0,
            wire_left: limit,
            max_response: limit,
            max_responses: 100,
            deadline: Instant::now() + Duration::from_secs(1),
        }
    }
    fn config() -> Config {
        Config::load(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/demo-intake.json"),
        )
        .unwrap()
    }
    #[test]
    fn fragmented_literal_uses_uid_and_peek_and_checks_response_identity() {
        let bytes = b"* 3 FETCH (UID 7 BODY[]<0> {5}\r\nhello)\r\nP1 OK done\r\n";
        let mut c = connection(bytes, 1024);
        assert_eq!(c.body(7, &config()).unwrap().unwrap(), b"hello");
        assert!(
            String::from_utf8(c.stream.written)
                .unwrap()
                .contains("UID FETCH 7 (UID BODY.PEEK[]")
        );
        let mut c = connection(bytes, 1024);
        assert_eq!(c.body(8, &config()).err().unwrap().0, "imap_body_identity");
        let mut c = connection(b"P999 OK done\r\n", 1024);
        assert_eq!(c.body(7, &config()).err().unwrap().0, "imap_command");
    }
    #[test]
    fn malformed_or_oversized_server_responses_fail_without_allocation_from_literal_length() {
        for bytes in [
            b"* 1 FETCH (UID 7 BODY[] {999999999}\r\n".as_slice(),
            b"* 1 FETCH (BODYSTRUCTURE ((((((((((((((((((((\r\n".as_slice(),
            b"not an IMAP response\r\n".as_slice(),
        ] {
            let mut c = connection(bytes, 32);
            assert!(c.body(7, &config()).is_err());
        }
        assert!(quoted("user\r\nLOGOUT").is_err());
        assert!(quoted("pass\0word").is_err());
    }
}
#[derive(Clone, Copy)]
pub struct Selection {
    pub uidvalidity: u32,
    pub uidnext: u32,
}
#[derive(Clone)]
pub struct Metadata {
    pub uid: u32,
    pub size: u32,
    pub received_at: String,
}
fn quoted(value: &str) -> Result<String> {
    if value.len() > 4096 || !value.is_ascii() || value.bytes().any(|b| b < 32 || b == 127) {
        return Err(IntakeError("imap_quoted_value"));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}
impl Mailbox {
    pub fn connect(c: &Config, password: &str) -> Result<(Self, Selection)> {
        let timeout = Duration::from_secs(c.io_timeout_seconds);
        let address = (c.host.as_str(), c.port)
            .to_socket_addrs()?
            .next()
            .ok_or(IntakeError("imap_address"))?;
        let private = match address.ip() {
            std::net::IpAddr::V4(ip) => ip.is_loopback() || ip.is_private(),
            std::net::IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local(),
        };
        if !private {
            return Err(IntakeError("demo_endpoint_not_private"));
        }
        let stream = TcpStream::connect_timeout(&address, timeout)
            .map_err(|_| IntakeError("imap_connect"))?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        let mut result = Self {
            stream,
            buffer: Vec::new(),
            tag: 0,
            wire_left: c.max_wire_bytes_per_poll,
            max_response: c.max_response_bytes,
            max_responses: c.max_responses_per_command,
            deadline: Instant::now() + timeout,
        };
        let greeting = result.response()?;
        match imap_proto::Response::from_bytes(&greeting) {
            Ok((
                _,
                Response::Data {
                    status: Status::Ok, ..
                },
            )) => {}
            _ => return Err(IntakeError("imap_greeting")),
        }
        result.command(
            &format!("LOGIN {} {}", quoted(&c.username)?, quoted(password)?),
            |_| Ok(()),
            timeout,
        )?;
        let mut validity = None;
        let mut next = None;
        result.command(
            &format!("EXAMINE {}", quoted(&c.mailbox)?),
            |r| {
                match r {
                    Response::Data {
                        code: Some(ResponseCode::UidValidity(v)),
                        ..
                    } => validity = Some(v),
                    Response::Data {
                        code: Some(ResponseCode::UidNext(v)),
                        ..
                    } => next = Some(v),
                    _ => {}
                }
                Ok(())
            },
            timeout,
        )?;
        let selection = Selection {
            uidvalidity: validity
                .filter(|v| *v > 0)
                .ok_or(IntakeError("imap_uidvalidity"))?,
            uidnext: next.filter(|v| *v > 0).ok_or(IntakeError("imap_uidnext"))?,
        };
        Ok((result, selection))
    }
}

pub trait DeadlineStream: Read + Write {
    fn read_timeout(&mut self, duration: Duration) -> std::io::Result<()>;
}
impl DeadlineStream for TcpStream {
    fn read_timeout(&mut self, duration: Duration) -> std::io::Result<()> {
        self.set_read_timeout(Some(duration))
    }
}
impl<S: DeadlineStream> Mailbox<S> {
    fn response(&mut self) -> Result<Vec<u8>> {
        loop {
            // Recursive unsolicited structures are not part of the requested protocol subset.
            let line_end = self
                .buffer
                .windows(2)
                .position(|w| w == b"\r\n")
                .unwrap_or(self.buffer.len());
            let prefix = &self.buffer[..line_end];
            if prefix
                .windows(13)
                .any(|w| w.eq_ignore_ascii_case(b"BODYSTRUCTURE"))
                || prefix.iter().filter(|b| **b == b'(').count() > 32
            {
                return Err(IntakeError("imap_unrequested_structure"));
            }
            match imap_proto::Response::from_bytes(&self.buffer) {
                Ok((tail, _)) => {
                    let used = self.buffer.len() - tail.len();
                    return Ok(self.buffer.drain(..used).collect());
                }
                Err(nom::Err::Incomplete(_)) => {}
                Err(_) => return Err(IntakeError("imap_response")),
            }
            let available = self
                .max_response
                .saturating_sub(self.buffer.len())
                .min(self.wire_left)
                .min(8192);
            if available == 0 {
                return Err(IntakeError("imap_wire_limit"));
            }
            let left = self.deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(IntakeError("imap_deadline"));
            }
            self.stream.read_timeout(left)?;
            let mut block = [0u8; 8192];
            let got = self
                .stream
                .read(&mut block[..available])
                .map_err(|_| IntakeError("imap_read"))?;
            if got == 0 {
                return Err(IntakeError("imap_eof"));
            }
            self.wire_left -= got;
            self.buffer.extend_from_slice(&block[..got]);
        }
    }
    fn command(
        &mut self,
        command: &str,
        mut on_response: impl FnMut(Response<'_>) -> Result<()>,
        timeout: Duration,
    ) -> Result<()> {
        self.tag = self.tag.checked_add(1).ok_or(IntakeError("imap_tag"))?;
        let tag = format!("P{}", self.tag);
        self.deadline = Instant::now() + timeout;
        write!(self.stream, "{tag} {command}\r\n").map_err(|_| IntakeError("imap_write"))?;
        for _ in 0..self.max_responses {
            let bytes = self.response()?;
            let (_, response) = imap_proto::Response::from_bytes(&bytes)
                .map_err(|_| IntakeError("imap_response"))?;
            match response {
                Response::Done {
                    tag: got, status, ..
                } => {
                    return if got.as_bytes() == tag.as_bytes() && status == Status::Ok {
                        Ok(())
                    } else {
                        Err(IntakeError("imap_command"))
                    };
                }
                Response::Data {
                    status: Status::Bye,
                    ..
                }
                | Response::Continue { .. } => return Err(IntakeError("imap_session")),
                other => on_response(other)?,
            }
        }
        Err(IntakeError("imap_response_count"))
    }
    pub fn metadata(&mut self, start: u32, end: u32, c: &Config) -> Result<Vec<Metadata>> {
        let mut rows = std::collections::BTreeMap::new();
        self.command(
            &format!("UID FETCH {start}:{end} (UID RFC822.SIZE INTERNALDATE)"),
            |r| {
                if let Response::Fetch(_, attrs) = r {
                    let uid = attrs.iter().find_map(|a| {
                        if let AttributeValue::Uid(v) = a {
                            Some(*v)
                        } else {
                            None
                        }
                    });
                    let size = attrs.iter().find_map(|a| {
                        if let AttributeValue::Rfc822Size(v) = a {
                            Some(*v)
                        } else {
                            None
                        }
                    });
                    let received_at = attrs.iter().find_map(|a| {
                        if let AttributeValue::InternalDate(v) = a {
                            Some(v.as_ref())
                        } else {
                            None
                        }
                    });
                    if let (Some(uid), Some(size)) = (uid, size) {
                        let received_at = received_at.ok_or(IntakeError("imap_internaldate"))?;
                        let received_at = chrono::DateTime::parse_from_str(
                            received_at.trim(),
                            "%d-%b-%Y %H:%M:%S %z",
                        )
                        .map_err(|_| IntakeError("imap_internaldate"))?
                        .with_timezone(&chrono::Utc)
                        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
                        if uid < start
                            || uid > end
                            || rows.len() >= c.uid_window as usize
                            || rows
                                .insert(
                                    uid,
                                    Metadata {
                                        uid,
                                        size,
                                        received_at,
                                    },
                                )
                                .is_some()
                        {
                            return Err(IntakeError("imap_uid_response"));
                        }
                    }
                }
                Ok(())
            },
            Duration::from_secs(c.io_timeout_seconds),
        )?;
        Ok(rows.into_values().collect())
    }
    pub fn body(&mut self, uid: u32, c: &Config) -> Result<Option<Vec<u8>>> {
        let mut body = None;
        self.command(
            &format!(
                "UID FETCH {uid} (UID BODY.PEEK[]<0.{}>)",
                c.max_raw_bytes + 1
            ),
            |r| {
                if let Response::Fetch(_, attrs) = r {
                    let got = attrs.iter().find_map(|a| {
                        if let AttributeValue::Uid(v) = a {
                            Some(*v)
                        } else {
                            None
                        }
                    });
                    for attr in &attrs {
                        if let AttributeValue::BodySection {
                            section: None,
                            index,
                            data: Some(data),
                        } = attr
                        {
                            if got != Some(uid) || index.is_some_and(|v| v != 0) || body.is_some() {
                                return Err(IntakeError("imap_body_identity"));
                            }
                            if data.len() > c.max_raw_bytes {
                                return Err(IntakeError("imap_body_limit"));
                            }
                            body = Some(data.to_vec());
                        }
                    }
                }
                Ok(())
            },
            Duration::from_secs(c.io_timeout_seconds),
        )?;
        Ok(body)
    }
}
