# Image Upload API Documentation

## Setup

1. Add Cloudinary credentials to your `.env` file:
```env
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

2. Get your Cloudinary credentials from: https://cloudinary.com/console

## API Endpoints

### Upload Images
**POST** `/api/upload/images`

Upload single or multiple images to Cloudinary.

#### Request (Postman/Form-data):
- Set request type to `POST`
- Set body type to `form-data`
- Add field name: `images` with type: `File`
- For multiple images, add multiple files with the same field name `images`

#### Example using cURL (single image):
```bash
curl -X POST http://localhost:3000/api/upload/images \
  -F "images=@/path/to/image.jpg"
```

#### Example using cURL (multiple images):
```bash
curl -X POST http://localhost:3000/api/upload/images \
  -F "images=@/path/to/image1.jpg" \
  -F "images=@/path/to/image2.jpg" \
  -F "images=@/path/to/image3.jpg"
```

#### Response (Success):
```json
{
  "success": true,
  "message": "3 image(s) uploaded successfully",
  "data": [
    {
      "url": "https://res.cloudinary.com/xxx/image/upload/v1234567890/thrill-bazaar/abc123.jpg",
      "publicId": "thrill-bazaar/abc123",
      "format": "jpg",
      "width": 1920,
      "height": 1080
    },
    {
      "url": "https://res.cloudinary.com/xxx/image/upload/v1234567890/thrill-bazaar/def456.jpg",
      "publicId": "thrill-bazaar/def456",
      "format": "jpg",
      "width": 1280,
      "height": 720
    }
  ],
  "count": 2
}
```

#### Response (Error):
```json
{
  "error": "No images provided"
}
```

---

### Delete Image
**DELETE** `/api/upload/images`

Delete an image from Cloudinary using its public_id.

#### Request Body (JSON):
```json
{
  "publicId": "thrill-bazaar/abc123"
}
```

#### Response (Success):
```json
{
  "success": true,
  "message": "Image deleted successfully"
}
```

#### Response (Error):
```json
{
  "error": "Public ID is required"
}
```

---

## Postman Setup

### Upload Single Image:
1. Method: `POST`
2. URL: `http://localhost:3000/api/upload/images`
3. Body → form-data
4. Key: `images` (File type)
5. Value: Select your image file

### Upload Multiple Images:
1. Method: `POST`
2. URL: `http://localhost:3000/api/upload/images`
3. Body → form-data
4. Add multiple rows with the same key: `images` (File type)
5. Select different image files for each row

### Delete Image:
1. Method: `DELETE`
2. URL: `http://localhost:3000/api/upload/images`
3. Body → raw → JSON
4. Content:
```json
{
  "publicId": "thrill-bazaar/your-image-public-id"
}
```

---

## Notes

- Uploaded images are automatically stored in the `thrill-bazaar` folder in Cloudinary
- Supported formats: JPG, PNG, GIF, WebP, and more
- Maximum file size depends on your Cloudinary plan
- Images are automatically optimized by Cloudinary
- The `publicId` from the upload response is needed to delete images

---

## Authentication

Currently, authentication is commented out. To enable authentication, uncomment this line in `upload.route.ts`:

```typescript
uploadRouter.use(authenticateToken);
```
