// Copyright 2026 Defense Unicorns
// SPDX-License-Identifier: LicenseRef-Defense-Unicorns-Commercial

package storage

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Only an unfinished stop retains database connections; startup failures do not.
var errQueueShutdownIncomplete = errors.New("queue shutdown incomplete")

// Publishing an enqueue client while River.Start is initializing producers can
// race TriggerJobFetch. Keep HTTP startup asynchronous, but gate operations that
// touch those producers on completed startup (including its failure result).
type queueStartup struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	err    error
	once   sync.Once
}

func newQueueStartup(ctx context.Context) *queueStartup {
	ctx, cancel := context.WithCancel(ctx)
	return &queueStartup{ctx: ctx, cancel: cancel, done: make(chan struct{})}
}

func (s *queueStartup) start(ctx context.Context, start func(context.Context) error) error {
	s.once.Do(func() {
		if s.ctx != nil {
			ctx = s.ctx
		}
		s.err = start(ctx)
		close(s.done)
	})

	return s.err
}

func (s *queueStartup) wait(ctx context.Context) error {
	if s == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return fmt.Errorf("wait for queue startup: %w", ctx.Err())
	case <-s.done:
		if s.err != nil {
			return fmt.Errorf("queue startup failed: %w", s.err)
		}

		return nil
	}
}

// stop cancels unfinished startup before draining, then escalates a timed-out
// graceful stop. The hard-stop budget is independent of the expired drain.
func (s *queueStartup) stop(ctx context.Context, graceful, hard func(context.Context) error) error {
	if s != nil {
		defer s.cancel()
		started, err := s.stopStartup(ctx)
		if err != nil || !started {
			return err
		}
	}
	if err := graceful(ctx); err != nil {
		if ctx.Err() == nil {
			return fmt.Errorf("%w: %w", errQueueShutdownIncomplete, err)
		}
		if s != nil {
			s.cancel()
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if cleanupErr := hard(cleanupCtx); cleanupErr != nil {
			return fmt.Errorf("%w: hard stop queue: %w", errQueueShutdownIncomplete, errors.Join(err, cleanupErr))
		}
	}
	return nil
}

// River.Start joins its own cleanup before returning an error. A completed
// startup failure can be reported without preventing database teardown.
func (s *queueStartup) stopStartup(ctx context.Context) (bool, error) {
	select {
	case <-s.done:
	default:
		s.cancel()
	}
	if err := s.wait(ctx); err != nil {
		select {
		case <-s.done:
			if s.err != nil {
				if errors.Is(s.err, context.Canceled) {
					return false, nil
				}
				return false, fmt.Errorf("queue startup failed: %w", s.err)
			}
		default:
		}
		return false, fmt.Errorf("%w: %w", errQueueShutdownIncomplete, err)
	}
	return true, nil
}
