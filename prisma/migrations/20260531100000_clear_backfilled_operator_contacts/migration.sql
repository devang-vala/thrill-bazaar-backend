UPDATE "operator_profiles" AS op
SET
  "contact1" = CASE WHEN op."contact1" = u."phone" THEN NULL ELSE op."contact1" END,
  "contact2" = CASE WHEN op."contact2" = u."alternate_phone" THEN NULL ELSE op."contact2" END
FROM "User" AS u
WHERE op."operator_id" = u."user_id"
  AND (
    op."contact1" = u."phone"
    OR op."contact2" = u."alternate_phone"
  );
