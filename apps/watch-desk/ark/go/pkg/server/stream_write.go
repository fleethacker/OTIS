package server

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// StreamWriteTimeout bounds blocked RPC writes while leaving healthy streams open.
// Match transport content types so HTTP downloads and WebSocket upgrades retain
// their original response writer and lifetime policies.
func StreamWriteTimeout(timeout time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mediaType, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";")
			mediaType = strings.ToLower(strings.TrimSpace(mediaType))
			if timeout > 0 && (strings.HasPrefix(mediaType, "application/connect+") ||
				mediaType == "application/grpc" || strings.HasPrefix(mediaType, "application/grpc+") ||
				mediaType == "application/grpc-web" || strings.HasPrefix(mediaType, "application/grpc-web+")) {
				w = &streamWriter{ResponseWriter: w, controller: http.NewResponseController(w), timeout: timeout}
			}
			next.ServeHTTP(w, r)
		})
	}
}

type streamWriter struct {
	http.ResponseWriter
	controller *http.ResponseController
	timeout    time.Duration
}

func (w *streamWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *streamWriter) Write(body []byte) (int, error) {
	if err := w.controller.SetWriteDeadline(time.Now().Add(w.timeout)); err != nil {
		return 0, fmt.Errorf("set RPC stream write deadline: %w", err)
	}
	defer w.clearDeadline()
	n, err := w.ResponseWriter.Write(body)
	if err != nil {
		return n, fmt.Errorf("write RPC stream: %w", err)
	}
	return n, nil
}

// Flush implements http.Flusher for Connect streaming responses.
func (w *streamWriter) Flush() {
	_ = w.FlushError() //nolint:errcheck // http.Flusher has no error result.
}

// FlushError supplies the error-returning http.ResponseController contract.
func (w *streamWriter) FlushError() error {
	if err := w.controller.SetWriteDeadline(time.Now().Add(w.timeout)); err != nil {
		return fmt.Errorf("set RPC stream flush deadline: %w", err)
	}
	defer w.clearDeadline()
	if err := w.controller.Flush(); err != nil {
		return fmt.Errorf("flush RPC stream: %w", err)
	}
	return nil
}

func (w *streamWriter) clearDeadline() {
	_ = w.controller.SetWriteDeadline(time.Time{}) //nolint:errcheck // Best effort after delivery or a transport failure.
}
