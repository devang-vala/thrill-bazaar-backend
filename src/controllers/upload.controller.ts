import type { Context } from "hono";
import {configureCloudinary} from "../config/cloudinary.config.js";
import { Readable } from "stream";

const cloudinary = configureCloudinary();

/**
 * Helper function to extract all File objects from parsed multipart body
 * Handles various field naming patterns that different clients might use
 */
const extractFilesFromBody = (body: any): File[] => {
  const fileArray: File[] = [];
  const seenFiles = new Set<File>();

  const addFile = (file: File, source: string) => {
    if (!seenFiles.has(file)) {
      fileArray.push(file);
      seenFiles.add(file);
      console.log(`✅ Found File from ${source}: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
    }
  };

  // Check for 'images' field (can be single or array)
  if (body.images) {
    if (Array.isArray(body.images)) {
      body.images.forEach((item: any, idx: number) => {
        if (item instanceof File) {
          addFile(item, `images[${idx}]`);
        }
      });
    } else if (body.images instanceof File) {
      addFile(body.images, 'images');
    }
  }

  // Check for common field names
  const commonFieldNames = ['image', 'file', 'files', 'upload', 'uploads'];
  for (const fieldName of commonFieldNames) {
    if (body[fieldName]) {
      if (Array.isArray(body[fieldName])) {
        body[fieldName].forEach((item: any, idx: number) => {
          if (item instanceof File) {
            addFile(item, `${fieldName}[${idx}]`);
          }
        });
      } else if (body[fieldName] instanceof File) {
        addFile(body[fieldName], fieldName);
      }
    }
  }

  // Check all keys in body for File objects (handles any field name pattern)
  // This catches cases where the client might send files with indices like images[0], images[1], etc.
  for (const key in body) {
    const value = body[key];
    
    if (value instanceof File) {
      addFile(value, `key '${key}'`);
    } else if (Array.isArray(value)) {
      value.forEach((item: any, index: number) => {
        if (item instanceof File) {
          addFile(item, `${key}[${index}]`);
        }
      });
    }
  }

  return fileArray;
};

/**
 * Upload single or multiple images to Cloudinary
 */
export const uploadImages = async (c: Context) => {
  try {
    const body = await c.req.parseBody();
    
    // Debug: Log what we received
    console.log("📦 Upload Request - Body keys:", Object.keys(body));
    console.log("📦 Upload Request - Body structure:");
    Object.keys(body).forEach((key: string) => {
      const value = body[key];
      if (value instanceof File) {
        console.log(`  ${key}: File(${value.name}, ${(value.size / 1024).toFixed(2)} KB)`);
      } else if (Array.isArray(value)) {
        console.log(`  ${key}: Array(${value.length})`);
        value.forEach((v: any, i: number) => {
          if (v instanceof File) {
            console.log(`    [${i}]: File(${v.name}, ${(v.size / 1024).toFixed(2)} KB)`);
          } else {
            console.log(`    [${i}]: ${typeof v}`);
          }
        });
      } else {
        console.log(`  ${key}: ${typeof value}`);
      }
    });
    
    // Extract all files using the helper function
    const fileArray = extractFilesFromBody(body);

    console.log(`📊 Total files collected: ${fileArray.length}`);

    if (fileArray.length === 0) {
      console.error("❌ No files found in request");
      return c.json({ error: "No valid image files provided" }, 400);
    }

    // Validate file types and sizes
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    
    for (const file of fileArray) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        console.error(`❌ Invalid file type: ${file.type} for ${file.name}`);
        return c.json({ 
          error: `Invalid file type for ${file.name}. Allowed types: JPEG, PNG, WebP, GIF` 
        }, 400);
      }
      
      if (file.size > MAX_FILE_SIZE) {
        console.error(`❌ File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        return c.json({ 
          error: `File ${file.name} is too large. Maximum size: 10MB` 
        }, 400);
      }
    }

    // Upload files to Cloudinary
    console.log(`⬆️  Starting upload of ${fileArray.length} file(s)...`);
    const uploadPromises = fileArray.map(async (file, index) => {
      console.log(`  [${index + 1}/${fileArray.length}] Uploading: ${file.name}`);
      
      try {
        // Convert File to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to Cloudinary
        const result = await new Promise<any>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: "thrill-bazaar/reviews",
              resource_type: "auto",
              transformation: [
                { width: 1500, height: 1500, crop: "limit", quality: "auto:good" }
              ],
            },
            (error, result) => {
              if (error) {
                console.error(`  ❌ Upload failed for ${file.name}:`, error);
                reject(error);
              } else {
                console.log(`  ✅ Upload successful for ${file.name}: ${result?.secure_url}`);
                resolve({
                  url: result?.secure_url,
                  publicId: result?.public_id,
                  format: result?.format,
                  width: result?.width,
                  height: result?.height,
                  originalName: file.name,
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

        return result;
      } catch (error) {
        console.error(`  ❌ Error processing ${file.name}:`, error);
        throw error;
      }
    });

    const uploadResults = await Promise.all(uploadPromises);
    
    console.log(`🎉 Upload complete: ${uploadResults.length} image(s) uploaded successfully`);

    return c.json({
      success: true,
      message: `${uploadResults.length} image(s) uploaded successfully`,
      data: uploadResults,
      count: uploadResults.length,
    });
  } catch (error) {
    console.error("❌ Upload images error:", error);
    return c.json({ 
      error: "Failed to upload images",
      details: error instanceof Error ? error.message : String(error)
    }, 500);
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
