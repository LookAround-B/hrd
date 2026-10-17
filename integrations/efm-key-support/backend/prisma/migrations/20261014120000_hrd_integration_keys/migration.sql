CREATE TABLE "EfmIntegrationKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "EfmIntegrationKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EfmIntegrationKey_keyHash_key" ON "EfmIntegrationKey"("keyHash");
CREATE INDEX "EfmIntegrationKey_employeeId_idx" ON "EfmIntegrationKey"("employeeId");
ALTER TABLE "EfmIntegrationKey" ADD CONSTRAINT "EfmIntegrationKey_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
