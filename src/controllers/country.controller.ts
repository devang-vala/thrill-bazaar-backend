import type { Context } from "hono";
import { prisma } from "../db.js";

export interface CreateCountryRequest {
  country_name: string;
  country_code: string;
}

export interface UpdateCountryRequest {
  country_name?: string;
  country_code?: string;
}

/**
 * Get all countries
 */
export const getCountries = async (c: Context) => {
  try {
    const countries = await prisma.country.findMany({
      orderBy: {
        country_name: "asc",
      },
      include: {
        primaryDivisions: {
          orderBy: {
            division_name: "asc",
          },
        },
      },
    });

    return c.json({
      success: true,
      data: countries,
      count: countries.length,
    });
  } catch (error) {
    console.error("Get countries error:", error);
    return c.json({ error: "Failed to fetch countries" }, 500);
  }
};

/**
 * Get country by ID
 */
export const getCountry = async (c: Context) => {
  try {
    const countryId = c.req.param("id");

    if (!countryId) {
      return c.json({ error: "Country ID is required" }, 400);
    }

    const country = await prisma.country.findUnique({
      where: { country_id: countryId },
      include: {
        primaryDivisions: {
          orderBy: {
            division_name: "asc",
          },
          include: {
            secondaryDivisions: true,
          },
        },
      },
    });

    if (!country) {
      return c.json({ error: "Country not found" }, 404);
    }

    return c.json({
      success: true,
      data: country,
    });
  } catch (error) {
    console.error("Get country error:", error);
    return c.json({ error: "Failed to fetch country" }, 500);
  }
};

/**
 * Create a new country
 */
export const createCountry = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateCountryRequest;

    // Validate required fields
    if (!body.country_name || !body.country_code) {
      return c.json(
        { error: "Country name and country code are required" },
        400
      );
    }

    // Check if country code already exists
    const existingCountry = await prisma.country.findUnique({
      where: { country_code: body.country_code },
    });

    if (existingCountry) {
      return c.json({ error: "Country code already exists" }, 409);
    }

    // Create country
    const newCountry = await prisma.country.create({
      data: {
        country_name: body.country_name,
        country_code: body.country_code,
      },
    });

    return c.json(
      {
        success: true,
        message: "Country created successfully",
        data: newCountry,
      },
      201
    );
  } catch (error) {
    console.error("Create country error:", error);
    return c.json({ error: "Failed to create country" }, 500);
  }
};

/**
 * Update country
 */
export const updateCountry = async (c: Context) => {
  try {
    const countryId = c.req.param("id");
    const body = (await c.req.json()) as UpdateCountryRequest;

    if (!countryId) {
      return c.json({ error: "Country ID is required" }, 400);
    }

    // Check if country exists
    const existingCountry = await prisma.country.findUnique({
      where: { country_id: countryId },
    });

    if (!existingCountry) {
      return c.json({ error: "Country not found" }, 404);
    }

    // Prepare update data
    const updateData: any = {};

    if (body.country_name !== undefined) {
      updateData.country_name = body.country_name;
    }

    if (body.country_code !== undefined) {
      // Check if new country code already exists
      const codeExists = await prisma.country.findFirst({
        where: {
          country_code: body.country_code,
          NOT: { country_id: countryId },
        },
      });

      if (codeExists) {
        return c.json({ error: "Country code already exists" }, 409);
      }

      updateData.country_code = body.country_code;
    }

    // Update country
    const updatedCountry = await prisma.country.update({
      where: { country_id: countryId },
      data: updateData,
    });

    return c.json({
      success: true,
      message: "Country updated successfully",
      data: updatedCountry,
    });
  } catch (error) {
    console.error("Update country error:", error);
    return c.json({ error: "Failed to update country" }, 500);
  }
};

/**
 * Delete country
 */
export const deleteCountry = async (c: Context) => {
  try {
    const countryId = c.req.param("id");

    if (!countryId) {
      return c.json({ error: "Country ID is required" }, 400);
    }

    // Check if country exists
    const existingCountry = await prisma.country.findUnique({
      where: { country_id: countryId },
    });

    if (!existingCountry) {
      return c.json({ error: "Country not found" }, 404);
    }

    // Delete country (cascade will delete related divisions)
    await prisma.country.delete({
      where: { country_id: countryId },
    });

    return c.json({
      success: true,
      message: "Country deleted successfully",
    });
  } catch (error) {
    console.error("Delete country error:", error);
    return c.json({ error: "Failed to delete country" }, 500);
  }
};
