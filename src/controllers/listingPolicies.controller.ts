import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

/**
 * Get policies for a seller
 */
export const getListingPolicies = async (c: Context) => {
  try {
    const sellerId = c.req.param("sellerId");
    const { type } = c.req.query();

    const whereClause: any = { sellerId };
    if (type) {
      whereClause.policyType = type;
    }

    const policies = await prisma.listingPolicy.findMany({
      where: whereClause,
      include: {
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { policyType: "asc" },
    });

    return c.json({
      success: true,
      data: policies,
      count: policies.length,
    });
  } catch (error) {
    console.error("Get listing policies error:", error);
    return c.json({ error: "Failed to fetch policies" }, 500);
  }
};

/**
 * Create listing policy
 */
export const createListingPolicy = async (c: Context) => {
  try {
    const sellerId = c.req.param("sellerId");
    const body = await c.req.json();
    const user = c.get("user");

    // Check if user is the seller or admin
    if (
      user.userType !== "admin" &&
      user.userType !== "super_admin" &&
      user.userId !== sellerId
    ) {
      return c.json(
        { error: "Not authorized to create policies for this seller" },
        403
      );
    }

    const policyData = {
      sellerId,
      policyType: body.policyType,
      policyContent: sanitizeString(body.policyContent, 10000),
    };

    const policy = await prisma.listingPolicy.create({
      data: policyData,
      include: {
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return c.json(
      {
        success: true,
        message: "Policy created successfully",
        data: policy,
      },
      201
    );
  } catch (error) {
    console.error("Create listing policy error:", error);
    return c.json({ error: "Failed to create policy" }, 500);
  }
};

/**
 * Update listing policy
 */
export const updateListingPolicy = async (c: Context) => {
  try {
    const policyId = c.req.param("id");
    const body = await c.req.json();
    const user = c.get("user");

    // Check ownership
    const existingPolicy = await prisma.listingPolicy.findUnique({
      where: { id: policyId },
    });

    if (!existingPolicy) {
      return c.json({ error: "Policy not found" }, 404);
    }

    if (
      user.userType !== "admin" &&
      user.userType !== "super_admin" &&
      user.userId !== existingPolicy.sellerId
    ) {
      return c.json({ error: "Not authorized to update this policy" }, 403);
    }

    const updateData: any = {};

    if (body.policyType !== undefined) {
      updateData.policyType = body.policyType;
    }
    if (body.policyContent !== undefined) {
      updateData.policyContent = sanitizeString(body.policyContent, 10000);
    }

    const updatedPolicy = await prisma.listingPolicy.update({
      where: { id: policyId },
      data: updateData,
      include: {
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return c.json({
      success: true,
      message: "Policy updated successfully",
      data: updatedPolicy,
    });
  } catch (error) {
    console.error("Update listing policy error:", error);
    return c.json({ error: "Failed to update policy" }, 500);
  }
};

/**
 * Get policy by ID
 */
export const getListingPolicyById = async (c: Context) => {
  try {
    const policyId = c.req.param("id");

    const policy = await prisma.listingPolicy.findUnique({
      where: { id: policyId },
      include: {
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!policy) {
      return c.json({ error: "Policy not found" }, 404);
    }

    return c.json({
      success: true,
      data: policy,
    });
  } catch (error) {
    console.error("Get listing policy by ID error:", error);
    return c.json({ error: "Failed to fetch policy" }, 500);
  }
};
