package identity

import (
	_ "embed"
	"encoding/json"
	"html/template"
	"log/slog"
	"net/http"
	"sort"
)

//go:embed mocklogin.html
var mockLoginHTML string

// mockLoginTmpl renders the dev login page. Parsed once at package init;
// html/template handles all escaping for us.
var mockLoginTmpl = template.Must(template.New("mocklogin").Parse(mockLoginHTML))

// mockLoginSuccessTmpl is served after a successful POST. It postMessages
// both the parent frame (so the Ark wizard's preview chrome can update
// its active-role display) AND its own window (so the app running inside
// this frame — which is where useIdentity() listens — invalidates its
// Connect-Query identity cache and refetches). Without the own-window
// postMessage, UserMenu keeps displaying "Sign in" until the user hard-
// refreshes, because Connect-Query has no signal to refetch. html/template's
// JS context escaping keeps it safe even with attacker-controlled role
// strings — role is also validated against cfg.Roles before we get here.
var mockLoginSuccessTmpl = template.Must(template.New("mockLoginSuccess").Parse(
	`<!doctype html><html><body><script>
try { window.postMessage({{.Payload}}, '*'); } catch (e) {}
try { if (window.parent !== window) window.parent.postMessage({{.Payload}}, '*'); } catch (e) {}
window.location.replace({{.Return}});
</script></body></html>`))

// roleCard is a template-friendly view of a role for the login page.
type roleCard struct {
	Name        string
	Username    string
	Email       string
	Groups      []string
	Description string
	IsActive    bool
}

type mockLoginData struct {
	Roles  []roleCard
	Return string
}

type mockLoginSuccess struct {
	Payload map[string]string
	Return  string
}

// handleMockLogin renders the picker on GET and sets the session cookie on
// POST. POST always emits the tiny postMessage-then-redirect document so
// the wizard's preview chrome stays in sync with in-app switches too.
func handleMockLogin(w http.ResponseWriter, r *http.Request, cfg *RoleConfig) {
	switch r.Method {
	case http.MethodGet:
		renderLoginPage(w, r, cfg)
	case http.MethodPost:
		handleLoginPost(w, r, cfg)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func renderLoginPage(w http.ResponseWriter, r *http.Request, cfg *RoleConfig) {
	returnTo := cleanReturnPath(r.URL.Query().Get("return"))
	active := readSessionCookie(r)

	data := mockLoginData{ // arkstub:allow — view model for the dev mock-login page (/__ark/mock-login); dev/preview only, prod auth is UDS/Keycloak at ingress.
		Roles:  roleCards(cfg, active),
		Return: returnTo,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := mockLoginTmpl.Execute(w, data); err != nil {
		slog.Error("identity: render mock login", "error", err)
	}
}

func handleLoginPost(w http.ResponseWriter, r *http.Request, cfg *RoleConfig) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)

		return
	}
	role := r.FormValue("role")
	if _, ok := cfg.Roles[role]; !ok {
		http.Error(w, "unknown role", http.StatusBadRequest)

		return
	}

	returnTo := cleanReturnPath(r.FormValue("return"))
	setSessionCookie(w, role)
	writeLoginSuccess(w, role, returnTo)
}

// writeLoginSuccess emits a small HTML doc that notifies the parent frame
// (if any) and navigates the iframe to the return path.
func writeLoginSuccess(w http.ResponseWriter, role, returnTo string) {
	data := mockLoginSuccess{ // arkstub:allow — view model for the dev mock-login success page; dev/preview only, prod auth is UDS/Keycloak at ingress.
		Payload: map[string]string{
			"type": "ark-auth-changed",
			"role": role,
		},
		Return: returnTo,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := mockLoginSuccessTmpl.Execute(w, data); err != nil {
		slog.Error("identity: render mock login success", "error", err)
	}
}

// handleMockLogout clears the ark_session cookie and redirects to the
// mock login page so the user can pick again.
func handleMockLogout(w http.ResponseWriter, r *http.Request) {
	clearSessionCookie(w)
	http.Redirect(w, r, mockLoginPath, http.StatusFound)
}

// handleMockRoles returns the configured roles as JSON. The Ark wizard's
// preview chrome uses this to render a fallback role picker when the
// in-app RoleSwitcher isn't visible yet.
func handleMockRoles(w http.ResponseWriter, r *http.Request, cfg *RoleConfig) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		return
	}

	resp := struct {
		Roles  []roleCard `json:"roles"`
		Active string     `json:"active"`
	}{
		Roles:  roleCards(cfg, readSessionCookie(r)),
		Active: readSessionCookie(r),
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("identity: encode mock roles", "error", err)
	}
}

// handleMockWhoami returns the resolved application identity as JSON,
// or 401 if no session. Lightweight query for UI indicators that want to
// display "Preview as: admin" without going through a full RPC.
func handleMockWhoami(w http.ResponseWriter, r *http.Request, cfg *RoleConfig) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		return
	}

	name := readSessionCookie(r)
	if name == "" {
		// No cookie: auto-login as EnvMockAuthAs's role if set (journey tests),
		// else 401 so the preview routes to the role picker.
		name = mockAutoLoginRole(cfg)
	}
	if name == "" {
		http.Error(w, "not authenticated", http.StatusUnauthorized)

		return
	}
	role, ok := cfg.Roles[name]
	if !ok {
		http.Error(w, "unknown role", http.StatusUnauthorized)

		return
	}

	// Use the same token and group resolution as application requests. A mock
	// role's groups can resolve to a different, higher-priority application role.
	setMockBearer(r, role)
	id := identityFromBearer(r, cfg)
	if id == nil {
		http.Error(w, "identity unavailable", http.StatusUnauthorized)

		return
	}
	resp := struct {
		Role     string   `json:"role"`
		Name     string   `json:"name"`
		Username string   `json:"username"`
		Email    string   `json:"email"`
		Groups   []string `json:"groups"`
	}{
		Role:     id.Role,
		Name:     id.Name,
		Username: id.Username,
		Email:    id.Email,
		Groups:   id.Groups,
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("identity: encode mock whoami", "error", err)
	}
}

// roleCards renders every configured role as a template-friendly struct.
// Sorted by priority desc, then name, so the highest-privileged roles show
// first — usually what a developer wants when smoke-testing.
func roleCards(cfg *RoleConfig, active string) []roleCard {
	cards := make([]roleCard, 0, len(cfg.Roles))
	for _, name := range cfg.RoleNames() {
		def := cfg.Roles[name]
		cards = append(cards, roleCard{
			Name:        name,
			Username:    def.Mock.Username,
			Email:       def.Mock.Email,
			Groups:      def.Groups,
			Description: def.Description,
			IsActive:    name == active,
		})
	}
	sort.SliceStable(cards, func(i, j int) bool {
		pi := cfg.Roles[cards[i].Name].Priority
		pj := cfg.Roles[cards[j].Name].Priority
		if pi != pj {
			return pi > pj
		}

		return cards[i].Name < cards[j].Name
	})

	return cards
}
