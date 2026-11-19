-- AF-157: internal claim identity; existing rows remain NULL until claimed.
ALTER TABLE "runtime_job" ADD COLUMN "lease_nonce" UUID;
