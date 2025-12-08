import type { Context } from "hono";
import {configureCloudinary} from "../config/cloudinary.config.js";
import { Readable } from "stream";

const cloudinary = configureCloudinary();


/**
 * Upload single or multiple images to Cloudinary
 */
export const uploadImages = async (c: Context) => {
  try {
    const body = await c.req.parseBody();
    
    // Collect all files from the body
    const fileArray: File[] = [];
    
    // Check for 'images' field (can be single or array)
    if (body.images) {
      if (Array.isArray(body.images)) {
        fileArray.push(...body.images.filter((f): f is File => f instanceof File));
      } else if (body.images instanceof File) {
        fileArray.push(body.images);
      }
    }
    
    // Also check for 'image' field (single file)
    if (body.image && body.image instanceof File) {
      fileArray.push(body.image);
    }
    
    // Check all keys in body for File objects
    for (const key in body) {
      const value = body[key];
      if (value instanceof File && !fileArray.includes(value)) {
        fileArray.push(value);
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item instanceof File && !fileArray.includes(item)) {
            fileArray.push(item);
          }
        });
      }
    }

    if (fileArray.length === 0) {
      return c.json({ error: "No valid image files provided" }, 400);
    }

    // Upload files to Cloudinary
    const uploadPromises = fileArray.map(async (file) => {
      // Convert File to Buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Upload to Cloudinary
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "thrill-bazaar",
            resource_type: "auto",
            // Optional: Add transformations
            // transformation: [{ width: 1000, height: 1000, crop: "limit" }],
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve({
                url: result?.secure_url,
                publicId: result?.public_id,
                format: result?.format,
                width: result?.width,
                height: result?.height,
              });
            }
          }
        );

        // Create a readable stream from buffer
        const readableStream = new Readable();
        readableStream.push(buffer);
        readableStream.push(null);
        readableStream.pipe(uploadStream);
      });
    });

    const uploadResults = await Promise.all(uploadPromises);

    return c.json({
      success: true,
      message: `${uploadResults.length} image(s) uploaded successfully`,
      data: uploadResults,
      count: uploadResults.length,
    });
  } catch (error) {
    console.error("Upload images error:", error);
    return c.json({ error: "Failed to upload images" }, 500);
  }
};

/**
 * Delete image from Cloudinary by public_id
 */
export const deleteImage = async (c: Context) => {
  try {
    const { publicId } = await c.req.json();

    if (!publicId) {
      return c.json({ error: "Public ID is required" }, 400);
    }

    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === "ok") {
      return c.json({
        success: true,
        message: "Image deleted successfully",
      });
    } else {
      return c.json({ error: "Failed to delete image" }, 400);
    }
  } catch (error) {
    console.error("Delete image error:", error);
    return c.json({ error: "Failed to delete image" }, 500);
  }
};
