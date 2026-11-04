// Package readiness defines the private startup handshake between Ark and a
// copied framework server. It announces a bound listener, not application health.
package readiness

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
)

// Protocol constants are shared by the framework producer and Ark consumer.
const (
	Version        = 1
	DescriptorEnv  = "ARK_SERVER_READY_FD"
	MaxRecordBytes = 256
)

// Record contains only a port: the parent always dials loopback itself.
type Record struct {
	Version int `json:"version"`
	Port    int `json:"port"`
}

// Open inherits a dedicated pipe. Normal serving has no startup handshake.
func Open() (*os.File, error) {
	value := os.Getenv(DescriptorEnv)
	if value == "" {
		return nil, nil
	}
	fd, err := strconv.Atoi(value)
	if err != nil || fd < 3 {
		return nil, fmt.Errorf("invalid readiness descriptor")
	}
	pipe := os.NewFile(uintptr(fd), "ark-readiness")
	if pipe == nil {
		return nil, fmt.Errorf("readiness descriptor unavailable")
	}
	info, err := pipe.Stat()
	if err != nil || info.Mode()&(os.ModeNamedPipe|os.ModeSocket) == 0 {
		_ = pipe.Close() //nolint:errcheck // release an invalid inherited descriptor before returning the validation error.

		return nil, fmt.Errorf("readiness descriptor must be an inherited stream")
	}

	return pipe, nil
}

// Report is called only after routes are registered and the listener is bound.
func Report(writer io.Writer, address net.Addr) error {
	tcp, ok := address.(*net.TCPAddr)
	if !ok || !tcp.IP.IsLoopback() || tcp.Port < 1 || tcp.Port > 65535 {
		return fmt.Errorf("readiness requires an assigned loopback TCP port")
	}
	if err := json.NewEncoder(writer).Encode(Record{Version: Version, Port: tcp.Port}); err != nil {
		return fmt.Errorf("report bound listener: %w", err)
	}

	return nil
}

// Read accepts exactly one bounded, versioned listener announcement.
func Read(reader io.Reader) (Record, error) {
	record, err := bufio.NewReader(io.LimitReader(reader, MaxRecordBytes+1)).ReadBytes('\n')
	if err != nil || len(record) > MaxRecordBytes {
		return Record{}, fmt.Errorf("missing or oversized framework readiness record")
	}
	var message Record
	decoder := json.NewDecoder(bytes.NewReader(record))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&message); err != nil {
		return Record{}, fmt.Errorf("invalid framework readiness record: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return Record{}, fmt.Errorf("unexpected data after readiness record")
	}
	if message.Version != Version || message.Port < 1 || message.Port > 65535 {
		return Record{}, fmt.Errorf("unsupported framework readiness version or port")
	}

	return message, nil
}
