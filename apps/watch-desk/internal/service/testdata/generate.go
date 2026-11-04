//go:build ignore

// Generate the attributed fixture from the immutable bound manifest:
// go run internal/service/testdata/generate.go
package main

import (
	"encoding/json"
	"os"
)

func main() {
	data, err := os.ReadFile(".ark/story-files/24/sources.json")
	if err != nil {
		panic(err)
	}
	var sources []struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Purpose string `json:"purpose"`
		Text    string `json:"text"`
	}
	if err := json.Unmarshal(data, &sources); err != nil {
		panic(err)
	}
	if len(sources) != 14 {
		panic("expected all 14 references")
	}
	// Retain text as a string, never decode/re-encode the supplied JSON body.
	output, err := json.MarshalIndent(sources, "", "  ")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile("internal/service/testdata/structured-messages.json", append(output, '\n'), 0644); err != nil {
		panic(err)
	}
}
