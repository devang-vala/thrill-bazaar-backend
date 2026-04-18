import type { Context } from "hono";
import { prisma } from "../db.js";

const wishlistListingSelect = {
  id: true,
  listingName: true,
  listingSlug: true,
  frontImageUrl: true,
  bookingFormat: true,
  status: true,
  basePriceDisplay: true,
  currency: true,
  startLocationName: true,
  startPrimaryDivisionId: true,
  startSecondaryDivisionId: true,
  operator: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  category: {
    select: {
      id: true,
      categoryName: true,
    },
  },
  subCategory: {
    select: {
      id: true,
      subCatName: true,
    },
  },
  media: {
    select: {
      media: true,
    },
    take: 1,
    orderBy: { createdAt: "asc" as const },
  },
  badges: {
    where: { isActive: true },
    select: {
      id: true,
      isActive: true,
      badge: {
        select: {
          id: true,
          badgeName: true,
          badgeIconUrl: true,
          badgeColor: true,
        },
      },
    },
    take: 1,
    orderBy: { badge: { displayOrder: "asc" as const } },
  },
  tags: {
    where: { isActive: true },
    select: {
      id: true,
      isActive: true,
      tag: {
        select: {
          id: true,
          tagName: true,
          tagColor: true,
        },
      },
    },
    take: 2,
    orderBy: { tag: { displayOrder: "asc" as const } },
  },
};

const getListingIdFromBody = async (c: Context) => {
  const body = await c.req.json().catch(() => null);
  const listingId =
    body && typeof body === "object" && "listingId" in body
      ? String((body as { listingId?: string }).listingId || "").trim()
      : "";

  return listingId;
};

const fetchWishlistListingIds = async (userId: string) => {
  const wishlistItems = await prisma.wishlistItem.findMany({
    where: { userId },
    select: { listingId: true },
  });

  return wishlistItems.map((item) => item.listingId);
};

export const getWishlist = async (c: Context) => {
  try {
    const user = c.get("user");

    const wishlistItems = await prisma.wishlistItem.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        listingId: true,
        listing: {
          select: wishlistListingSelect,
        },
      },
    });

    const listings = wishlistItems
      .filter((item) => item.listing)
      .map((item) => ({
        ...item.listing,
        isWishlisted: true,
        wishlistedAt: item.createdAt,
      }));

    return c.json({
      success: true,
      data: listings,
      listingIds: listings.map((listing) => listing.id),
      count: listings.length,
    });
  } catch (error) {
    console.error("Get wishlist error:", error);
    return c.json({ success: false, error: "Failed to fetch wishlist" }, 500);
  }
};

export const addToWishlist = async (c: Context) => {
  try {
    const user = c.get("user");
    const listingId = await getListingIdFromBody(c);

    if (!listingId) {
      return c.json({ success: false, error: "Listing ID is required" }, 400);
    }

    const listing = await prisma.listing.findFirst({
      where: {
        id: listingId,
        status: "active",
      },
      select: {
        id: true,
      },
    });

    if (!listing) {
      return c.json({ success: false, error: "Listing not found" }, 404);
    }

    await prisma.wishlistItem.upsert({
      where: {
        userId_listingId: {
          userId: user.userId,
          listingId,
        },
      },
      update: {},
      create: {
        userId: user.userId,
        listingId,
      },
    });

    const listingIds = await fetchWishlistListingIds(user.userId);

    return c.json({
      success: true,
      message: "Listing added to wishlist",
      listingId,
      isWishlisted: true,
      listingIds,
    });
  } catch (error) {
    console.error("Add to wishlist error:", error);
    return c.json({ success: false, error: "Failed to update wishlist" }, 500);
  }
};

export const removeFromWishlist = async (c: Context) => {
  try {
    const user = c.get("user");
    const listingId = c.req.param("listingId")?.trim();

    if (!listingId) {
      return c.json({ success: false, error: "Listing ID is required" }, 400);
    }

    await prisma.wishlistItem.deleteMany({
      where: {
        userId: user.userId,
        listingId,
      },
    });

    const listingIds = await fetchWishlistListingIds(user.userId);

    return c.json({
      success: true,
      message: "Listing removed from wishlist",
      listingId,
      isWishlisted: false,
      listingIds,
    });
  } catch (error) {
    console.error("Remove from wishlist error:", error);
    return c.json({ success: false, error: "Failed to update wishlist" }, 500);
  }
};

export const toggleWishlist = async (c: Context) => {
  try {
    const user = c.get("user");
    const listingId = await getListingIdFromBody(c);

    if (!listingId) {
      return c.json({ success: false, error: "Listing ID is required" }, 400);
    }

    const existingItem = await prisma.wishlistItem.findUnique({
      where: {
        userId_listingId: {
          userId: user.userId,
          listingId,
        },
      },
      select: { id: true },
    });

    if (existingItem) {
      await prisma.wishlistItem.delete({
        where: { id: existingItem.id },
      });

      const listingIds = await fetchWishlistListingIds(user.userId);

      return c.json({
        success: true,
        message: "Listing removed from wishlist",
        listingId,
        isWishlisted: false,
        listingIds,
      });
    }

    const listing = await prisma.listing.findFirst({
      where: {
        id: listingId,
        status: "active",
      },
      select: { id: true },
    });

    if (!listing) {
      return c.json({ success: false, error: "Listing not found" }, 404);
    }

    await prisma.wishlistItem.create({
      data: {
        userId: user.userId,
        listingId,
      },
    });

    const listingIds = await fetchWishlistListingIds(user.userId);

    return c.json({
      success: true,
      message: "Listing added to wishlist",
      listingId,
      isWishlisted: true,
      listingIds,
    });
  } catch (error) {
    console.error("Toggle wishlist error:", error);
    return c.json({ success: false, error: "Failed to update wishlist" }, 500);
  }
};
