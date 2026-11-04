package ark

import (
	"context"
	"os"
	"os/signal"
	"syscall"
)

// RunApplicationUntilSignal restores default signal handling before draining,
// so a second interrupt can terminate an application whose shutdown is stuck.
func RunApplicationUntilSignal(options ApplicationOptions) error {
	ctx, stop := applicationSignalContext(context.Background())
	defer stop()
	return RunApplication(ctx, options)
}

func applicationSignalContext(parent context.Context) (context.Context, context.CancelFunc) {
	signalCtx, stop := signal.NotifyContext(parent, os.Interrupt, syscall.SIGTERM)
	ctx, cancel := context.WithCancel(parent)
	go func() {
		select {
		case <-signalCtx.Done():
			stop()
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, func() { stop(); cancel() }
}
