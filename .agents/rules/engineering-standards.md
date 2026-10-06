# Workspace Senior Engineering Directives

## 1. Implementation Integrity
- Every code change must be production-ready and fully written out with zero placeholders (`TODO`, `stub`).
- Maintain existing architecture patterns (Fastify, TypeScript, Zod, Supabase/SQLite fallback, Flutter Riverpod).
- Automatically verify changes with `npm run typecheck` or relevant unit tests.

## 2. Defensive Engineering & Resilience
- Never expose sensitive tokens, webhook secrets, or API keys in git-tracked files.
- Always include robust try/catch blocks, error logging, and graceful fallbacks for third-party network APIs (bKash/Nagad/Rocket SMS parsers, webhooks).

## 3. Communication Cadence
- Direct, actionable code and commands.
- High-level prompt alignment first, direct execution immediately following.
- Zero unsolicited client reports unless explicitly demanded.
