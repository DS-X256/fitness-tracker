import { db } from '$lib/server/db';
import { assistantThreads, assistantMessages } from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';

// Persistence for the conversational AI Coach (see $lib/server/ai/assistant.ts). Message content is
// encrypted at rest, AAD-bound to `${userId}:assistant_messages`, exactly like the peptide tables —
// a thread can name compounds, doses, and health detail, so it's as sensitive as that data. Only the
// role and FK/scoping columns are cleartext. v1 uses a single active thread per user; the threads
// table keeps multiple named threads open as a later extension.

const aad = (userId: number) => `${userId}:assistant_messages`;

export type ChatRole = 'user' | 'assistant';
type MessageEnc = { content: string; model?: string };
export type ChatMessage = { id: number; role: ChatRole; content: string; model: string | null; createdAt: Date };

function decode(row: typeof assistantMessages.$inferSelect): ChatMessage {
	const enc = decryptJson<MessageEnc>(row.enc, aad(row.userId));
	return {
		id: row.id,
		role: row.role as ChatRole,
		content: enc.content,
		model: enc.model ?? null,
		createdAt: row.createdAt
	};
}

/** The user's single active (most-recent) thread, created lazily on first use. */
export async function getOrCreateActiveThread(userId: number): Promise<number> {
	const [existing] = await db
		.select({ id: assistantThreads.id })
		.from(assistantThreads)
		.where(eq(assistantThreads.userId, userId))
		.orderBy(asc(assistantThreads.id))
		.limit(1);
	if (existing) return existing.id;
	const now = new Date();
	const [created] = await db
		.insert(assistantThreads)
		.values({ userId, createdAt: now, updatedAt: now })
		.returning({ id: assistantThreads.id });
	return created.id;
}

/** A thread's messages in chronological order. Scoped by userId as well as threadId so a mismatched
 *  thread id can never read another account's conversation. */
export async function listMessages(userId: number, threadId: number): Promise<ChatMessage[]> {
	const rows = await db
		.select()
		.from(assistantMessages)
		.where(and(eq(assistantMessages.userId, userId), eq(assistantMessages.threadId, threadId)))
		.orderBy(asc(assistantMessages.id));
	return rows.map(decode);
}

export async function appendMessage(
	userId: number,
	threadId: number,
	role: ChatRole,
	content: string,
	model?: string
): Promise<ChatMessage> {
	const now = new Date();
	const enc = encryptJson({ content, model } satisfies MessageEnc, aad(userId));
	const [row] = await db
		.insert(assistantMessages)
		.values({ userId, threadId, role, enc, createdAt: now })
		.returning();
	await db.update(assistantThreads).set({ updatedAt: now }).where(eq(assistantThreads.id, threadId));
	return decode(row);
}

/** Clears a thread's messages (the "New chat" action), keeping the thread row itself. */
export async function clearThread(userId: number, threadId: number): Promise<void> {
	await db
		.delete(assistantMessages)
		.where(and(eq(assistantMessages.userId, userId), eq(assistantMessages.threadId, threadId)));
}
