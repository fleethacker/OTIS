package storage

import (
	"fmt"
	"reflect"
)

// SetEntClient stores the ENT client for lifecycle management and typed retrieval.
// Call EntClient() to retrieve it with a type assertion in service code.
// A second registration is rejected; the caller retains ownership of that client.
func (s *Storage) SetEntClient(client any, closeFunc func() error) error {
	if nilEntClient(client) {
		return fmt.Errorf("ent client is nil")
	}
	if closeFunc == nil {
		return fmt.Errorf("ent client close function is nil")
	}
	if s.entClient != nil {
		return fmt.Errorf("ent client already registered")
	}
	s.entClient = client
	s.entClose = closeFunc
	return nil
}

// EntClient returns the raw ENT client. Cast it to your generated *ent.Client:
//
//	db := deps.App.Storage.EntClient().(*ent.Client)
func (s *Storage) EntClient() any {
	return s.entClient
}

func nilEntClient(client any) bool {
	if client == nil {
		return true
	}
	value := reflect.ValueOf(client)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return value.IsNil()
	default:
		return false
	}
}
