// Command healthcheck probes the application without a shell in the runtime image.
package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"
)

func main() {
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://127.0.0.1:8080/api/health")
	if err != nil {
		os.Exit(1)
	}
	defer response.Body.Close()
	var health struct {
		Status string `json:"status"`
	}
	if response.StatusCode != http.StatusOK ||
		json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&health) != nil ||
		health.Status != "healthy" {
		os.Exit(1)
	}
}
