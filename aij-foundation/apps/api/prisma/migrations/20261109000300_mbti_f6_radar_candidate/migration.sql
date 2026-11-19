-- Internal candidate: explicit current participation, never a location authorization.
CREATE TABLE "MbtiRadarParticipation" (
  "ownerId" TEXT NOT NULL,
  "enrolled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MbtiRadarParticipation_pkey" PRIMARY KEY ("ownerId"),
  CONSTRAINT "MbtiRadarParticipation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
