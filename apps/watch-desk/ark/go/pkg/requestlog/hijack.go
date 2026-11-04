package requestlog

import (
	"bufio"
	"io"
	"net"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
)

// Observe chi's writer rather than wrapping the raw HTTP writer: only its
// HTTP/1 writers can hijack, with optional flushing and ReaderFrom support.
func observeHijacks(w middleware.WrapResponseWriter, record *logEntry) http.ResponseWriter {
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return w
	}
	observed := &hijackWriter{WrapResponseWriter: w, hijacker: hijacker, record: record}
	flusher, ok := w.(http.Flusher)
	if !ok {
		return observed
	}
	flushed := &flushHijackWriter{hijackWriter: observed, Flusher: flusher}
	if reader, ok := w.(io.ReaderFrom); ok {
		return &readFromHijackWriter{flushHijackWriter: flushed, ReaderFrom: reader}
	}
	return flushed
}

type hijackWriter struct {
	middleware.WrapResponseWriter
	hijacker http.Hijacker
	record   *logEntry
}

// Hijack records only successful ownership transfers to the handler.
func (w *hijackWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, rw, err := w.hijacker.Hijack()
	if err == nil {
		w.record.hijacked = true
	}
	return conn, rw, err //nolint:wrapcheck // Preserve the underlying HTTP transport result.
}

type flushHijackWriter struct {
	*hijackWriter
	http.Flusher
}

type readFromHijackWriter struct {
	*flushHijackWriter
	io.ReaderFrom
}
