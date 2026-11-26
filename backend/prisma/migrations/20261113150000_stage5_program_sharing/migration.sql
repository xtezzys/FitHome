-- Этап 5: публичная библиотека программ и отправка программы пользователю.
-- Program: добровольная публикация (isPublic/publishedAt).
-- ProgramShare: независимая передача программы конкретному пользователю.

ALTER TABLE "programs" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "programs" ADD COLUMN "publishedAt" DATETIME;

CREATE INDEX "programs_isPublic_isActive_idx" ON "programs"("isPublic", "isActive");

CREATE TABLE "program_shares" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "programId" INTEGER NOT NULL,
    "fromUserId" INTEGER NOT NULL,
    "toUserId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "program_shares_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "program_shares_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "program_shares_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "program_shares_programId_idx" ON "program_shares"("programId");
CREATE INDEX "program_shares_toUserId_status_idx" ON "program_shares"("toUserId", "status");
CREATE INDEX "program_shares_fromUserId_idx" ON "program_shares"("fromUserId");
