package requestlog

import (
	"net/http"

	"github.com/defenseunicorns/ark/framework/go/pkg/identity"
)

// Identity runs after identity.Middleware and records its resolved subject.
func Identity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user := identity.FromContext(r.Context()); user != nil {
			Add(r.Context(), "actor_subject", user.Subject)
		}
		next.ServeHTTP(w, r)
	})
}
