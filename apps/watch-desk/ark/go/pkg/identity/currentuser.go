package identity

import (
	"encoding/json"
	"net/http"
)

// CurrentUserPath is the shared UI identity endpoint. It projects only display
// claims from the identity already verified by the environment's auth boundary;
// the stable subject remains server-side ownership data.
const CurrentUserPath = "/api/identity"

// CurrentUserHandler returns the current verified identity for persistent app
// chrome. It is intentionally read-only and non-cacheable: desktop resolves a
// local mock token while hosted Ark resolves the mesh-validated Keycloak token
// through the same middleware and response shape.
func CurrentUserHandler(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", http.MethodGet)
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)

		return
	}
	user := FromContext(request.Context())
	if user == nil || user.Subject == "" {
		http.Error(response, "not authenticated", http.StatusUnauthorized)

		return
	}
	current := struct {
		Name     string   `json:"name"`
		Username string   `json:"username"`
		Email    string   `json:"email"`
		Role     string   `json:"role"`
		Groups   []string `json:"groups"`
	}{
		Name:     user.Name,
		Username: user.Username,
		Email:    user.Email,
		Role:     user.Role,
		Groups:   user.Groups,
	}
	response.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(response).Encode(current); err != nil {
		return
	}
}
