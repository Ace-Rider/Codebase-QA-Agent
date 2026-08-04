import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

function getSqliteFilePath() {
    const datasourceUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

    if (!datasourceUrl.startsWith("file:")) {
        throw new Error('DATABASE_URL must use the sqlite "file:" protocol');
    }

    const rawPath = datasourceUrl.slice("file:".length);
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(".", rawPath);
}

function initializeDatabase(database: Database.Database) {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.exec(`
        CREATE TABLE IF NOT EXISTS "Conversation" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "title" TEXT NOT NULL,
            "message" TEXT NOT NULL DEFAULT '',
            "answer" TEXT NOT NULL DEFAULT '',
            "error" TEXT,
            "stepsJson" TEXT NOT NULL DEFAULT '[]',
            "citationsJson" TEXT NOT NULL DEFAULT '[]',
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS "Message" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "conversationId" TEXT NOT NULL,
            "role" TEXT NOT NULL,
            "content" TEXT NOT NULL,
            "toolCallId" TEXT,
            "toolCallsJson" TEXT,
            "sortOrder" INTEGER NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "Message_conversationId_fkey"
                FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id")
                ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "Message_conversationId_sortOrder_idx"
        ON "Message" ("conversationId", "sortOrder");

        CREATE TABLE IF NOT EXISTS "Turn" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "conversationId" TEXT NOT NULL,
            "question" TEXT NOT NULL,
            "answer" TEXT NOT NULL DEFAULT '',
            "error" TEXT,
            "stepsJson" TEXT NOT NULL DEFAULT '[]',
            "citationsJson" TEXT NOT NULL DEFAULT '[]',
            "tokenUsageJson" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "Turn_conversationId_fkey"
                FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id")
                ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "Turn_conversationId_createdAt_idx"
        ON "Turn" ("conversationId", "createdAt");
    `);

    // 旧库升级：给已存在的 Turn 表补 tokenUsageJson 列
    const turnColumns = database.prepare("PRAGMA table_info('Turn')").all() as Array<{ name: string }>;

    if (!turnColumns.some((column) => column.name === "tokenUsageJson")) {
        database.exec('ALTER TABLE "Turn" ADD COLUMN "tokenUsageJson" TEXT;');
    }
}

function ensureDatabase(databaseFilePath: string) {
    fs.mkdirSync(path.dirname(databaseFilePath), { recursive: true });
    const database = new Database(databaseFilePath);
    initializeDatabase(database);
    database.close();
}

declare global {
    // eslint-disable-next-line no-var
    var __myFirstAgentPrisma__: PrismaClient | undefined;
}

const databaseFilePath = getSqliteFilePath();
ensureDatabase(databaseFilePath);

const adapter = new PrismaBetterSqlite3({
    url: databaseFilePath,
});

export const prisma =
    globalThis.__myFirstAgentPrisma__ ??
    new PrismaClient({
        adapter,
    });

if (process.env.NODE_ENV !== "production") {
    globalThis.__myFirstAgentPrisma__ = prisma;
}
