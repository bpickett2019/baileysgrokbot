-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "delegationOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "buildPackageId" TEXT,
ADD COLUMN     "buildPhase" TEXT;

-- CreateTable
CREATE TABLE "agent_builds" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "browserOwnerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reason" TEXT,
    "finalVerification" BOOLEAN NOT NULL DEFAULT false,
    "maxMicrousd" INTEGER NOT NULL,
    "spentMicrousd" INTEGER NOT NULL DEFAULT 0,
    "reservedMicrousd" INTEGER NOT NULL DEFAULT 0,
    "maxInputTokens" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_reviews" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "packageKey" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "build_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_participants" (
    "botId" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,

    CONSTRAINT "build_participants_pkey" PRIMARY KEY ("botId")
);

-- CreateTable
CREATE TABLE "build_work_packages" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "verifierId" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "activeRunId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'execute',
    "receiptRunId" TEXT,
    "evidence" JSONB,
    "reason" TEXT,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "spentMicrousd" INTEGER NOT NULL DEFAULT 0,
    "reservedMicrousd" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastObservation" TEXT,
    "repeatedObservations" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "build_work_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_api_calls" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'executing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "build_api_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_model_calls" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'reserved',
    "rates" JSONB NOT NULL,
    "reservedMicrousd" INTEGER NOT NULL,
    "reservedInputTokens" INTEGER NOT NULL,
    "reservedOutputTokens" INTEGER NOT NULL,
    "spentMicrousd" INTEGER,
    "usage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "build_model_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_builds_spaceId_userId_status_idx" ON "agent_builds"("spaceId", "userId", "status");

-- CreateIndex
CREATE INDEX "build_reviews_buildId_createdAt_idx" ON "build_reviews"("buildId", "createdAt");

-- CreateIndex
CREATE INDEX "build_participants_buildId_idx" ON "build_participants"("buildId");

-- CreateIndex
CREATE INDEX "build_work_packages_status_updatedAt_idx" ON "build_work_packages"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "build_work_packages_buildId_key_key" ON "build_work_packages"("buildId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "build_api_calls_packageId_phase_stepId_key" ON "build_api_calls"("packageId", "phase", "stepId");

-- CreateIndex
CREATE INDEX "build_model_calls_buildId_state_idx" ON "build_model_calls"("buildId", "state");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_buildPackageId_fkey" FOREIGN KEY ("buildPackageId") REFERENCES "build_work_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_reviews" ADD CONSTRAINT "build_reviews_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "agent_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_participants" ADD CONSTRAINT "build_participants_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "agent_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_work_packages" ADD CONSTRAINT "build_work_packages_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "agent_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_model_calls" ADD CONSTRAINT "build_model_calls_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "agent_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_model_calls" ADD CONSTRAINT "build_model_calls_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "build_work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "agent_builds_userId_idx" ON "agent_builds"("userId");

-- AddForeignKey
ALTER TABLE "agent_builds" ADD CONSTRAINT "agent_builds_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_builds" ADD CONSTRAINT "agent_builds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_api_calls" ADD CONSTRAINT "build_api_calls_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "build_work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
