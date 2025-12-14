import type { Context } from "hono";
import { prisma } from "../db.js";

export interface CreatePrimaryDivisionRequest {
  country_id: string;
  division_name: string;
  division_code: string;
}

export interface UpdatePrimaryDivisionRequest {
  country_id?: string;
  division_name?: string;
  division_code?: string;
}

/**
 * Get all primary divisions
 */
export const getPrimaryDivisions = async (c: Context) => {
  try {
    const { country_id } = c.req.query();

    const whereClause: any = {};
    if (country_id) {
      whereClause.country_id = country_id;
    }

    const primaryDivisions = await prisma.primaryDivision.findMany({
      where: whereClause,
      orderBy: {
        division_name: "asc",
      },
      include: {
        country: true,
        secondaryDivisions: true,
      },
    });

    return c.json({
      success: true,
      data: primaryDivisions,
      count: primaryDivisions.length,
    });
  } catch (error) {
    console.error("Get primary divisions error:", error);
    return c.json({ error: "Failed to fetch primary divisions" }, 500);
  }
};

/**
 * Get primary division by ID
 */
export const getPrimaryDivision = async (c: Context) => {
  try {
    const divisionId = c.req.param("id");

    if (!divisionId) {
      return c.json({ error: "Primary division ID is required" }, 400);
    }

    const primaryDivision = await prisma.primaryDivision.findUnique({
      where: { primary_division_id: divisionId },
      include: {
        country: true,
        secondaryDivisions: {
          orderBy: {
            division_name: "asc",
          },
        },
      },
    });

    if (!primaryDivision) {
      return c.json({ error: "Primary division not found" }, 404);
    }

    return c.json({
      success: true,
      data: primaryDivision,
    });
  } catch (error) {
    console.error("Get primary division error:", error);
    return c.json({ error: "Failed to fetch primary division" }, 500);
  }
};

/**
 * Create a new primary division
 */
export const createPrimaryDivision = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreatePrimaryDivisionRequest;

    // Validate required fields
    if (!body.country_id || !body.division_name || !body.division_code) {
      return c.json(
        {
          error:
            "Country ID, division name, and division code are required",
        },
        400
      );
    }

    // Check if country exists
    const country = await prisma.country.findUnique({
      where: { country_id: body.country_id },
    });

    if (!country) {
      return c.json({ error: "Country not found" }, 404);
    }

    // Create primary division
    const newPrimaryDivision = await prisma.primaryDivision.create({
      data: {
        country_id: body.country_id,
        division_name: body.division_name,
        division_code: body.division_code,
      },
      include: {
        country: true,
      },
    });

    return c.json(
      {
        success: true,
        message: "Primary division created successfully",
        data: newPrimaryDivision,
      },
      201
    );
  } catch (error) {
    console.error("Create primary division error:", error);
    return c.json({ error: "Failed to create primary division" }, 500);
  }
};

/**
 * Update primary division
 */
export const updatePrimaryDivision = async (c: Context) => {
  try {
    const divisionId = c.req.param("id");
    const body = (await c.req.json()) as UpdatePrimaryDivisionRequest;

    if (!divisionId) {
      return c.json({ error: "Primary division ID is required" }, 400);
    }

    // Check if primary division exists
    const existingDivision = await prisma.primaryDivision.findUnique({
      where: { primary_division_id: divisionId },
    });

    if (!existingDivision) {
      return c.json({ error: "Primary division not found" }, 404);
    }

    // Prepare update data
    const updateData: any = {};

    if (body.division_name !== undefined) {
      updateData.division_name = body.division_name;
    }

    if (body.division_code !== undefined) {
      updateData.division_code = body.division_code;
    }

    if (body.country_id !== undefined) {
      // Check if country exists
      const country = await prisma.country.findUnique({
        where: { country_id: body.country_id },
      });

      if (!country) {
        return c.json({ error: "Country not found" }, 404);
      }

      updateData.country_id = body.country_id;
    }

    // Update primary division
    const updatedDivision = await prisma.primaryDivision.update({
      where: { primary_division_id: divisionId },
      data: updateData,
      include: {
        country: true,
      },
    });

    return c.json({
      success: true,
      message: "Primary division updated successfully",
      data: updatedDivision,
    });
  } catch (error) {
    console.error("Update primary division error:", error);
    return c.json({ error: "Failed to update primary division" }, 500);
  }
};

/**
 * Delete primary division
 */
export const deletePrimaryDivision = async (c: Context) => {
  try {
    const divisionId = c.req.param("id");

    if (!divisionId) {
      return c.json({ error: "Primary division ID is required" }, 400);
    }

    // Check if primary division exists
    const existingDivision = await prisma.primaryDivision.findUnique({
      where: { primary_division_id: divisionId },
    });

    if (!existingDivision) {
      return c.json({ error: "Primary division not found" }, 404);
    }

    // Delete primary division (cascade will delete secondary divisions)
    await prisma.primaryDivision.delete({
      where: { primary_division_id: divisionId },
    });

    return c.json({
      success: true,
      message: "Primary division deleted successfully",
    });
  } catch (error) {
    console.error("Delete primary division error:", error);
    return c.json({ error: "Failed to delete primary division" }, 500);
  }
};
