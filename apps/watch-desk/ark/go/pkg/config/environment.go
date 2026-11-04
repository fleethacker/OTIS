package config

import (
	"fmt"
	"reflect"
	"slices"
	"strings"

	"github.com/spf13/viper"
)

func newConfigViper(config any) (*viper.Viper, error) {
	v := viper.New()
	v.SetEnvPrefix("Ark")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// Discover keys from types without converting defaults to a map. The normal
	// decoder owns pointer allocation, including nil squashed struct pointers.
	if err := bindStructEnv(v, reflect.TypeOf(config), "", map[reflect.Type]bool{}); err != nil {
		return nil, err
	}
	return v, nil
}

func bindStructEnv(v *viper.Viper, typ reflect.Type, prefix string, ancestors map[reflect.Type]bool) error {
	typ = indirectType(typ)
	if typ.Kind() != reflect.Struct || ancestors[typ] {
		return nil
	}
	ancestors[typ] = true
	defer delete(ancestors, typ)

	for field := range typ.Fields() {
		tag := strings.Split(field.Tag.Get("mapstructure"), ",")
		if field.PkgPath != "" || tag[0] == "-" || slices.Contains(tag[1:], "remain") {
			continue
		}
		name := tag[0]
		if name == "" {
			name = field.Name
		}
		key := name
		if prefix != "" {
			key = prefix + "." + name
		}
		if slices.Contains(tag[1:], "squash") {
			key = prefix
		}
		if indirectType(field.Type).Kind() == reflect.Struct {
			if err := bindStructEnv(v, field.Type, key, ancestors); err != nil {
				return err
			}
			continue
		}
		if err := v.BindEnv(key); err != nil {
			return fmt.Errorf("bind config environment key %q: %w", key, err)
		}
	}
	return nil
}

func indirectType(typ reflect.Type) reflect.Type {
	seen := map[reflect.Type]bool{}
	for typ.Kind() == reflect.Pointer && !seen[typ] {
		seen[typ] = true
		typ = typ.Elem()
	}
	return typ
}
