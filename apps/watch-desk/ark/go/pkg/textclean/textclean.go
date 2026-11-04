// Package textclean provides framework-level helpers for converting
// arbitrary upstream text (RSS feed bodies, HTML email, scraped pages)
// into clean prose suitable for surfacing in summaries, digests, and
// PRD context blocks.
//
// The motivating regression: the DougWatch build (2026-05-06) shipped
// an RSS ingester that wrote raw `<p><a href="..."><img srcset=...>`
// markup into article summaries because nothing in its pipeline
// stripped HTML before persist. Multiple design-review findings
// flagged the leak as a HIGH-severity trust break — leadership saw
// plumbing on the page they were supposed to read.
//
// Generated apps that ingest from upstream sources should run that
// content through StripHTML before persisting it to ENT or feeding it
// to a summarizer. Centralising the helper here means: one
// implementation, one set of edge cases (entity decoding, whitespace
// collapsing, HTML5 self-closing tags), and one thing to test.
package textclean

import (
	"html"
	"regexp"
	"strings"
)

// htmlTagPattern matches an HTML tag — `<...>` with anything inside
// except a close-bracket. Doesn't try to validate; we want a permissive
// stripper that handles malformed feeds (unclosed tags, smart quotes,
// embedded scripts) by treating them all as "remove the markup."
//
// Compiled once at package init; reused on every StripHTML call.
var htmlTagPattern = regexp.MustCompile(`<[^>]*>`)

// cdataPattern matches XML CDATA sections — common in RSS/Atom feeds
// where item descriptions are wrapped to defer entity decoding to the
// consumer. Match the wrappers (case-insensitive) and replace with the
// inner content so the subsequent HTML strip can act on whatever the
// publisher embedded. Without this, the `<![CDATA[` opener is gobbled
// by htmlTagPattern up to the first `>` inside the content, the closer
// `]]>` is left visible as bare punctuation, and the result reads as
// trailing noise on every digest card.
//
// (?is) — case-insensitive (CDATA is by spec uppercase but feeds are
// often lower or mixed) and dot-matches-newline (CDATA bodies span
// lines). Non-greedy so two adjacent CDATA sections don't merge.
var cdataPattern = regexp.MustCompile(`(?is)<!\[CDATA\[(.*?)]]>`)

// scriptPattern / stylePattern match the body content of <script>
// and <style> blocks so we can drop them entirely, not just unwrap
// the tag. Without these, stripping the tags around a script body
// would leave naked JS in the prose ("var x = 1;"), which reads
// worse than the original markup did.
//
// Two separate patterns rather than one alternated regex with a
// backreference because Go's regexp/regexp (RE2) doesn't support
// backreferences. RE2 guarantees linear-time matching at the cost
// of \1; the duplication is the price.
//
// Case-insensitive; non-greedy; tolerates attributes on the open
// tag (`<script type="text/javascript">`).
var (
	scriptPattern = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	stylePattern  = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
)

// whitespaceRunPattern collapses runs of whitespace (including
// newlines that came from stripped <br> / </p>) into a single space
// so the output reads as continuous prose.
var whitespaceRunPattern = regexp.MustCompile(`\s+`)

// StripHTML returns input with HTML tags removed, HTML entities
// decoded, and whitespace runs collapsed to single spaces. Designed
// for converting arbitrary feed-shaped text into clean prose.
//
// The order of operations is load-bearing:
//
//  1. Drop <script> and <style> bodies entirely — their content is
//     never user-facing copy and would otherwise leak as bare code.
//  2. Strip remaining tags. Self-closing, malformed, and unclosed
//     tags all match the permissive `<[^>]*>` regex.
//  3. Decode HTML entities (`&amp;` → `&`, `&nbsp;` → " ", etc.) AFTER
//     tag stripping. Doing this before would mishandle entity-encoded
//     angle brackets in source text (`&lt;script&gt;`) — they'd be
//     decoded to `<script>` and then stripped by step 2.
//  4. Collapse whitespace runs to a single space and trim ends.
//
// Returns the empty string for empty input. Never returns an error;
// the operation is total over arbitrary bytes.
func StripHTML(input string) string {
	if input == "" {
		return ""
	}

	// Replace script/style bodies with a space (not empty) so the
	// surrounding text doesn't smash together when the block sat
	// inline with other prose.
	out := scriptPattern.ReplaceAllString(input, " ")
	out = stylePattern.ReplaceAllString(out, " ")
	// Unwrap CDATA sections so their inner content is processed by
	// the HTML strip below — many RSS feeds wrap description bodies
	// in CDATA to defer entity decoding.
	out = cdataPattern.ReplaceAllString(out, "$1")
	out = htmlTagPattern.ReplaceAllString(out, " ")
	out = html.UnescapeString(out)
	// Normalize NBSP (U+00A0, the decode of `&nbsp;`) to a regular
	// space before whitespace collapsing. Card and tooltip surfaces
	// render NBSP indistinguishably from a normal space, but copy/
	// paste and downstream regex-based summarizers treat them as
	// distinct codepoints and trip on it. Convert at the boundary
	// so consumers see clean text.
	out = strings.ReplaceAll(out, " ", " ")
	out = whitespaceRunPattern.ReplaceAllString(out, " ")
	return strings.TrimSpace(out)
}

// StripHTMLBlock is StripHTML with paragraph boundaries preserved.
// Where StripHTML produces a single line, StripHTMLBlock leaves a
// double-newline anywhere the original input had a closing block
// element (</p>, </div>, <br><br>, etc.) so multi-paragraph source
// content stays readable in surfaces that respect paragraph breaks
// (markdown bodies, agent prompts).
//
// The output is markdown-safe: no remaining tags, no entity-encoded
// punctuation, paragraphs separated by blank lines, single spaces
// inside paragraphs.
func StripHTMLBlock(input string) string {
	if input == "" {
		return ""
	}

	// Drop script/style first as in StripHTML. Replace with a space
	// so adjoining prose doesn't smash together when the block sat
	// inline.
	out := scriptPattern.ReplaceAllString(input, " ")
	out = stylePattern.ReplaceAllString(out, " ")
	// Unwrap CDATA sections so their inner content participates in
	// the paragraph + tag-strip pipeline below.
	out = cdataPattern.ReplaceAllString(out, "$1")
	// Mark paragraph boundaries with a sentinel that survives the
	// generic tag strip. Using \x00 (NUL) as the sentinel because no
	// reasonable feed body contains it.
	const para = "\x00\x00"
	out = paragraphBreakPattern.ReplaceAllString(out, para)
	// Strip remaining tags.
	out = htmlTagPattern.ReplaceAllString(out, " ")
	// Decode entities.
	out = html.UnescapeString(out)
	// Normalize NBSP (U+00A0) to a regular space, same rationale as
	// in StripHTML — downstream consumers treat the codepoints as
	// distinct and trip on it.
	out = strings.ReplaceAll(out, " ", " ")
	// Restore paragraph breaks. Collapse intra-paragraph whitespace
	// without touching the sentinel.
	parts := strings.Split(out, para)
	for i, p := range parts {
		parts[i] = strings.TrimSpace(whitespaceRunPattern.ReplaceAllString(p, " "))
	}
	// Drop empty paragraphs (back-to-back closers in the source).
	cleaned := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			cleaned = append(cleaned, p)
		}
	}
	return strings.Join(cleaned, "\n\n")
}

// paragraphBreakPattern matches the closing-block elements that
// should produce a paragraph boundary in StripHTMLBlock output.
// </p> and </div> are the common ones; <br><br> is a legacy email
// idiom for paragraph breaks; <br/>+ is its self-closing variant.
//
// Order matters: more specific patterns first so the alternation
// shorter-circuits correctly (regexp/regexp uses leftmost-first
// matching — equivalent here, but spelling it out is clearer).
var paragraphBreakPattern = regexp.MustCompile(
	`(?i)</(?:p|div|li|h[1-6])\s*>|<br\s*/?>\s*<br\s*/?>`)
