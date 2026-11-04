package connectrpc

import "connectrpc.com/connect"

// DefaultRequestMaxBytes bounds decoded RPC messages, including gzip payloads.
// Allow the 64 MiB retained-source budget plus 16 MiB for request metadata,
// contextual input, and serialization overhead. Domain limits still apply.
const DefaultRequestMaxBytes = 80 << 20

// HandlerOptions supplies the shared request limit and service interceptors.
// Register application handlers with these options so decoding is bounded
// before validation and domain handlers run. Responses and stream lifetimes
// are not limited by this per-message request bound.
func HandlerOptions(interceptors ...connect.Interceptor) []connect.HandlerOption {
	return []connect.HandlerOption{
		connect.WithReadMaxBytes(DefaultRequestMaxBytes),
		connect.WithInterceptors(interceptors...),
	}
}
