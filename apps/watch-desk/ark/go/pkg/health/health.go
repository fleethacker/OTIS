// Package health provides basic health and status endpoints for Ark applications
package health

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/go-chi/chi/v5"
)

// Service provides health and application info endpoints
type Service struct {
	AppName   string
	Version   string
	BuildTime string
	StartTime time.Time
}

// NewService creates a new health service
func NewService(appName, version string) *Service {
	return &Service{
		AppName:   appName,
		Version:   version,
		BuildTime: time.Now().Format(time.RFC3339),
		StartTime: time.Now(),
	}
}

// RegisterRoutes adds health endpoints to the router
func (s *Service) RegisterRoutes(r *chi.Mux) {
	r.Get("/api/health", s.handleHealth)
	r.Get("/api/info", s.handleInfo)
}

// Health represents the application health status
type Health struct {
	Status     string            `json:"status"`
	Timestamp  int64             `json:"timestamp"`
	Uptime     string            `json:"uptime"`
	Components []ComponentHealth `json:"components"`
}

// ComponentHealth represents individual component health
type ComponentHealth struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// Info represents basic application information
type Info struct {
	Name        string            `json:"name"`
	Version     string            `json:"version"`
	BuildTime   string            `json:"buildTime"`
	Uptime      string            `json:"uptime"`
	GoVersion   string            `json:"goVersion"`
	Environment map[string]string `json:"environment"`
}

func (s *Service) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	components := []ComponentHealth{
		{
			Name:    "server",
			Status:  "healthy",
			Message: "HTTP server running",
		},
	}

	overallStatus := "healthy"

	health := Health{
		Status:     overallStatus,
		Timestamp:  time.Now().Unix(),
		Uptime:     time.Since(s.StartTime).String(),
		Components: components,
	}

	// Set appropriate HTTP status code
	if overallStatus != "healthy" {
		w.WriteHeader(http.StatusServiceUnavailable)
	}

	if err := json.NewEncoder(w).Encode(health); err != nil {
		// Log error but don't write to response as headers are already sent
		fmt.Printf("Error encoding health response: %v\n", err)
	}
}

func (s *Service) handleInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	info := Info{
		Name:      s.AppName,
		Version:   s.Version,
		BuildTime: s.BuildTime,
		Uptime:    time.Since(s.StartTime).String(),
		GoVersion: runtime.Version(),
		Environment: map[string]string{
			"framework": "Ark",
			"runtime":   "go",
		},
	}

	if err := json.NewEncoder(w).Encode(info); err != nil {
		// Log error but don't write to response as headers are already sent
		fmt.Printf("Error encoding info response: %v\n", err)
	}
}
