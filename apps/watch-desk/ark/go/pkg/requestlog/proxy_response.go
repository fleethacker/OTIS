package requestlog

import (
	"errors"
	"io"
	"net/http"
)

// ProxyResponse observes upstream read failures after headers have been sent,
// which ReverseProxy does not deliver to its ErrorHandler. Upgrade bodies must
// keep their ReadWriteCloser interface for bidirectional forwarding.
func ProxyResponse(response *http.Response) error {
	if response.StatusCode != http.StatusSwitchingProtocols && response.Body != nil && response.Request != nil {
		response.Body = &proxyBody{ReadCloser: response.Body, request: response.Request}
	}
	return nil
}

type proxyBody struct {
	io.ReadCloser
	request *http.Request
	failed  bool
}

func (b *proxyBody) Read(buffer []byte) (int, error) {
	n, err := b.ReadCloser.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) && !b.failed {
		b.failed = true
		ProxyError(b.request.Context(), err, "upstream_host", b.request.URL.Host)
	}
	return n, err //nolint:wrapcheck // ReverseProxy needs the original EOF and cancellation errors.
}
