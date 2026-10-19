import { describe, it, expect } from 'vitest';
import { matchFunctionSql } from '../../src/infrastructure/adapters/supabase/memory-vector-sql.js';

/**
 * No Postgres in the suite, so this pins the shape that makes the filters
 * correct. Measured on a live Supabase instance with the previous single-query
 * function: `filter_kinds = {persona}` returned 0 rows of 23, `{deliverable}`
 * 13 of 200 — an HNSW scan takes the nearest neighbours of the whole table and
 * filters them afterwards.
 */
describe('match_memory_chunks', () => {
  const sql = matchFunctionSql(384);
  const body = sql.slice(sql.indexOf('IF filter_kinds IS NULL'));
  const [unfiltered, filtered] = body.split(/\bELSE\b/);

  it('filters by kind, repo or board before ordering, so a sparse kind is never cut', () => {
    expect(sql).toMatch(/IF filter_kinds IS NULL AND filter_repo IS NULL AND filter_board_id IS NULL THEN/);
    expect(filtered).toMatch(/WITH scoped AS MATERIALIZED \(/);
    expect(filtered).toMatch(/m\.source_kind = ANY\(filter_kinds\)/);
    expect(filtered).toMatch(/m\.repo = filter_repo/);
    expect(filtered).toMatch(/ORDER BY s\.embedding <=> query_embedding/);
  });

  it('keeps the HNSW path for an unfiltered search, still honouring model and exclusion', () => {
    expect(unfiltered).toMatch(/ORDER BY m\.embedding <=> query_embedding/);
    // Only the IF condition mentions them: no structural predicate inside the query.
    expect(unfiltered.slice(unfiltered.indexOf('RETURN QUERY'))).not.toMatch(/filter_kinds|filter_repo|filter_board_id/);
    expect(unfiltered).toMatch(/m\.embedding_model = filter_model/);
    expect(unfiltered).toMatch(/m\.ticket_id <> exclude_ticket_id/);
  });

  it('keeps the signature, so CREATE OR REPLACE replaces instead of overloading', () => {
    expect(sql).toContain('query_embedding vector(384)');
    expect(sql).toMatch(/filter_kinds text\[\] DEFAULT NULL,\s+filter_repo text DEFAULT NULL,\s+filter_board_id text DEFAULT NULL,\s+exclude_ticket_id text DEFAULT NULL,\s+filter_model text DEFAULT NULL/);
  });
});
