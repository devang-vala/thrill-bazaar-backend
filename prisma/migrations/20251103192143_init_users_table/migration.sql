-- CreateTable
CREATE TABLE "User" (
    "user_id" TEXT NOT NULL,
    "user_type" "UserType" NOT NULL DEFAULT 'customer',
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "profile_image_url" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
