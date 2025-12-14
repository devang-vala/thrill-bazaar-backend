import type { Context } from "hono";
import { prisma } from "../db.js";

export interface CreateSecondaryDivisionRequest {
  primary_division_id: string;
  division_name: string;
  latitude: number;
  longitude: number;
}

export interface UpdateSecondaryDivisionRequest {
  primary_division_id?: string;
  division_name?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Get all secondary divisions
 */
export const getSecondaryDivisions = async (c: Context) => {
  try {
    const { primary_division_id } = c.req.query();

    const whereClause: any = {};
    if (primary_division_id) {
      whereClause.primary_division_id = primary_division_id;
    }

    const secondaryDivisions = await prisma.secondaryDivision.findMany({
      where: whereClause,
      orderBy: {
        division_name: "asc",
      },
      include: {
        primaryDivision: {
          include: {
            country: true,
          },
        },
      },
    });

    return c.json({
      success: true,
      data: secondaryDivisions,
      count: secondaryDivisions.length,
    });
  } catch (error) {
    console.error("Get secondary divisions error:", error);
    return c.json({ error: "Failed to fetch secondary divisions" }, 500);
  }
};

/**
 * Get secondary division by ID
 */
export const getSecondaryDivision = async (c: Context) => {
  try {
    const divisionId = c.req.param("id");

    if (!divisionId) {
      return c.json({ error: "Secondary division ID is required" }, 400);
    }

    const secondaryDivision = await prisma.secondaryDivision.findUnique({
      where: { secondary_division_id: divisionId },
      include: {
        primaryDivision: {
          include: {
            country: true,
          },
        },
      },
    });

    if (!secondaryDivision) {
      return c.json({ error: "Secondary division not found" }, 404);
    }

    return c.json({
      success: true,
      data: secondaryDivision,
    });
  } catch (error) {
    console.error("Get secondary division error:", error);
    return c.json({ error: "Failed to fetch secondary division" }, 500);
  }
};

/**
 * Create a new secondary division
 */
export const createSecondaryDivision = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateSecondaryDivisionRequest;

    // Validate required fields
    if (
      !body.primary_division_id ||
      !body.division_name ||
      body.latitude === undefined ||
      body.longitude === undefined
    ) {
      return c.json(
        {
          error:
            "Primary division ID, division name, latitude, and longitude are required",
        },
        400
      );
    }

    // Check if primary division exists
    const primaryDivision = await prisma.primaryDivision.findUnique({
      where: { primary_division_id: body.primary_division_id },
    });

    if (!primaryDivision) {
      return c.json({ error: "Primary division not found" }, 404);
    }

    // Create secondary division
    const newSecondaryDivision = await prisma.secondaryDivision.create({
      data: {
        primary_division_id: body.primary_division_id,
        division_name: body.division_name,
        latitude: body.latitude,
        longitude: body.longitude,
      },
      include: {
        primaryDivision: {
          include: {
            country: true,
          },
        },
      },
    });

    return c.json(
      {
        success: true,
        message: "Secondary division created successfully",
        data: newSecondaryDivision,
      },
      201
    );
  } catch (error) {
    console.error("Create secondary division error:", error);
    return c.json({ error: "Failed to create secondary division" }, 500);
  }
};

/**
 * Update secondary division
 */
export const updateSecondaryDivision = async (c: Context) => {
  try {
    const divisionId = c.req.param("id");
    const body = (await c.req.json()) as UpdateSecondaryDivisionRequest;

    if (!divisionId) {
      return c.json({ error: "Secondary division ID is required" }, 400);
    }

    // Check if secondary division exists
    const existingDivision = await prisma.secondaryDivision.findUnique({
      where: { secondary_division_id: divisionId },
    });

    if (!existingDivision) {
      return c.json({ error: "Secondary division not found" }, 404);
    }

    // Prepare update data
    const updateData: any = {};

    if (body.division_name !== undefined) {
      updateData.division_name = body.division_name;
    }

    if (body.latitude !== undefined) {
      updateData.latitude = body.latitude;
    }

    if (body.longitude !== undefined) {
      updateData.longitude = body.longitude;
    }

    if (body.primary_division_id !== undefined) {
      // Check if primary division exists
      const primaryDivision = await prisma.primaryDivision.findUnique({
        where: { primary_division_id: body.primary_division_id },
      });

      if (!primaryDivision) {
        return c.json({ error: "Primary division not found" }, 404);
      }

      updateData.primary_division_id = body.primary_division_id;
    }

    // Update secondary division
    const updatedDivision = await prisma.secondaryDivision.update({
      where: { secondary_division_id: divisionId },
      data: updateData,
      include: {
        primaryDivision: {
          include: {
            country: true,
          },
        },
      },
    });

    return c.json({
      success: true,
      message: "Secondary division updated successfully",
      data: updatedDivision,
    });
  } catch (error) {
    console.error("Update secondary division error:", error);
    return c.json({ error: "Failed to update secondary division" }, 500);
  }
};

/**
 * Delete secondary division
 */
export const deleteSecondaryDivision = async (c: Context) => {
  try {
    const divisionId = c.req.param("id");

    if (!divisionId) {
      return c.json({ error: "Secondary division ID is required" }, 400);
    }

    // Check if secondary division exists
    const existingDivision = await prisma.secondaryDivision.findUnique({
      where: { secondary_division_id: divisionId },
    });

    if (!existingDivision) {
      return c.json({ error: "Secondary division not found" }, 404);
    }

    // Delete secondary division
    await prisma.secondaryDivision.delete({
      where: { secondary_division_id: divisionId },
    });

    return c.json({
      success: true,
      message: "Secondary division deleted successfully",
    });
  } catch (error) {
    console.error("Delete secondary division error:", error);
    return c.json({ error: "Failed to delete secondary division" }, 500);
  }
};
