import { sql } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { AiKnowledgeSource, AiSourceType } from "@shared/aiAssistant";
import {
  AI_KNOWLEDGE_MAX_CHARS,
  AI_KNOWLEDGE_MAX_SOURCES,
  AI_SOURCE_MAX_CHARS,
} from "@shared/aiAssistant";
import { db } from "./db";

export type AiKnowledgeTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
type Executor = NodePgDatabase<typeof schema> | AiKnowledgeTransaction;

type SourceRow = {
  id: string;
  webinar_id: string;
  title: string;
  content: string;
  source_type: AiSourceType;
  source_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class AiKnowledgeQuotaError extends Error {
  status = 409;
}

function source(row: SourceRow): AiKnowledgeSource {
  return {
    id: row.id,
    webinarId: row.webinar_id,
    title: row.title,
    content: row.content,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function validateContent(content: string) {
  if (!content.trim()) throw new Error("內容不得為空白");
  if (content.length > AI_SOURCE_MAX_CHARS) {
    throw new AiKnowledgeQuotaError(`單一來源不得超過 ${AI_SOURCE_MAX_CHARS} 字元`);
  }
}

function validateTitle(title: string) {
  if (!title.trim()) throw new Error("標題不得為空白");
  if (title.length > 200) throw new Error("標題不得超過 200 字元");
}

async function lockAndCheck(executor: Executor, webinarId: string, nextLength: number, replacedLength?: number) {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${webinarId}))`);
  const result = await executor.execute(sql`
    SELECT count(*)::int AS count, COALESCE(sum(length(content)), 0)::int AS chars
      FROM webinar_documents
     WHERE webinar_id = ${webinarId}
  `);
  const totals = result.rows[0] as { count: number; chars: number };
  if (replacedLength === undefined && totals.count >= AI_KNOWLEDGE_MAX_SOURCES) {
    throw new AiKnowledgeQuotaError(`每場說明會最多 ${AI_KNOWLEDGE_MAX_SOURCES} 個知識來源`);
  }
  if (totals.chars - (replacedLength ?? 0) + nextLength > AI_KNOWLEDGE_MAX_CHARS) {
    throw new AiKnowledgeQuotaError(`知識庫總內容不得超過 ${AI_KNOWLEDGE_MAX_CHARS} 字元`);
  }
}

export async function listKnowledgeSources(webinarId: string): Promise<AiKnowledgeSource[]> {
  const result = await db.execute(sql`
    SELECT id, webinar_id, title, content, source_type, source_url, created_at, updated_at
      FROM webinar_documents
     WHERE webinar_id = ${webinarId}
     ORDER BY created_at ASC
  `);
  return (result.rows as SourceRow[]).map(source);
}

export async function getKnowledgeSource(webinarId: string, documentId: string): Promise<AiKnowledgeSource | undefined> {
  const result = await db.execute(sql`
    SELECT id, webinar_id, title, content, source_type, source_url, created_at, updated_at
      FROM webinar_documents
     WHERE webinar_id = ${webinarId} AND id = ${documentId}
     LIMIT 1
  `);
  return result.rows[0] ? source(result.rows[0] as SourceRow) : undefined;
}

export async function createKnowledgeSource(input: {
  webinarId: string;
  title: string;
  content: string;
  sourceType: AiSourceType;
  sourceUrl?: string | null;
}): Promise<AiKnowledgeSource> {
  validateTitle(input.title);
  validateContent(input.content);
  return db.transaction(async tx => {
    await lockAndCheck(tx, input.webinarId, input.content.length);
    const result = await tx.execute(sql`
      INSERT INTO webinar_documents (webinar_id, title, content, source_type, source_url, created_at, updated_at)
      VALUES (${input.webinarId}, ${input.title}, ${input.content}, ${input.sourceType}, ${input.sourceUrl ?? null}, now(), now())
      RETURNING id, webinar_id, title, content, source_type, source_url, created_at, updated_at
    `);
    return source(result.rows[0] as SourceRow);
  });
}

export async function updateKnowledgeSource(
  webinarId: string,
  documentId: string,
  patch: { title?: string; content?: string },
): Promise<AiKnowledgeSource | undefined> {
  if (patch.title !== undefined) validateTitle(patch.title);
  if (patch.content !== undefined) validateContent(patch.content);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${webinarId}))`);
    const existingResult = await tx.execute(sql`
      SELECT id, length(content)::int AS content_length
        FROM webinar_documents
       WHERE webinar_id = ${webinarId} AND id = ${documentId}
       FOR UPDATE
    `);
    const existing = existingResult.rows[0] as { id: string; content_length: number } | undefined;
    if (!existing) return undefined;
    if (patch.content !== undefined) {
      await lockAndCheck(tx, webinarId, patch.content.length, existing.content_length);
    }
    const result = await tx.execute(sql`
      UPDATE webinar_documents
         SET title = COALESCE(${patch.title ?? null}, title),
             content = COALESCE(${patch.content ?? null}, content),
             updated_at = now()
       WHERE webinar_id = ${webinarId} AND id = ${documentId}
       RETURNING id, webinar_id, title, content, source_type, source_url, created_at, updated_at
    `);
    return result.rows[0] ? source(result.rows[0] as SourceRow) : undefined;
  });
}

export async function deleteKnowledgeSource(webinarId: string, documentId: string): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM webinar_documents
     WHERE webinar_id = ${webinarId} AND id = ${documentId}
     RETURNING id
  `);
  return result.rows.length > 0;
}

export async function upsertCorrectionSource(
  tx: AiKnowledgeTransaction,
  input: { webinarId: string; documentId?: string | null; title: string; content: string },
): Promise<AiKnowledgeSource> {
  validateTitle(input.title);
  validateContent(input.content);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.webinarId}))`);
  if (input.documentId) {
    const existingResult = await tx.execute(sql`
      SELECT length(content)::int AS content_length
        FROM webinar_documents
       WHERE webinar_id = ${input.webinarId} AND id = ${input.documentId}
         AND source_type = 'correction'
       FOR UPDATE
    `);
    const existing = existingResult.rows[0] as { content_length: number } | undefined;
    if (existing) {
      await lockAndCheck(tx, input.webinarId, input.content.length, existing.content_length);
      const updated = await tx.execute(sql`
        UPDATE webinar_documents
           SET title = ${input.title}, content = ${input.content}, source_url = NULL, updated_at = now()
         WHERE webinar_id = ${input.webinarId} AND id = ${input.documentId}
         RETURNING id, webinar_id, title, content, source_type, source_url, created_at, updated_at
      `);
      return source(updated.rows[0] as SourceRow);
    }
  }
  await lockAndCheck(tx, input.webinarId, input.content.length);
  const created = await tx.execute(sql`
    INSERT INTO webinar_documents (webinar_id, title, content, source_type, source_url, created_at, updated_at)
    VALUES (${input.webinarId}, ${input.title}, ${input.content}, 'correction', NULL, now(), now())
    RETURNING id, webinar_id, title, content, source_type, source_url, created_at, updated_at
  `);
  return source(created.rows[0] as SourceRow);
}