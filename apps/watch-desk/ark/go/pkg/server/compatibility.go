package server

import "log/slog"

// NewServer creates a new Ark server instance.
//
// Compatibility entry point. New code should use New.
func NewServer(config *Config, logger *slog.Logger) *Server {
	return New(config, logger)
}
