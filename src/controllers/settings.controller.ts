import type { Context } from "hono";
import { prisma } from "../db.js";

interface SettingsPayload {
  number: string;
  instagram_link?: string | null;
  facebook_link?: string | null;
  twiiter_link?: string | null;
  email: string;
}

const mapResponse = (setting: any) => ({
  id: setting.id,
  number: setting.number,
  instagram_link: setting.instagramLink,
  facebook_link: setting.facebookLink,
  twiiter_link: setting.twitterLink,
  email: setting.email,
  createdAt: setting.createdAt,
  updatedAt: setting.updatedAt,
});

const normalizeOptional = (value?: string | null) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const isValidEmail = (email: string) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isValidHttpUrl = (url: string | null) => {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Get all settings records
 */
export const getSettings = async (c: Context) => {
  try {
    const settings = await prisma.setting.findMany({
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      success: true,
      data: settings.map(mapResponse),
      count: settings.length,
    });
  } catch (error) {
    console.error("Get settings error:", error);
    return c.json({ success: false, message: "Failed to fetch settings" }, 500);
  }
};

/**
 * Get setting by ID
 */
export const getSettingById = async (c: Context) => {
  try {
    const id = c.req.param("id");

    const setting = await prisma.setting.findUnique({
      where: { id },
    });

    if (!setting) {
      return c.json({ success: false, message: "Setting not found" }, 404);
    }

    return c.json({ success: true, data: mapResponse(setting) });
  } catch (error) {
    console.error("Get setting by ID error:", error);
    return c.json({ success: false, message: "Failed to fetch setting" }, 500);
  }
};

/**
 * Create a setting record
 */
export const createSetting = async (c: Context) => {
  try {
    const body = (await c.req.json()) as SettingsPayload;

    if (!body.number?.trim() || !body.email?.trim()) {
      return c.json({ success: false, message: "number and email are required" }, 400);
    }

    const email = body.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return c.json({ success: false, message: "Invalid email format" }, 400);
    }

    const instagramLink = normalizeOptional(body.instagram_link);
    const facebookLink = normalizeOptional(body.facebook_link);
    const twitterLink = normalizeOptional(body.twiiter_link);

    if (!isValidHttpUrl(instagramLink) || !isValidHttpUrl(facebookLink) || !isValidHttpUrl(twitterLink)) {
      return c.json({ success: false, message: "Social links must be valid http/https URLs" }, 400);
    }

    const created = await prisma.setting.create({
      data: {
        number: body.number.trim(),
        email,
        instagramLink,
        facebookLink,
        twitterLink,
      },
    });

    return c.json(
      {
        success: true,
        message: "Setting created successfully",
        data: mapResponse(created),
      },
      201
    );
  } catch (error) {
    console.error("Create setting error:", error);
    return c.json({ success: false, message: "Failed to create setting" }, 500);
  }
};

/**
 * Update a setting record
 */
export const updateSetting = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as Partial<SettingsPayload>;

    const existing = await prisma.setting.findUnique({
      where: { id },
    });

    if (!existing) {
      return c.json({ success: false, message: "Setting not found" }, 404);
    }

    const updateData: any = {};

    if (body.number !== undefined) {
      if (!body.number.trim()) {
        return c.json({ success: false, message: "number cannot be empty" }, 400);
      }
      updateData.number = body.number.trim();
    }

    if (body.email !== undefined) {
      const normalizedEmail = body.email.trim().toLowerCase();
      if (!normalizedEmail) {
        return c.json({ success: false, message: "email cannot be empty" }, 400);
      }
      if (!isValidEmail(normalizedEmail)) {
        return c.json({ success: false, message: "Invalid email format" }, 400);
      }
      updateData.email = normalizedEmail;
    }

    if (body.instagram_link !== undefined) {
      const instagramLink = normalizeOptional(body.instagram_link);
      if (!isValidHttpUrl(instagramLink)) {
        return c.json({ success: false, message: "Invalid instagram_link URL" }, 400);
      }
      updateData.instagramLink = instagramLink;
    }

    if (body.facebook_link !== undefined) {
      const facebookLink = normalizeOptional(body.facebook_link);
      if (!isValidHttpUrl(facebookLink)) {
        return c.json({ success: false, message: "Invalid facebook_link URL" }, 400);
      }
      updateData.facebookLink = facebookLink;
    }

    if (body.twiiter_link !== undefined) {
      const twitterLink = normalizeOptional(body.twiiter_link);
      if (!isValidHttpUrl(twitterLink)) {
        return c.json({ success: false, message: "Invalid twiiter_link URL" }, 400);
      }
      updateData.twitterLink = twitterLink;
    }

    const updated = await prisma.setting.update({
      where: { id },
      data: updateData,
    });

    return c.json({
      success: true,
      message: "Setting updated successfully",
      data: mapResponse(updated),
    });
  } catch (error) {
    console.error("Update setting error:", error);
    return c.json({ success: false, message: "Failed to update setting" }, 500);
  }
};

/**
 * Delete a setting record
 */
export const deleteSetting = async (c: Context) => {
  try {
    const id = c.req.param("id");

    const existing = await prisma.setting.findUnique({
      where: { id },
    });

    if (!existing) {
      return c.json({ success: false, message: "Setting not found" }, 404);
    }

    await prisma.setting.delete({
      where: { id },
    });

    return c.json({
      success: true,
      message: "Setting deleted successfully",
    });
  } catch (error) {
    console.error("Delete setting error:", error);
    return c.json({ success: false, message: "Failed to delete setting" }, 500);
  }
};
