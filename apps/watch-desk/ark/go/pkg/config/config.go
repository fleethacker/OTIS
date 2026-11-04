// Package config provides configuration management for Ark applications using Viper
package config

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
)

// LoadFromDirectory merges config.yaml and ark_*.yaml from dirPath over defaults.
// Files merge in lexical filename order; later files override earlier keys.
// Other YAML filenames are ignored. A missing directory or no matching files
// uses defaultConfig and environment overrides. Invalid accepted files return an error.
func LoadFromDirectory[T any](dirPath string, defaultConfig T) (*T, error) {
	config := defaultConfig

	_, _, err := loadConfig(dirPath, &config)
	if err != nil {
		return nil, err
	}

	return &config, nil
}

// LoadFromFile loads configuration from a single YAML file
func LoadFromFile[T any](filePath string, defaultConfig T) (*T, error) {
	config := defaultConfig

	v, err := newConfigViper(&config)
	if err != nil {
		return nil, err
	}
	v.SetConfigFile(filePath)

	// Read the config file
	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config file %s: %w", filePath, err)
	}

	// Unmarshal into the struct
	if err := v.Unmarshal(&config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &config, nil
}

// loadConfig loads and merges configuration files from the specified directory
// This is based on the UDS Registry implementation
func loadConfig[T any](dirPath string, config *T) ([]string, []string, error) {
	v, err := newConfigViper(config)
	if err != nil {
		return nil, nil, err
	}
	v.SetConfigType("yaml")

	// Find all .yaml files in the directory
	files, err := filepath.Glob(filepath.Join(dirPath, "*.yaml"))
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list config files: %w", err)
	}

	// Load and merge each file
	for _, file := range files {
		// Skip files that don't match our naming pattern
		baseName := filepath.Base(file)
		if !strings.HasPrefix(baseName, "ark_") && baseName != "config.yaml" {
			continue
		}

		// Configure Viper for this file
		fileViper := viper.New()
		fileViper.SetConfigFile(file)

		// Read the config file
		if err := fileViper.ReadInConfig(); err != nil {
			return nil, nil, fmt.Errorf("failed to read config file %s: %w", file, err)
		}

		// Merge this file's config into our main Viper instance
		if err := v.MergeConfigMap(fileViper.AllSettings()); err != nil {
			return nil, nil, fmt.Errorf("failed to merge config file %s: %w", file, err)
		}
	}

	// Unmarshal into the provided struct
	if err := v.Unmarshal(config); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return files, v.AllKeys(), nil
}
