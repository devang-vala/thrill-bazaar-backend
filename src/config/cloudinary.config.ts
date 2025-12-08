import { v2 as cloudinary } from "cloudinary";

export const configureCloudinary = () => {
  cloudinary.config({
    cloud_name:"dfzvgykvx",
    api_key:"484622677747755",
    api_secret:"P5vEX23tuyyBVP-Gt3FYWJvFOO4",
  });
  return cloudinary;
};

export const cloudinarySecrets = {
  cloud_name:"dfzvgykvx",
  api_key:"484622677747755",
  api_secret:"P5vEX23tuyyBVP-Gt3FYWJvFOO4",
}; 