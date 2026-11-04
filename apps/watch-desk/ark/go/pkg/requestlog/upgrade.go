package requestlog

import (
	"net/http"
	"strings"
)

func isWebSocketUpgrade(header http.Header) bool {
	if !strings.EqualFold(header.Get("Upgrade"), "websocket") {
		return false
	}
	for _, value := range header.Values("Connection") {
		for token := range strings.SplitSeq(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
				return true
			}
		}
	}
	return false
}
