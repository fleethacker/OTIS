package requestlog

import (
	"fmt"
	"runtime"
	"strings"
)

// sourceStack retains the active panic's code locations without dumping
// by-value function arguments, which can contain request data or credentials.
func sourceStack() string {
	var pcs [64]uintptr
	count := runtime.Callers(2, pcs[:])
	frames := runtime.CallersFrames(pcs[:count])
	var stack strings.Builder
	for {
		frame, more := frames.Next()
		fmt.Fprintf(&stack, "%s\n\t%s:%d\n", frame.Function, frame.File, frame.Line)
		if !more {
			break
		}
	}
	return stack.String()
}
