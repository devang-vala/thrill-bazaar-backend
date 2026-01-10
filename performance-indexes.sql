-- Performance Optimization Indexes for Listings Table
-- Run this SQL script directly on your database to add performance indexes

-- Index for filtering by status and ordering by creation date
CREATE INDEX IF NOT EXISTS "listings_status_createdAt_idx" ON "listings"("status", "created_at");

-- Index for filtering by category and status
CREATE INDEX IF NOT EXISTS "listings_categoryId_status_idx" ON "listings"("category_id", "status");

-- Index for filtering by operator/seller and status
CREATE INDEX IF NOT EXISTS "listings_operatorId_status_idx" ON "listings"("operator_id", "status");

-- Index for location-based filtering (start location)
CREATE INDEX IF NOT EXISTS "listings_startPrimaryDivisionId_status_idx" ON "listings"("start_primary_division_id", "status");

CREATE INDEX IF NOT EXISTS "listings_startSecondaryDivisionId_status_idx" ON "listings"("start_secondary_division_id", "status");

-- Index for filtering by booking format
CREATE INDEX IF NOT EXISTS "listings_bookingFormat_status_idx" ON "listings"("booking_format", "status");

-- Index for price sorting
CREATE INDEX IF NOT EXISTS "listings_basePriceDisplay_idx" ON "listings"("base_price_display");

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS "listings_status_category_price_idx" ON "listings"("status", "category_id", "base_price_display");

-- Analyze tables after creating indexes to update query planner statistics
ANALYZE listings;
